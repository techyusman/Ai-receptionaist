// The dashboard's test chat: a restaurant texts its AI the way a customer would. Each chat is a test call
// with no phone line, driven by a text model instead of the voice model, but through the very same tools,
// rules and order code, so what works here works on the phone. Orders are flagged as tests (they show on
// Live orders and never alert the kitchen). Chats live in memory on the server that started them; one left
// idle is ended after an hour.
import { abandon, IN_PROGRESS, isOpenAt } from "@receptionist/domain";
import { many, maybeOne, one, withSystem } from "@receptionist/db";
import { randomUUID } from "node:crypto";
import type { Access } from "../auth/access.ts";
import { endCall } from "../calls/outcome.ts";
import { addEvent } from "../calls/service.ts";
import type { Deps } from "../deps.ts";
import { HttpError, notFound, conflict } from "../errors.ts";
import { signal } from "../live.ts";
import { transition } from "../orders/service.ts";
import { ChatModelError, type ChatMessage, type ChatTool } from "../providers/chat.ts";
import { readHours, readSpecialHours } from "../routes/hours.ts";
import { toSummary } from "../routes/orders.ts";
import { tenant } from "../routes/util.ts";
import { loadCallContext, type CallContext } from "../voice/context.ts";
import { buildInstructions, ensureDisclosure } from "../voice/prompt.ts";
import { TOOLS, runTool } from "../voice/tools/index.ts";
import type { ToolRun } from "../voice/tools/types.ts";
import { currentOrder } from "../voice/tools/order-support.ts";

const IDLE_MS = 60 * 60_000;
const MAX_STEPS = 8;

type Chat = {
  id: string;
  /** "voice": the browser call (spoken replies, phone rules); "chat": typed. */
  mode: "chat" | "voice";
  locationId: string;
  userId: string;
  ctx: CallContext;
  messages: ChatMessage[];
  transcript: { speaker: "CALLER" | "AI"; text: string; at_ms: number }[];
  startedAt: number;
  lastActive: number;
  busy: boolean;
  /** The restaurant's name and dishes, to help speech-to-text spell them. */
  hints?: string;
  /** How many customer messages there were when the order was last priced and read back. */
  readBackAt?: number;
};

export type ChatTurn = {
  replies: string[];
  /** What the AI did this turn, in the call timeline's words. */
  steps: string[];
  order: ReturnType<typeof toSummary> | null;
  /** Something the chat couldn't do that a phone call would (a transfer), or a problem with the model. */
  notice: string | null;
  ended: boolean;
  /** How long this turn took, to see where the time goes. */
  timings?: { hearMs?: number; thinkMs: number; modelCalls: number; model?: string; tokens?: number; waitedMs?: number };
};

/**
 * What the model is sent: the instructions, every customer and AI line, and the tool steps of the latest
 * two turns only. Older tool results (menu search lists, order snapshots) are what made each request big,
 * and a free tier counts every token; the order itself lives in the database and the tools read it fresh.
 */
export function forModel(messages: ChatMessage[]): ChatMessage[] {
  const turns = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  const keepFrom = turns.length >= 2 ? turns[turns.length - 2]! : 0;
  return messages.flatMap((m, i): ChatMessage[] => {
    if (i >= keepFrom || m.role === "system" || m.role === "user") return [m];
    if (m.role === "tool") return [];
    if (m.role === "assistant" && m.tool_calls) return m.content?.trim() ? [{ role: "assistant", content: m.content }] : [];
    return [m];
  });
}

export const voiceNotConfigured = () =>
  new HttpError(503, "UPSTREAM", "Calling the AI from the browser needs an AI key for hearing speech. Get a free one at console.groq.com/keys, put CHAT_AI_API_KEY=your-key in apps/server/.env.local, and restart the server.");

