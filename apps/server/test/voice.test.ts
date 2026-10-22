import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { maybeOne, many, withSystem } from "@receptionist/db";
import WebSocket from "ws";
import { squareReady, type Ready } from "./fixtures.ts";
import { newUser, startHarness, type Harness } from "./harness.ts";

let h: Harness;
let r: Ready;
let host = "";
const maya = newUser("Maya Owner");
const AI_NUMBER = "+13475550142";
let n = 0;
type J = Record<string, any>;

const wait = async (cond: () => boolean | Promise<boolean>, ms = 3000, what = "condition") => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
};

before(async () => {
  h = await startHarness({ square: true, realtime: true });
  r = await squareReady(h, maya, "Third Space");
  await h.call(maya, "PUT", `/locations/${r.lid}/hours`, { store: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "23:59" })), ordering: [] });
  await h.call(maya, "PATCH", `/locations/${r.lid}/settings`, { orderingEnabled: true });
  await h.call(maya, "PATCH", `/locations/${r.lid}`, { publicPhone: "+13475550100" });
  const bought = await h.twilio.buyNumber(AI_NUMBER, { voiceUrl: "", statusCallbackUrl: "", fallbackUrl: null });
  await withSystem(h.db, (tx) => tx.query("insert into phone_numbers (restaurant_id, location_id, provider_sid, e164) values ($1, $2, $3, $4)", [r.rid, r.lid, bought.sid, AI_NUMBER]));
  host = await h.listen();
});
after(async () => {
  await h.stop();
});

/** A phone call arriving, and the pass Twilio would carry to the media stream. */
async function incoming(from = "+12125550177") {
  const params = { CallSid: `CA${String(++n).padStart(32, "0")}`, From: from, To: AI_NUMBER, CallStatus: "ringing" };
  const res = await h.app.inject({ method: "POST", url: "/webhooks/twilio/voice", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": h.twilio.sign("https://api.example.test/webhooks/twilio/voice", params) }, payload: new URLSearchParams(params).toString() });
  const token = /name="token" value="([^"]+)"/.exec(res.body)?.[1] ?? "";
  const row = await withSystem(h.db, (tx) => maybeOne<{ id: string }>(tx, "select id from calls where provider_call_sid = $1", [params.CallSid]));
  return { ...params, token, callId: row!.id };
}

/** Plays Twilio: opens the media WebSocket and records everything it is sent. */
async function stream(call: Awaited<ReturnType<typeof incoming>>, token = call.token) {
  const ws = new WebSocket(`ws://${host}/voice/media`);
  const got: J[] = [];
  ws.on("message", (d) => got.push(JSON.parse(d.toString())));
  let closed = false;
  ws.on("close", () => (closed = true));
  await new Promise((res, rej) => (ws.once("open", res), ws.once("error", rej)));
  const before = h.realtime!.sessions.length;
  ws.send(JSON.stringify({ event: "connected" }));
  ws.send(JSON.stringify({ event: "start", start: { streamSid: `MZ${n}`, callSid: call.CallSid, customParameters: { token } } }));
  return {
    ws, got, isClosed: () => closed,
    model: async () => {
      await wait(() => h.realtime!.sessions.length > before && h.realtime!.sessions.at(-1)!.ofType("response.create").length > 0, 3000, "the model session");
      return h.realtime!.sessions.at(-1)!;
    },
    media: (payload = Buffer.alloc(160, 0x7f).toString("base64")) => ws.send(JSON.stringify({ event: "media", media: { payload } })),
    mark: (name: string) => ws.send(JSON.stringify({ event: "mark", mark: { name } })),
    stop: () => ws.send(JSON.stringify({ event: "stop" })),
  };
}
const audio = (ms: number, itemId = "item-1") => ({ type: "response.output_audio.delta", item_id: itemId, delta: Buffer.alloc(ms * 8, 0x55).toString("base64") });
const callTool = (name: string, args: object, id = `call-${++n}`) => ({ type: "response.function_call_arguments.done", call_id: id, name, arguments: JSON.stringify(args) });
const timeline = (callId: string) => withSystem(h.db, async (tx) => (await many<{ event_type: string }>(tx, "select event_type from call_events where call_id = $1 order by seq", [callId])).map((e) => e.event_type));

