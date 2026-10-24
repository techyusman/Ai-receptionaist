import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { maybeOne, many, withSystem } from "@receptionist/db";
import WebSocket from "ws";
import { confirmedOrder, squareReady, type Ready } from "./fixtures.ts";
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

const alerts = () => withSystem(h.db, (tx) => many<{ kind: string; severity: string }>(tx, "select kind, severity from alerts where location_id = $1", [r.lid]));

describe("when the voice path breaks, a person gets the call", () => {
  test("the model dropping mid-call redirects the caller to the restaurant and alerts staff", async () => {
    const call = await incoming();
    const s = await stream(call);
    const model = await s.model();
    model.drop(1011);
    await wait(() => h.twilio.redirects.some((x) => x.callSid === call.CallSid), 3000, "the fallback redirect");
    const twiml = h.twilio.redirects.find((x) => x.callSid === call.CallSid)!.twiml;
    assert.match(twiml, /<Dial>\+13475550100<\/Dial>/, "rings the store's line");
    assert.ok((await alerts()).some((a) => a.kind === "VOICE_DEGRADED" && a.severity === "CRITICAL"));
    assert.ok((await timeline(call.callId)).includes("voice.degraded"));
  });

  test("the model being unreachable when the call starts does the same, before the caller hears silence", async () => {
    h.realtime!.failNext = true;
    const call = await incoming();
    await stream(call);
    await wait(() => h.twilio.redirects.some((x) => x.callSid === call.CallSid), 3000, "the fallback redirect");
    assert.match(h.twilio.redirects.find((x) => x.callSid === call.CallSid)!.twiml, /<Dial>/);
  });
});

describe("limits", () => {
  test("a caller who goes quiet is asked once, then the call is ended", async () => {
    h.deps.tuning = { silenceMs: 300 };
    const call = await incoming();
    const s = await stream(call);
    const model = await s.model();
    const before = model.ofType("response.create").length;
    await wait(() => model.ofType("response.create").length === before + 1, 3000, "the 'are you still there' prompt");
    assert.match(model.ofType("response.create").at(-1)!.response.instructions, /still there/);
    await wait(() => h.twilio.hangups.includes(call.CallSid), 4000, "the hang-up after continued silence");
    assert.ok((await timeline(call.callId)).includes("call.silence"));
    h.deps.tuning = undefined;
  });

  test("a call that reaches its time limit is wound down and ended", async () => {
    h.deps.tuning = { maxCallMs: 300, drainMs: 0 };
    const call = await incoming();
    const s = await stream(call);
    const model = await s.model();
    await wait(() => model.ofType("response.create").some((e) => /time limit/.test(e.response?.instructions ?? "")), 3000, "the wrap-up instruction");
    model.emit({ type: "response.done" });
    await wait(() => h.twilio.hangups.includes(call.CallSid), 4000, "the hang-up");
    assert.ok((await timeline(call.callId)).includes("call.limit"));
    h.deps.tuning = undefined;
  });
});

describe("a caller who said yes and then the line dropped", () => {
  test("the confirmed order is still sent", async () => {
    const call = await incoming();
    const s = await stream(call);
    await s.model();
    const order = await confirmedOrder(h, r);
    await withSystem(h.db, (tx) => tx.query("update orders set call_id = $2 where id = $1", [order.id, call.callId]));
    s.ws.close();
    await wait(async () => (await withSystem(h.db, (tx) => maybeOne<{ local_status: string }>(tx, "select local_status from orders where id = $1", [order.id])))?.local_status === "SUBMITTED_TO_POS", 5000, "the order to be sent");
  });
});
