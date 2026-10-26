// A text chat model behind the OpenAI-compatible Chat Completions API (Groq by default; xAI, OpenAI and
// others speak the same protocol). Used by the dashboard's test chat, which runs the same tools and rules
// as a phone call. A free tier has tight per-minute limits, so a 429 is waited out for a while first.

export type ChatToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ChatTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type ChatReply = { content: string | null; toolCalls: ChatToolCall[] };

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

export function createChatModel(o: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** The longest the free tier's rate limit is waited out before giving up. */
  maxWaitMs?: number;
}): ChatModel {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
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

  async function complete(messages: ChatMessage[], tools: ChatTool[]): Promise<ChatReply> {
    const body = {
      model: o.model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      max_completion_tokens: 1024,
      // Reasoning models think less for a short reply, which also keeps a free tier's token budget.
      ...(/gpt-oss/.test(o.model) ? { reasoning_effort: "low" } : {}),
    };
    let waited = 0;
    let retriedServer = false;
    let retriedToolFormat = false;
    for (;;) {
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
        return { content: m.content ?? null, toolCalls: (m.tool_calls ?? []).filter((c) => c?.function?.name) };
      }
      const text = await res.text().catch(() => "");
      if (res.status === 429) {
        const wait = Math.min(waitFrom(res.headers) ?? 5000, 20_000);
        if (waited + wait <= maxWait) {
          waited += wait;
          await sleep(wait);
          continue;
        }
        throw new ChatModelError("rate_limited", "The free AI service is at its limit for the moment. Wait a minute, then send your message again.");
      }
      if (res.status === 401 || res.status === 403) throw new ChatModelError("auth", `${label} refused the key. Check CHAT_AI_API_KEY in apps/server/.env.local.`);
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