describe("opening the stream", () => {
  test("a valid pass starts the model with the restaurant's rules, twelve tools and mu-law audio", async () => {
    const call = await incoming();
    const s = await stream(call);
    const model = await s.model();
    const update = model.ofType("session.update")[0]!.session;
    assert.equal(update.audio.input.format.type, "audio/pcmu");
    assert.equal(update.audio.output.format.type, "audio/pcmu");
    assert.equal(update.audio.input.turn_detection.interrupt_response, true);
    assert.equal(update.audio.input.transcription, undefined, "transcripts are off by default, so no speech-to-text on our side");
    assert.equal(update.tools.length, 12);
    assert.match(update.instructions, /Third Space/);
    assert.match(update.instructions, /Never say a total unless calculate_order_total returned it/);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(update.instructions), "no ids in the prompt");
    const greeting = model.ofType("response.create")[0]!.response.instructions;
    assert.match(greeting, /AI/, "the greeting says it is an AI");
    assert.ok((await timeline(call.callId)).includes("stream.connected"));
    s.ws.close();
  });

  test("a pass works once, and a forged, expired or missing one never reaches the model", async () => {
    const call = await incoming();
    const first = await stream(call);
    await first.model();
    const sessions = h.realtime!.sessions.length;
    const replay = await stream(call);
    await wait(() => replay.isClosed(), 3000, "the replayed pass to be refused");
    const forged = await stream(await incoming(), call.token.slice(0, -4) + "AAAA");
    await wait(() => forged.isClosed(), 3000, "the forged pass to be refused");
    const none = await stream(await incoming(), "");
    await wait(() => none.isClosed(), 3000, "the empty pass to be refused");
    assert.equal(h.realtime!.sessions.length, sessions, "no model session was opened for any of them");
    first.ws.close();
  });

  test("a valid pass for another call's sid is refused", async () => {
    const a = await incoming();
    const b = await incoming();
    const ws = await stream({ ...b, token: a.token });
    await wait(() => ws.isClosed(), 3000, "mismatched pass to be refused");
  });
});

describe("audio and interruptions", () => {
  test("caller audio goes to the model and the model's audio goes back, marked for playback tracking", async () => {
    const s = await stream(await incoming());
    const model = await s.model();
    s.media();
    await wait(() => model.ofType("input_audio_buffer.append").length === 1, 3000, "caller audio at the model");
    model.emit(audio(100));
    await wait(() => s.got.some((f) => f.event === "mark"), 3000, "the model's audio at Twilio");
    const media = s.got.find((f) => f.event === "media")!;
    assert.equal(Buffer.from(media.media.payload, "base64").length, 800);
    s.ws.close();
  });

  test("when the caller talks over the AI, the audio is cleared and the model's turn is trimmed to what was heard", async () => {
    const s = await stream(await incoming());
    const model = await s.model();
    model.emit(audio(200));
    model.emit(audio(200));
    await wait(() => s.got.filter((f) => f.event === "mark").length === 2, 3000, "two audio chunks");
    s.mark(s.got.filter((f) => f.event === "mark")[0]!.mark.name); // Twilio finished playing the first 200 ms
    await new Promise((res) => setTimeout(res, 50));
    model.emit({ type: "input_audio_buffer.speech_started" });
    await wait(() => model.ofType("conversation.item.truncate").length === 1, 3000, "the truncate");
    await wait(() => s.got.some((f) => f.event === "clear"), 3000, "Twilio's playback buffer to be cleared");
    assert.ok(model.ofType("response.cancel").length >= 1);
    const t = model.ofType("conversation.item.truncate")[0]!;
    assert.equal(t.item_id, "item-1");
    assert.equal(t.audio_end_ms, 200, "trimmed at what the caller actually heard, not what was sent");
    s.ws.close();
  });

  test("speech with nothing playing doesn't send a stray clear or truncate", async () => {
    const s = await stream(await incoming());
    const model = await s.model();
    model.emit({ type: "input_audio_buffer.speech_started" });
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(model.ofType("conversation.item.truncate").length, 0);
    assert.ok(!s.got.some((f) => f.event === "clear"));
    s.ws.close();
  });
});