/** Replies are shown and spoken as plain text: no markdown stars, underscores, code marks or headings. */
export const plain = (text: string) =>
  text
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    // Stage directions a model sometimes writes after its question; never said out loud.
    .replace(/\s*\((?:waiting|awaiting|note|pause|silence)\b[^)]*\)/gi, "")
    // A model sometimes runs several turns together with no space after the stop ("…please?And your number?
    // My name is Ali…"), even writing the customer's side; only the first part is its own reply.
    .replace(/([a-z0-9)"'’][.?!])(?=[A-Z])[\s\S]*$/, "$1")
    .trim();

/** A line already said this turn (the model often repeats its question after a tool step) is said once. */
const addReply = (turn: ChatTurn, text: string) => {
  if (text && !turn.replies.some((r) => r.includes(text))) turn.replies.push(text);
};

/** The voice is kept for short lines only (the greeting, "One moment", "Anything else?"): those repeat. */
const REMEMBER_VOICE_UP_TO = 120;
/** A chat that just ended can still be voiced this long: the AI's goodbye is spoken after it hangs up. */
const GOODBYE_MS = 2 * 60_000;

/** What Whisper "hears" in silence or noise; never treated as something the customer said. ("Bye" is
 * kept: a customer may really say it to end the call.) */
const NOISE = /^(?:thank you\.?|thanks for watching!?|you\.?|\.+|\s*)$/i;

export const chatNotConfigured = () =>
  new HttpError(503, "UPSTREAM", "The test chat needs an AI key. Get a free one at console.groq.com/keys, put CHAT_AI_API_KEY=your-key in apps/server/.env.local, and restart the server.");

/** Long digit runs (phone or card numbers) are masked in what's kept, as on a call. */
export const redact = (text: string) => text.replace(/\+?\d(?:[\s().-]?\d){6,}/g, (m) => `•••${m.replace(/\D/g, "").slice(-4)}`);

const SPOKEN_DIGITS: Record<string, string> = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
/** Every digit the customer has said so far, in order, with "zero three" counted as 03. */
const digitsSaid = (messages: ChatMessage[]) =>
  messages
    .flatMap((m) => (m.role === "user" ? [m.content] : []))
    .map((text) => text.toLowerCase().replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => SPOKEN_DIGITS[w]!).replace(/\D/g, ""))
    .join("");

/**
 * A model that is told to take the caller's number will sometimes invent a likely one ("0300 1234567")
 * before the caller has said anything. A number goes on an order or a call back only if the customer
 * said its digits (the last seven are enough: "0300" and "+92 300" are both fine).
 */
function inventedNumber(chat: Chat, tool: string, raw: string): ToolRun | null {
  if (tool !== "set_customer_details" && tool !== "request_callback") return null;
  let phone = "";
  try {
    phone = String((JSON.parse(raw || "{}") as { phone?: unknown }).phone ?? "");
  } catch {
    return null; // the tool itself explains a malformed call
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digitsSaid(chat.messages).includes(digits.slice(-7))) return null;
  return {
    result: { ok: false, reason: "NOT_SAID", say: "The customer hasn't told you this number. Ask for their name and phone number, and never make one up." },
    note: tool === "request_callback" ? "Callback refused (NOT_SAID)." : "Customer details refused (NOT_SAID).",
  };
}

/**
 * A model that has just read the order back sometimes answers "yes" for the customer and confirms in the
 * same breath. A confirmation counts only if the customer has said something since the read-back.
 */
function confirmedForThem(chat: Chat, tool: string, raw: string): ToolRun | null {
  if (tool !== "mark_customer_confirmation" || chat.readBackAt === undefined) return null;
  try {
    if ((JSON.parse(raw || "{}") as { confirmed?: unknown }).confirmed !== true) return null;
  } catch {
    return null;
  }
  if (customerTurns(chat) > chat.readBackAt) return null;
  return {
    result: { ok: false, reason: "NOT_ASKED", say: "You have just read the order back. Stop here and wait for the customer's answer; never answer for them." },
    note: "Confirmation refused (NOT_ASKED).",
  };
}

const customerTurns = (chat: Chat) => chat.messages.filter((m) => m.role === "user").length;

const chatTools: ChatTool[] = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

export class TestChats {
  readonly #deps: Deps;
  readonly #chats = new Map<string, Chat>();
  /** Chats that just ended, so their goodbye can still be voiced. */
  readonly #ended = new Map<string, { userId: string; locationId: string; until: number }>();
  /** Voice already made for short lines, by text. */
  readonly #voiced = new Map<string, Promise<{ audio: Uint8Array; mimeType: string }>>();
  readonly #sweep: ReturnType<typeof setInterval>;

  constructor(deps: Deps) {
    this.#deps = deps;
    this.#sweep = setInterval(() => void this.#endIdle(), 5 * 60_000);
    this.#sweep.unref();
  }

  close() {
    clearInterval(this.#sweep);
  }

  get model() {
    return this.#deps.providers.chat?.label ?? null;
  }

  async start(a: Access, lid: string, mode: "chat" | "voice" = "chat"): Promise<{ chatId: string; greeting: string; model: string }> {
    if (mode === "voice" && !this.#deps.providers.stt) throw voiceNotConfigured();
    const model = this.#deps.providers.chat;
    if (!model) throw chatNotConfigured();
    // One open chat per person per location: starting again closes the last one.
    for (const c of this.#chats.values()) if (c.userId === a.userId && c.locationId === lid) await this.#end(c, a, "Test chat ended: a new one started.");

    const callId = await tenant(this.#deps, a, async (tx) => {
      const number = await maybeOne<{ e164: string }>(tx, "select e164 from phone_numbers where location_id = $1 and released_at is null order by created_at limit 1", [lid]);
      const call = await one<{ id: string }>(
        tx,
        `insert into calls (restaurant_id, location_id, provider_call_sid, is_test, from_e164, to_e164, started_at, answered_at, status, summary)
         values ($1, $2, $3, true, null, $4, now(), now(), 'IN_PROGRESS', $5) returning id`,
        [a.restaurantId, lid, `CHAT-${randomUUID()}`, number?.e164 ?? "+15550000000", mode === "voice" ? "Test call from the browser." : "Test chat from the dashboard."],
      );
      await addEvent(tx, call.id, a.restaurantId, "call.started", "SYSTEM", `${mode === "voice" ? "Browser test call" : "Test chat"} started by ${a.name ?? a.email}.`);
      await signal(tx, lid, { type: "call", id: call.id });
      return call.id;
    });
    const ctx = await loadCallContext(this.#deps, callId);
    if (!ctx) throw notFound();
    const { openNow, pronunciations } = await withSystem(this.#deps.db, async (tx) => {
      const [hours, specials, words] = await Promise.all([
        readHours(tx, lid),
        readSpecialHours(tx, lid),
        many<{ term: string; spoken_as: string }>(tx, "select term, spoken_as from pronunciations where location_id = $1", [lid]),
      ]);
      return { openNow: hours.store.length ? isOpenAt(hours.store, specials, this.#deps.now(), ctx.timezone) : null, pronunciations: words.map((w) => ({ term: w.term, spokenAs: w.spoken_as })) };
    });
    const greeting = ensureDisclosure(ctx.settings.greeting);
    const now = Date.now();
    this.#chats.set(callId, {
      id: callId, mode, locationId: lid, userId: a.userId, ctx, startedAt: now, lastActive: now, busy: false,
      messages: [
        // A browser call is spoken, so it follows the phone rules; a typed chat follows the chat ones.
        { role: "system", content: buildInstructions(ctx, { openNow, pronunciations, now: this.#deps.now(), channel: mode === "voice" ? "phone" : "chat" }) },
        { role: "assistant", content: greeting },
      ],
      transcript: [{ speaker: "AI", text: greeting, at_ms: 0 }],
    });
    return { chatId: callId, greeting, model: model.label };
  }

  async send(a: Access, lid: string, chatId: string, text: string): Promise<ChatTurn> {
    const chat = this.#mine(a, lid, chatId);
    const model = this.#deps.providers.chat;
    if (!model) throw chatNotConfigured();
    if (chat.busy) throw conflict("The AI is still answering your last message.");
    chat.busy = true;
    chat.lastActive = Date.now();
    const turn: ChatTurn = { replies: [], steps: [], order: null, notice: null, ended: false };
    const timings: NonNullable<ChatTurn["timings"]> = { thinkMs: 0, modelCalls: 0 };
    const started = Date.now();
    let effect: { transferId?: string; endCall?: boolean } = {};
    try {
      chat.messages.push({ role: "user", content: text });
      chat.transcript.push({ speaker: "CALLER", text: redact(text), at_ms: Date.now() - chat.startedAt });
      for (let step = 0; step < MAX_STEPS; step++) {
        const reply = await model.complete(forModel(chat.messages), chatTools);
        timings.modelCalls++;
        if (reply.model) timings.model = reply.model;
        if (reply.tokens) timings.tokens = (timings.tokens ?? 0) + reply.tokens;
        if (reply.waitedMs) timings.waitedMs = (timings.waitedMs ?? 0) + reply.waitedMs;
        if (!reply.toolCalls.length) {
          const said = plain(reply.content ?? "") || "Sorry, could you say that again?";
          chat.messages.push({ role: "assistant", content: said });
          chat.transcript.push({ speaker: "AI", text: redact(said), at_ms: Date.now() - chat.startedAt });
          addReply(turn, said);
          break;
        }
        chat.messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: reply.toolCalls });
        if (reply.content?.trim()) addReply(turn, plain(reply.content));
        for (const call of reply.toolCalls) {
          const { name, arguments: args } = call.function;
          const run = inventedNumber(chat, name, args) ?? confirmedForThem(chat, name, args) ?? (await runTool(this.#deps, chat.ctx, name, args));
          if (name === "calculate_order_total" && run.result.ok !== false) chat.readBackAt = customerTurns(chat);
          if (run.note) turn.steps.push(run.note);
          if (run.effects?.transfer) effect = { ...effect, transferId: run.effects.transfer.transferId };
          if (run.effects?.endCall) effect = { ...effect, endCall: true };
          chat.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(run.result) });
        }
        if (step === MAX_STEPS - 1) turn.notice = "The AI took too many steps without answering. Try saying it another way.";
      }
    } catch (e) {
      if (!(e instanceof ChatModelError)) throw e;
      turn.notice = e.message;
    } finally {
      chat.busy = false;
      timings.thinkMs = Date.now() - started;
      turn.timings = timings;
    }

    if (effect.transferId) {
      // A chat has no line to put through. Close the transfer and say where a real call would have gone.
      const target = await tenant(this.#deps, a, async (tx) => {
        await tx.query("update transfers set result = 'CANCELED', ended_at = now() where id = $1 and result is null", [effect.transferId]);
        return maybeOne<{ label: string | null }>(tx, "select t.label from transfers x left join transfer_targets t on t.id = x.target_id where x.id = $1", [effect.transferId]);
      });
      turn.notice = `On a phone call, the AI would now put the caller through to ${target?.label ?? "the restaurant"}. This chat ends here.`;
      await this.#end(chat, a, "Test chat ended at a transfer.");
      turn.ended = true;
    } else if (effect.endCall) {
      await this.#end(chat, a, "The AI ended the test chat.");
      turn.ended = true;
    }
    turn.order = await tenant(this.#deps, a, async (tx) => {
      const order = await currentOrder(tx, chat.ctx);
      return order ? toSummary(order) : null;
    });
    if (!turn.ended) await this.#saveTranscript(chat, a);
    return turn;
  }

  /** One spoken turn of a browser call: hear the clip, then answer it like a typed message. */
  async hear(a: Access, lid: string, chatId: string, audio: Uint8Array, mimeType: string): Promise<{ heard: string; turn: ChatTurn }> {
    const stt = this.#deps.providers.stt;
    if (!stt) throw voiceNotConfigured();
    const chat = this.#mine(a, lid, chatId);
    chat.lastActive = Date.now();
    chat.hints ??= await withSystem(this.#deps.db, async (tx) => {
      const items = await many<{ name: string }>(tx, "select name from menu_items where location_id = $1 and not is_deleted order by name", [lid]);
      return [chat.ctx.restaurantName, ...items.map((i) => i.name)].join(", ");
    });
    const nothing: ChatTurn = { replies: [], steps: [], order: null, notice: null, ended: false };
    let heard: string;
    const hearing = Date.now();
    try {
      heard = (await stt.transcribe(audio, mimeType, chat.hints)).trim();
    } catch (e) {
      if (e instanceof ChatModelError) return { heard: "", turn: { ...nothing, notice: e.message } };
      throw e;
    }
    const hearMs = Date.now() - hearing;
    if (NOISE.test(heard)) return { heard: "", turn: { ...nothing, timings: { hearMs, thinkMs: 0, modelCalls: 0 } } };
    const turn = await this.send(a, lid, chatId, heard);
    return { heard, turn: { ...turn, timings: { ...turn.timings!, hearMs } } };
  }

  /** The AI's voice for one piece of a reply on a browser call (Orpheus takes 200 characters at a time). */
  async speech(a: Access, lid: string, chatId: string, text: string): Promise<{ audio: Uint8Array; mimeType: string }> {
    const tts = this.#deps.providers.tts;
    if (!tts) throw new HttpError(503, "UPSTREAM", "No voice is set up on this server, so the browser's own voice is used.");
    const ended = this.#ended.get(chatId);
    if (!(ended && ended.until > Date.now() && ended.userId === a.userId && ended.locationId === lid)) this.#mine(a, lid, chatId);
    try {
      if (text.length > REMEMBER_VOICE_UP_TO) return await tts.speak(text);
      let voiced = this.#voiced.get(text);
      if (!voiced) {
        voiced = tts.speak(text);
        this.#voiced.set(text, voiced);
        voiced.catch(() => this.#voiced.delete(text));
        if (this.#voiced.size > 40) this.#voiced.delete(this.#voiced.keys().next().value!);
      }
      return await voiced;
    } catch (e) {
      if (e instanceof ChatModelError) throw new HttpError(e.problem === "rate_limited" ? 429 : 503, "UPSTREAM", e.message);
      throw e;
    }
  }

  async end(a: Access, lid: string, chatId: string): Promise<void> {
    await this.#end(this.#mine(a, lid, chatId), a, "Test chat ended.");
  }

  #mine(a: Access, lid: string, chatId: string): Chat {
    const chat = this.#chats.get(chatId);
    if (!chat || chat.userId !== a.userId || chat.locationId !== lid) throw notFound("That chat has ended. Start a new one.");
    return chat;
  }

  async #saveTranscript(chat: Chat, a: Access) {
    if (!chat.ctx.settings.transcriptEnabled) return;
    await tenant(this.#deps, a, (tx) =>
      tx.query(
        `insert into call_transcripts (call_id, restaurant_id, segments) values ($1, $2, $3)
         on conflict (call_id) do update set segments = excluded.segments, updated_at = now()`,
        [chat.id, chat.ctx.restaurantId, JSON.stringify(chat.transcript)],
      ),
    );
  }

  async #end(chat: Chat, a: Pick<Access, "restaurantId" | "userId" | "actorType">, note: string) {
    this.#chats.delete(chat.id);
    for (const [id, e] of this.#ended) if (e.until < Date.now()) this.#ended.delete(id);
    this.#ended.set(chat.id, { userId: chat.userId, locationId: chat.locationId, until: Date.now() + GOODBYE_MS });
    await this.#saveTranscript(chat, a as Access);
    await tenant(this.#deps, a as Access, async (tx) => {
      // A draft nobody confirmed is dropped, as when a test caller hangs up.
      const order = await currentOrder(tx, chat.ctx);
      if (order && IN_PROGRESS.has(order.status) && order.status !== "SUBMISSION_PENDING" && order.status !== "SUBMISSION_UNKNOWN") {
        await transition(tx, order.id, (x) => abandon(x, { actor: "SYSTEM", at: this.#deps.now().toISOString(), reason: "Test chat ended" }), { actor: "SYSTEM" });
      }
      const done = await endCall(tx, chat.id, "completed", Math.round((Date.now() - chat.startedAt) / 1000));
      if (done.ended) {
        await addEvent(tx, chat.id, chat.ctx.restaurantId, "call.ended", "SYSTEM", note);
        await this.#deps.jobs.enqueue("call.finalize", { callId: chat.id }, { tx });
      }
      await signal(tx, chat.locationId, { type: "call", id: chat.id });
    });
  }

  async #endIdle() {
    const cutoff = Date.now() - IDLE_MS;
    for (const chat of [...this.#chats.values()]) {
      if (chat.lastActive >= cutoff || chat.busy) continue;
      await this.#end(chat, { restaurantId: chat.ctx.restaurantId, userId: chat.userId, actorType: "USER" }, "Test chat ended after an hour without messages.").catch((e) =>
        console.error(JSON.stringify({ level: "error", msg: "ending an idle test chat failed", callId: chat.id, err: (e as Error).message })),
      );
    }
  }
}
