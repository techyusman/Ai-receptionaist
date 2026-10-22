// One phone call's live audio: Twilio's media stream on one side, the speech-to-speech model on the
// other, and the tools in between. This class owns the call-time rules: interruptions, serial tool
// calls, the length and silence limits, and never leaving a caller on a dead line.
import { maybeOne, withSystem } from "@receptionist/db";
import { raiseAlert } from "../alerts.ts";
import { addEvent } from "../calls/service.ts";
import type { Deps } from "../deps.ts";
import type { RealtimeSession } from "../providers/realtime.ts";
import { submitConfirmedOrder } from "../pos/submit.ts";
import { loadCallContext, type CallContext } from "./context.ts";
import { buildInstructions, ensureDisclosure, voiceFor } from "./prompt.ts";
import { runTool, toolDefinitions } from "./tools/index.ts";
import type { ToolEffects } from "./tools/types.ts";
import { dialFallback, transferTo } from "./twiml.ts";
import { verifyStreamToken } from "./token.ts";
import { readHours, readSpecialHours } from "../routes/hours.ts";
import { isOpenAt } from "@receptionist/domain";
import { many } from "@receptionist/db";

export interface TwilioSocket {
  send(data: string): void;
  close(): void;
}

type Json = Record<string, any>;
const BYTES_PER_MS = 8; // G.711 mu-law at 8 kHz is 8 bytes per millisecond

export class VoiceSession {
  readonly #deps: Deps;
  readonly #twilio: TwilioSocket;
  #ctx: CallContext | null = null;
  #model: RealtimeSession | null = null;
  #streamSid = "";
  #closed = false;
  #queued: string[] = [];
  #tools: Promise<void> = Promise.resolve();
  #inflight = 0;
  readonly #seenCalls = new Set<string>();
  // Playback bookkeeping, so an interruption can cut the model's turn off where the caller stopped hearing it.
  #itemId: string | null = null;
  #sentMs = 0;
  #playedMs = 0;
  readonly #marks = new Map<string, number>();
  #markN = 0;
  #effect: ToolEffects | null = null;
  #awaitingResponseEnd = false;
  #silencePrompts = 0;
  #lastHeard = Date.now();
  readonly #timers: NodeJS.Timeout[] = [];

  constructor(deps: Deps, twilio: TwilioSocket) {
    this.#deps = deps;
    this.#twilio = twilio;
  }

  get context(): CallContext | null {
    return this.#ctx;
  }

  /** Twilio sent a frame. Anything malformed is dropped; nothing here can throw into the socket. */
  async onTwilio(raw: string): Promise<void> {
    let msg: Json;
    try {
      msg = JSON.parse(raw) as Json;
    } catch {
      return;
    }
    switch (msg.event) {
      case "start":
        await this.#start(msg.start as Json).catch((e) => this.#fail("start", e));
        break;
      case "media":
        if (typeof msg.media?.payload === "string") this.#audioIn(msg.media.payload);
        break;
      case "mark": {
        const ms = this.#marks.get(msg.mark?.name);
        if (ms !== undefined) {
          this.#playedMs = Math.max(this.#playedMs, ms);
          this.#marks.delete(msg.mark.name);
        }
        break;
      }
      case "stop":
        await this.close("twilio-stop");
        break;
    }
  }