describe("tools during a call", () => {
  test("a tool call is run on the server and its answer returned to the model, who then continues", async () => {
    const s = await stream(await incoming());
    const model = await s.model();
    const before = model.ofType("response.create").length;
    model.emit(callTool("search_menu", { query: "oat latte" }, "c-search"));
    await wait(() => model.ofType("conversation.item.create").length === 1, 3000, "the tool output");
    const out = model.ofType("conversation.item.create")[0]!.item;
    assert.equal(out.type, "function_call_output");
    assert.equal(out.call_id, "c-search");
    assert.equal(JSON.parse(out.output).matches[0].name, "Latte");
    await wait(() => model.ofType("response.create").length === before + 1, 3000, "the model to be told to continue");
    s.ws.close();
  });

  test("two tool calls in one turn run in order and the model continues once, after both", async () => {
    const s = await stream(await incoming());
    const model = await s.model();
    const before = model.ofType("response.create").length;
    model.emit(callTool("get_restaurant_info", { topic: "hours" }, "c-1"));
    model.emit(callTool("get_restaurant_info", { topic: "address" }, "c-2"));
    model.emit(callTool("get_restaurant_info", { topic: "address" }, "c-2")); // a repeated event for the same call id
    await wait(() => model.ofType("conversation.item.create").length === 2, 3000, "both outputs");
    assert.deepEqual(model.ofType("conversation.item.create").map((e) => e.item.call_id), ["c-1", "c-2"]);
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(model.ofType("response.create").length, before + 1);
    s.ws.close();
  });

  test("a bad tool call gets an error result, never a crash", async () => {
    const s = await stream(await incoming());
    const model = await s.model();
    model.emit({ type: "response.function_call_arguments.done", call_id: "c-bad", name: "update_order_draft", arguments: "{not json" });
    await wait(() => model.ofType("conversation.item.create").length === 1, 3000, "an error output");
    assert.equal(JSON.parse(model.ofType("conversation.item.create")[0]!.item.output).reason, "INVALID_ARGUMENTS");
    s.ws.close();
  });
});

describe("leaving the call", () => {
  test("a transfer waits for the model to finish speaking, then redirects the call to the staff number", async () => {
    await h.call(maya, "POST", `/locations/${r.lid}/transfer-targets`, { label: "Front counter", e164: "+13475550101", priority: 1, intent: "GENERAL", activeHours: "ALWAYS", smsAlertOnMiss: false, enabled: true });
    const call = await incoming();
    const s = await stream(call);
    const model = await s.model();
    model.emit(callTool("request_human_transfer", { reason: "caller_request" }, "c-t"));
    await wait(() => model.ofType("conversation.item.create").length === 1, 3000, "the transfer tool output");
    await new Promise((res) => setTimeout(res, 150));
    assert.equal(h.twilio.redirects.filter((x) => x.callSid === call.CallSid).length, 0, "not yet: the model is still saying it's connecting");
    model.emit({ type: "response.done" });
    await wait(() => h.twilio.redirects.some((x) => x.callSid === call.CallSid), 6000, "the redirect");
    const twiml = h.twilio.redirects.find((x) => x.callSid === call.CallSid)!.twiml;
    assert.match(twiml, /<Dial[^>]*timeout="25"/);
    assert.match(twiml, /<Number[^>]*url="https:\/\/api\.example\.test\/webhooks\/twilio\/transfer-whisper\?call=/);
    assert.ok(twiml.includes("+13475550101"));
    await wait(() => s.isClosed(), 3000, "the media stream to close");
    assert.ok((await timeline(call.callId)).includes("handoff.triggered"));
  });

  test("end_call hangs up after the goodbye", async () => {
    const call = await incoming();
    const s = await stream(call);
    const model = await s.model();
    model.emit(callTool("end_call", {}, "c-end"));
    await wait(() => model.ofType("conversation.item.create").length === 1, 3000, "end_call output");
    model.emit({ type: "response.done" });
    await wait(() => h.twilio.hangups.includes(call.CallSid), 6000, "the hang-up");
  });
});
