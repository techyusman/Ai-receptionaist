// A text chat model behind the OpenAI-compatible Chat Completions API (Groq by default; xAI, OpenAI and
// others speak the same protocol). Used by the dashboard's test chat, which runs the same tools and rules
// as a phone call. A free tier has tight per-minute limits, so a 429 is waited out for a while first.

export type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ChatTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type ChatReply = { content: string | null; toolCalls: ChatToolCall[]; /** Which model answered (one of the fallbacks when the main one was busy). */ model?: string };

export interface ChatModel {
  /** Shown on the chat screen, e.g. "Groq · openai/gpt-oss-120b". */
  readonly label: string;
  complete(messages: ChatMessage[], tools: ChatTool[]): Promise<ChatReply>;
}

export type ChatModelProblem = "auth" | "rate_limited" | "unavailable" | "bad_request";
export class ChatModelError extends Error {
  readonly problem: ChatModelProblem;
  constructor(problem: ChatModelProblem, message: string) {
    super(message);
    this.name = "ChatModelError";
    this.problem = problem;
  }
}

const PROVIDERS: Record<string, string> = { "api.groq.com": "Groq", "api.x.ai": "xAI", "api.openai.com": "OpenAI" };

/** "2", "7.66s" or "1m2.5s" (how Groq writes its reset headers) as milliseconds. */
export function waitFrom(headers: Headers): number | null {
  for (const name of ["retry-after", "x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"]) {
    const v = headers.get(name)?.trim();
    if (!v) continue;
    if (/^\d+(\.\d+)?$/.test(v)) return Math.ceil(Number(v) * 1000);
    const m = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(v);
    if (m && (m[1] || m[2])) return Math.ceil((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 1000);
  }
  return null;
}

/** Groq's free models each have their own per-minute allowance; these take over while the main one is busy. */
export function fallbackModels(baseUrl: string, configured: string | undefined): string[] {
  if (configured) return configured.split(",").map((m) => m.trim()).filter(Boolean);
  return /api\.groq\.com/.test(baseUrl) ? ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"] : [];
}

export function createChatModel(o: {
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * Models to switch to, in order, while the main one is at its rate limit. On Groq each model has its own
   * per-minute allowance, so switching answers at once where waiting could take most of a minute.
   */
  fallbacks?: string[];
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** The longest a rate limit is waited out (when every model is at its limit) before giving up. */
  maxWaitMs?: number;
}): ChatModel {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const maxWait = o.maxWaitMs ?? 30_000;
  const url = `${o.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const host = (() => {
    try {
      return new URL(o.baseUrl).host;
    } catch {
      return o.baseUrl;
    }
  })();
  const label = `${PROVIDERS[host] ?? host} · ${o.model}`;
  const models = [o.model, ...(o.fallbacks ?? []).filter((m) => m && m !== o.model)];
  /** When each model's rate limit is expected to have room again. */
  const coolingUntil = new Map<string, number>();
  // Reasoning models think less for a short reply, which is faster and keeps a free tier's token budget.
  const reasoning = (model: string) => (/gpt-oss/.test(model) ? { reasoning_effort: "low" } : /qwen3/.test(model) ? { reasoning_effort: "none" } : {});

  async function complete(messages: ChatMessage[], tools: ChatTool[]): Promise<ChatReply> {
    let waited = 0;
    let retriedServer = false;
    let retriedToolFormat = false;
    for (;;) {
      const model = models.find((m) => (coolingUntil.get(m) ?? 0) <= now());
      if (!model) {
        // Every model is at its limit: wait for the first to have room, within the budget.
        const wait = Math.max(250, Math.min(...models.map((m) => coolingUntil.get(m) ?? 0)) - now());
        if (waited + wait > maxWait) throw new ChatModelError("rate_limited", "The free AI service is at its limit for the moment. Wait a minute, then send your message again.");
        waited += wait;
        await sleep(wait);
        continue;
      }
      const body = { model, messages, tools, tool_choice: "auto", temperature: 0.3, max_completion_tokens: 1024, ...reasoning(model) };
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        if (!retriedServer) {
          retriedServer = true;
          await sleep(1000);
          continue;
        }
        throw new ChatModelError("unavailable", `Couldn't reach ${label}. Check your internet connection and try again.`);
      }
      if (res.ok) {
        const j = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ChatToolCall[] } }[] };
        const m = j.choices?.[0]?.message ?? {};
        return { content: m.content ?? null, toolCalls: (m.tool_calls ?? []).filter((c) => c?.function?.name), model };
      }
      const text = await res.text().catch(() => "");
      if (res.status === 429) {
        coolingUntil.set(model, now() + Math.min(waitFrom(res.headers) ?? 5000, 60_000));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new ChatModelError("auth", `${label} refused the key. Check CHAT_AI_API_KEY in apps/server/.env.local.`);
      // A fallback that this key can't use is simply skipped from now on.
      if (res.status === 404 && model !== o.model) {
        coolingUntil.set(model, Number.POSITIVE_INFINITY);
        continue;
      }
      if (res.status === 404) throw new ChatModelError("bad_request", `${label} isn't available with this key. Check CHAT_AI_MODEL in apps/server/.env.local.`);
      // A model that writes a malformed tool call gets one more go before we give up.
      if (res.status === 400 && /tool_use_failed|tool call/i.test(text) && !retriedToolFormat) {
        retriedToolFormat = true;
        continue;
      }
      if (res.status >= 500 && !retriedServer) {
        retriedServer = true;
        await sleep(1000);
        continue;
      }
      throw new ChatModelError(res.status >= 500 ? "unavailable" : "bad_request", `${label} answered ${res.status}. Try again in a moment.`);
    }
  }

  return { label, complete };
}