  async #start(start: Json): Promise<void> {
    const { deps } = { deps: this.#deps };
    const claim = verifyStreamToken(deps.config.VOICE_STREAM_SECRET, start?.customParameters?.token);
    if (!claim) return this.#reject("bad pass");
    // A pass is single-use: the nonce is recorded, and a second use of it finds the row already there.
    const fresh = await withSystem(deps.db, async (tx) => {
      const r = await tx.query("insert into webhook_events (provider, provider_event_id, event_type, processing_status) values ('TWILIO', $1, 'stream.pass', 'PROCESSED') on conflict do nothing", [`pass:${claim.nonce}`]);
      return (r.rowCount ?? 0) > 0;
    });
    if (!fresh) return this.#reject("pass reused");
    const ctx = await loadCallContext(deps, claim.callId);
    if (!ctx || ctx.callSid !== start.callSid) return this.#reject("unknown call");
    this.#ctx = ctx;
    this.#streamSid = String(start.streamSid ?? "");
    await this.#event("stream.connected", "SYSTEM", claim.resume ? "Media stream reconnected after a transfer that did not connect." : "Media stream connected.");
    if (!deps.providers.realtime) return this.#degrade("no model configured");
    try {
      this.#model = await deps.providers.realtime.connect();
    } catch (e) {
      return this.#degrade(`model unavailable: ${(e as Error).message}`);
    }
    this.#model.onEvent((e) => void this.#onModel(e).catch((err) => this.#fail("model event", err)));
    this.#model.onClose(() => {
      if (!this.#closed) void this.#degrade("model connection closed");
    });
    await this.#configure(claim.resume);
    for (const frame of this.#queued.splice(0)) this.#model.send({ type: "input_audio_buffer.append", audio: frame });
    this.#startTimers();
  }

