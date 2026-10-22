import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { many, maybeOne, withSystem } from "@receptionist/db";
import { verifyStreamToken } from "../src/voice/token.ts";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
let lid: string;
let rid: string;
const AI_NUMBER = "+13475550142";
const STORE_NUMBER = "+13475550100";
const BASE = "https://api.example.test";
let sid = 0;

async function post(path: string, params: Record<string, string>, opts: { sign?: boolean; url?: string } = {}) {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (opts.sign !== false) headers["x-twilio-signature"] = h.twilio.sign(opts.url ?? url, params);
  return h.app.inject({ method: "POST", url: path, headers, payload: new URLSearchParams(params).toString() });
}
const newCall = (extra: Record<string, string> = {}) => ({ CallSid: `CA${String(++sid).padStart(32, "0")}`, From: "+12125550177", To: AI_NUMBER, CallStatus: "ringing", ...extra });
const callRow = (callSid: string) => withSystem(h.db, (tx) => maybeOne<{ id: string; status: string; outcome: string | null; is_test: boolean; from_e164: string | null }>(tx, "select id, status, outcome, is_test, from_e164 from calls where provider_call_sid = $1", [callSid]));

before(async () => {
  h = await startHarness({ realtime: true });
  ({ restaurantId: rid, locationId: lid } = await signUp(h, maya, "Third Space"));
  await h.call(maya, "PATCH", `/locations/${lid}`, { publicPhone: STORE_NUMBER });
  const bought = await h.twilio.buyNumber(AI_NUMBER, { voiceUrl: "", statusCallbackUrl: "", fallbackUrl: null });
  await withSystem(h.db, (tx) => tx.query("insert into phone_numbers (restaurant_id, location_id, provider_sid, e164) values ($1, $2, $3, $4)", [rid, lid, bought.sid, AI_NUMBER]));
});
after(async () => {
  await h.stop();
});