  async #configure(resume: boolean): Promise<void> {
    const { deps } = { deps: this.#deps };
    const ctx = this.#ctx!;
    const { openNow, pronunciations } = await withSystem(deps.db, async (tx) => {
      const [hours, specials, words] = await Promise.all([
        readHours(tx, ctx.locationId), readSpecialHours(tx, ctx.locationId),
        many<{ term: string; spoken_as: string }>(tx, "select term, spoken_as from pronunciations where location_id = $1", [ctx.locationId]),
      ]);
      return { openNow: hours.store.length ? isOpenAt(hours.store, specials, deps.now(), ctx.timezone) : null, pronunciations: words.map((w) => ({ term: w.term, spokenAs: w.spoken_as })) };
    });
    // Audio stays G.711 mu-law end to end, exactly what Twilio sends, so there is nothing to transcode.
    const fmt = { type: "audio/pcmu" };
    this.#model!.send({
      type: "session.update",
      session: {
        type: "realtime",
        model: deps.config.OPENAI_REALTIME_MODEL,
        instructions: buildInstructions(ctx, { openNow, pronunciations, now: deps.now() }),
        output_modalities: ["audio"],
        audio: {
          input: {
            format: fmt,
            turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600, create_response: true, interrupt_response: true },
            // Transcripts are opt-in per restaurant; without it, no speech is turned into text on our side.
            ...(ctx.settings.transcriptEnabled ? { transcription: { model: "gpt-4o-mini-transcribe" } } : {}),
          },
          output: { format: fmt, voice: voiceFor(ctx.settings.voice) },
        },
        tools: toolDefinitions(),
        tool_choice: "auto",
      },
    });
    const say = resume
      ? "The attempt to connect the caller to a person did not work out. Apologise briefly, then offer to take their name and number for a call back (ask permission first), or keep helping."
      : `Greet the caller by saying exactly: "${ensureDisclosure(ctx.settings.greeting).replace(/"/g, "'")}"`;
    this.#model!.send({ type: "response.create", response: { instructions: say } });
  }

  #audioIn(payload: string): void {
    if (!this.#model) {
      if (this.#queued.length < 100) this.#queued.push(payload);
      return;
    }
    this.#model.send({ type: "input_audio_buffer.append", audio: payload });
  }

  async #onModel(e: Json): Promise<void> {
    switch (e.type) {
      case "response.output_audio.delta":
      case "response.audio.delta": {
        if (typeof e.delta !== "string") return;
        if (e.item_id && e.item_id !== this.#itemId) {
          this.#itemId = e.item_id;
          this.#sentMs = 0;
          this.#playedMs = 0;
          this.#marks.clear();
        }
        this.#sentMs += Math.round(Buffer.from(e.delta, "base64").length / BYTES_PER_MS);
        this.#twilioSend({ event: "media", streamSid: this.#streamSid, media: { payload: e.delta } });
        const name = `m${++this.#markN}`;
        this.#marks.set(name, this.#sentMs);
        this.#twilioSend({ event: "mark", streamSid: this.#streamSid, mark: { name } });
        break;
      }
      case "input_audio_buffer.speech_started":
        this.#lastHeard = Date.now();
        this.#silencePrompts = 0;
        this.#interrupt();
        break;
      case "response.function_call_arguments.done":
        if (e.call_id && !this.#seenCalls.has(e.call_id)) {
          this.#seenCalls.add(e.call_id);
          this.#runToolSerially(String(e.call_id), String(e.name), e.arguments);
        }
        break;
      case "response.done":
        await this.#afterResponse();
        break;
      case "error":
        // A cancel that arrives after the response ended is routine; anything else is worth knowing.
        if (!/cancel|truncate|not_active/i.test(String(e.error?.code ?? e.error?.message ?? ""))) {
          console.error(JSON.stringify({ level: "warn", msg: "model error", callId: this.#ctx?.callId, code: e.error?.code }));
        }
        break;
    }
  }

  /** The caller started talking over the AI: stop the audio they're hearing and trim the model's turn to match. */
  #interrupt(): void {
    if (!this.#itemId || this.#sentMs === 0) return;
    this.#twilioSend({ event: "clear", streamSid: this.#streamSid });
    this.#model?.send({ type: "response.cancel" });
    this.#model?.send({ type: "conversation.item.truncate", item_id: this.#itemId, content_index: 0, audio_end_ms: Math.max(0, Math.floor(this.#playedMs)) });
    this.#itemId = null;
    this.#sentMs = 0;
    this.#marks.clear();
  }

  #twilioSend(frame: Json): void {
    if (!this.#closed) this.#twilio.send(JSON.stringify(frame));
  }

  /** Tools run one at a time, in the order the model asked, because the order row can't take two edits at once. */
  #runToolSerially(callId: string, name: string, args: unknown): void {
    this.#inflight++;
    this.#tools = this.#tools
      .then(async () => {
        const run = await runTool(this.#deps, this.#ctx!, name, args);
        this.#model?.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(run.result) } });
        if (run.effects?.transfer || run.effects?.endCall) this.#effect = { ...this.#effect, ...run.effects };
      })
      .catch((e) => this.#fail(`tool ${name}`, e))
      .finally(() => {
        this.#inflight--;
        // Only when every requested tool has answered does the model get to continue.
        if (this.#inflight === 0 && !this.#closed) {
          this.#awaitingResponseEnd = this.#effect !== null;
          this.#model?.send({ type: "response.create" });
        }
      });
  }

  /** A model turn finished. If it was the goodbye or the "connecting you" line, now is when the call is actually moved. */
  async #afterResponse(): Promise<void> {
    if (this.#inflight > 0 || !this.#effect || !this.#awaitingResponseEnd || this.#closed) return;
    const effect = this.#effect;
    this.#effect = null;
    this.#awaitingResponseEnd = false;
    await this.#drain();
    const ctx = this.#ctx!;
    const twilio = this.#deps.providers.twilio;
    if (effect.transfer && twilio) {
      const t = effect.transfer;
      try {
        await twilio.redirectCall(ctx.callSid, transferTo({ number: t.number, seconds: t.seconds, actionUrl: t.actionUrl, whisperUrl: t.whisperUrl }));
        await this.#event("transfer.dialing", "SYSTEM", "Dialling the staff number.");
        await this.close("transfer");
      } catch (e) {
        await this.#event("transfer.failed_to_start", "SYSTEM", "Could not start the transfer.");
        this.#model?.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "(system) The transfer could not be started. Apologise, and offer a call back." }] } });
        this.#model?.send({ type: "response.create" });
        console.error(JSON.stringify({ level: "error", msg: "transfer redirect failed", callId: ctx.callId, err: (e as Error).message }));
      }
    } else if (effect.endCall && twilio) {
      await twilio.hangUp(ctx.callSid).catch(() => undefined);
      await this.close("ended-by-ai");
    }
  }

  /** Let the caller hear the end of the sentence before the line changes. */
  async #drain(): Promise<void> {
    const limit = Date.now() + (this.#deps.tuning?.drainMs ?? 4000);
    while (!this.#closed && this.#playedMs < this.#sentMs - 200 && Date.now() < limit) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, this.#deps.tuning?.drainMs !== undefined ? 0 : 300));
  }

  #startTimers(): void {
    const ctx = this.#ctx!;
    const maxMs = this.#deps.tuning?.maxCallMs ?? ctx.settings.maxCallSeconds * 1000;
    const silenceMs = this.#deps.tuning?.silenceMs ?? ctx.settings.silenceTimeoutSeconds * 1000;
    this.#timers.push(
      setTimeout(() => {
        void this.#event("call.limit", "SYSTEM", "The call reached its time limit and was ended.");
        this.#effect = { endCall: true };
        this.#awaitingResponseEnd = true;
        this.#model?.send({ type: "response.create", response: { instructions: "The time limit for this call has been reached. Politely tell the caller you have to end the call, and that they can call again or ask for a call back. Then stop." } });
        this.#timers.push(setTimeout(() => void this.#hangUp("time limit"), 15_000));
      }, maxMs),
      setInterval(() => {
        if (this.#closed || this.#inflight > 0 || this.#effect) return;
        const speaking = this.#sentMs > this.#playedMs;
        if (speaking || Date.now() - this.#lastHeard < silenceMs) return;
        this.#lastHeard = Date.now();
        if (this.#silencePrompts++ === 0) {
          this.#model?.send({ type: "response.create", response: { instructions: "The caller has been quiet. Ask gently, in a few words, whether they're still there." } });
        } else {
          void this.#event("call.silence", "SYSTEM", "The caller went quiet and the call was ended.");
          void this.#hangUp("silence");
        }
      }, Math.max(50, Math.min(1000, Math.floor(silenceMs / 4)))),
    );
  }

  async #hangUp(why: string): Promise<void> {
    await this.#deps.providers.twilio?.hangUp(this.#ctx!.callSid).catch(() => undefined);
    await this.close(why);
  }

  async #event(type: string, actor: "SYSTEM" | "AI" | "CALLER" | "STAFF", detail: string): Promise<void> {
    if (!this.#ctx) return;
    const ctx = this.#ctx;
    await withSystem(this.#deps.db, (tx) => addEvent(tx, ctx.callId, ctx.restaurantId, type, actor, detail)).catch(() => undefined);
  }

  /** The model is gone or never started: a person takes the call rather than the caller hearing nothing. */
  async #degrade(why: string): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || this.#closed) return;
    console.error(JSON.stringify({ level: "error", msg: "voice degraded", callId: ctx.callId, why }));
    await this.#event("voice.degraded", "SYSTEM", "The assistant could not continue; the call was passed to the restaurant.");
    await withSystem(this.#deps.db, (tx) =>
      raiseAlert(this.#deps, tx, { restaurantId: ctx.restaurantId, locationId: ctx.locationId, kind: "VOICE_DEGRADED", severity: "CRITICAL", callId: ctx.callId, message: "The AI could not stay on a call and passed it to the restaurant's phone.", dedupeKey: `voice:${ctx.callId}` }),
    ).catch(() => undefined);
    const to = ctx.fallbackE164 ?? ctx.publicPhone;
    await this.#deps.providers.twilio?.redirectCall(ctx.callSid, dialFallback(to, "Sorry, I'm having trouble. Let me connect you to the restaurant.")).catch(() => undefined);
    await this.close("degraded");
  }

  #reject(why: string): void {
    console.error(JSON.stringify({ level: "warn", msg: "media stream refused", why }));
    this.#closed = true;
    this.#twilio.close();
  }

  #fail(where: string, e: unknown): void {
    console.error(JSON.stringify({ level: "error", msg: "voice session error", where, callId: this.#ctx?.callId, err: (e as Error)?.message }));
  }

  async close(why = "closed"): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const t of this.#timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.#model?.close();
    const ctx = this.#ctx;
    if (ctx) {
      await this.#event("stream.closed", "SYSTEM", `Media stream closed (${why}).`);
      // If the caller said yes and then the line dropped, the order is still theirs: send it.
      const confirmed = await withSystem(this.#deps.db, (tx) => maybeOne<{ id: string }>(tx, "select id from orders where call_id = $1 and local_status = 'CUSTOMER_CONFIRMED'", [ctx.callId])).catch(() => null);
      if (confirmed) await submitConfirmedOrder(this.#deps, confirmed.id).catch((e) => this.#fail("late submit", e));
    }
    this.#twilio.close();
  }
}