describe("an incoming call", () => {
  test("is matched to its restaurant by the dialled number and handed to the media stream with a one-time pass", async () => {
    const p = newCall();
    const res = await post("/webhooks/twilio/voice", p);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] as string, /xml/);
    assert.match(res.body, /<Connect><Stream url="wss:\/\/api\.example\.test\/voice\/media">/);
    const token = /name="token" value="([^"]+)"/.exec(res.body)![1]!;
    const call = (await callRow(p.CallSid))!;
    const claim = verifyStreamToken(h.config.VOICE_STREAM_SECRET, token);
    assert.equal(claim?.callId, call.id);
    assert.equal(call.status, "IN_PROGRESS");
    assert.equal(call.from_e164, "+12125550177");
    assert.equal(call.is_test, false);
  });

  test("Twilio retrying the same webhook does not create a second call", async () => {
    const p = newCall();
    await post("/webhooks/twilio/voice", p);
    await post("/webhooks/twilio/voice", p);
    const rows = await withSystem(h.db, (tx) => many(tx, "select id from calls where provider_call_sid = $1", [p.CallSid]));
    assert.equal(rows.length, 1);
  });

  test("an unsigned, wrongly signed or wrong-URL request is refused and creates nothing", async () => {
    const a = newCall();
    assert.equal((await post("/webhooks/twilio/voice", a, { sign: false })).statusCode, 403);
    const b = newCall();
    assert.equal((await post("/webhooks/twilio/voice", { ...b, To: "+13475550199" }, { url: `${BASE}/webhooks/twilio/voice` })).statusCode, 200, "a valid signature over what was sent is fine");
    const c = newCall();
    const res = await h.app.inject({ method: "POST", url: "/webhooks/twilio/voice", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": h.twilio.sign(`${BASE}/webhooks/twilio/voice`, { ...c, From: "+19998887777" }) }, payload: new URLSearchParams(c).toString() });
    assert.equal(res.statusCode, 403, "signature does not cover these fields");
    const d = newCall();
    assert.equal((await post("/webhooks/twilio/voice", d, { url: "http://evil.example/webhooks/twilio/voice" })).statusCode, 403);
    for (const p of [a, c, d]) assert.equal(await callRow(p.CallSid), null);
  });

  test("a number we don't know gets a polite message, not a call record", async () => {
    const p = newCall({ To: "+13475550111" });
    const res = await post("/webhooks/twilio/voice", p);
    assert.match(res.body, /isn't in service/);
    assert.equal(await callRow(p.CallSid), null);
  });
});

describe("ring staff first", () => {
  test("rings the store line, then either ends (staff answered) or gives the call to the AI", async () => {
    await h.call(maya, "PATCH", `/locations/${lid}/settings`, { ringStaffFirst: true, ringStaffSeconds: 20 });
    const unanswered = newCall();
    const first = await post("/webhooks/twilio/voice", unanswered);
    assert.match(first.body, /<Dial[^>]*timeout="20"[^>]*action="https:\/\/api\.example\.test\/webhooks\/twilio\/ring-staff-result\?call=/);
    assert.ok(first.body.includes(`<Number>${STORE_NUMBER}</Number>`), first.body);
    const row = (await callRow(unanswered.CallSid))!;
    assert.equal(row.status, "RINGING_STAFF");
    const q = `/webhooks/twilio/ring-staff-result?call=${row.id}`;
    const next = await post(q, { CallSid: unanswered.CallSid, DialCallStatus: "no-answer" });
    assert.match(next.body, /<Connect><Stream/);
    assert.equal((await callRow(unanswered.CallSid))!.status, "IN_PROGRESS");

    const answered = newCall();
    await post("/webhooks/twilio/voice", answered);
    const row2 = (await callRow(answered.CallSid))!;
    const done = await post(`/webhooks/twilio/ring-staff-result?call=${row2.id}`, { CallSid: answered.CallSid, DialCallStatus: "completed", DialCallDuration: "75" });
    assert.match(done.body, /<Hangup/);
    const ended = (await callRow(answered.CallSid))!;
    assert.deepEqual([ended.status, ended.outcome], ["ENDED", "STAFF_ANSWERED"]);
    await h.call(maya, "PATCH", `/locations/${lid}/settings`, { ringStaffFirst: false });
  });

  test("a result for a different call's id is refused", async () => {
    const a = newCall();
    await post("/webhooks/twilio/voice", a);
    const mine = (await callRow(a.CallSid))!;
    const other = newCall();
    const res = await post(`/webhooks/twilio/ring-staff-result?call=${mine.id}`, { CallSid: other.CallSid, DialCallStatus: "completed" });
    assert.match(res.body, /<Hangup/);
    assert.equal((await callRow(a.CallSid))!.outcome, null, "the real call was not touched");
  });
});

describe("browser test calls", () => {
  test("a Voice SDK test call is flagged as a test, and one minted for another location is refused", async () => {
    const ok = newCall({ From: `client:test-${maya.id}-${lid}` });
    const res = await post("/webhooks/twilio/voice", ok);
    assert.match(res.body, /<Stream/);
    assert.equal((await callRow(ok.CallSid))!.is_test, true);
    const bad = newCall({ From: `client:test-${maya.id}-00000000-0000-4000-8000-000000000000` });
    assert.match((await post("/webhooks/twilio/voice", bad)).body, /isn't in service/);
    assert.equal(await callRow(bad.CallSid), null);
  });
});

describe("the call ending", () => {
  const finish = async (p: ReturnType<typeof newCall>, status = "completed", duration = "42") => post("/webhooks/twilio/status", { CallSid: p.CallSid, CallStatus: status, CallDuration: duration });

  test("a caller who just hung up is recorded as such, and the call is queued for its summary", async () => {
    const p = newCall();
    await post("/webhooks/twilio/voice", p);
    h.jobs.pending.length = 0;
    assert.equal((await finish(p)).statusCode, 204);
    const row = (await callRow(p.CallSid))!;
    assert.deepEqual([row.status, row.outcome], ["ENDED", "CALLER_HUNG_UP"]);
    assert.deepEqual(h.jobs.names(), ["call.finalize"]);
    await finish(p);
    assert.equal(h.jobs.names().length, 1, "a repeated status callback changes nothing");
  });

  test("a call that never connected is a failure, and an order that may exist outranks everything", async () => {
    const failed = newCall();
    await post("/webhooks/twilio/voice", failed);
    await finish(failed, "failed", "0");
    assert.equal((await callRow(failed.CallSid))!.outcome, "FAILED");

    const ordered = newCall();
    await post("/webhooks/twilio/voice", ordered);
    const id = (await callRow(ordered.CallSid))!.id;
    await withSystem(h.db, async (tx) => {
      await tx.query("insert into orders (restaurant_id, location_id, call_id, currency, pos_mode, is_test) values ($1, $2, $3, 'USD', 'DASHBOARD_TICKET', false)", [rid, lid, id]);
      await tx.query("insert into callback_requests (restaurant_id, location_id, call_id, customer_name, phone_e164) values ($1, $2, $3, 'Priya', '+12125550101')", [rid, lid, id]);
      await tx.query("update orders set customer_name = 'Priya', customer_phone_e164 = '+12125550101', local_status = 'ABANDONED' where call_id = $1", [id]);
    });
    await finish(ordered);
    assert.equal((await callRow(ordered.CallSid))!.outcome, "CALLBACK_REQUESTED", "an abandoned draft is not an order, but a promised callback is");
  });
});
