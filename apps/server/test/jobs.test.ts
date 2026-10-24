import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { many, maybeOne, withSystem } from "@receptionist/db";
import { finalizeCall } from "../src/jobs/call-finalize.ts";
import { fanOutAlert } from "../src/jobs/alerts-fanout.ts";
import { flagStaleMenus, purgeExpired, reconcileCatalogs, renewTokens } from "../src/jobs/maintenance.ts";
import { raiseAlert } from "../src/alerts.ts";
import { endCall } from "../src/calls/outcome.ts";
import { confirmedOrder, squareReady, type Ready } from "./fixtures.ts";
import { newUser, startHarness, type Harness } from "./harness.ts";

let h: Harness;
let r: Ready;
const maya = newUser("Maya Owner");
const jordan = newUser("Jordan Manager");
let n = 0;
type J = Record<string, any>;

before(async () => {
  h = await startHarness({ square: true });
  r = await squareReady(h, maya, "Third Space");
  await h.call(maya, "POST", `/restaurants/${r.rid}/invitations`, { email: jordan.email, role: "MANAGER" });
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.email.sent.at(-1)!.text)![1]!);
  await h.call(jordan, "POST", "/invitations/accept", { token });
});
after(async () => {
  await h.stop();
});

/** A finished call row, optionally with an order attached. */
async function endedCall(opts: { order?: boolean; confirmed?: boolean; from?: string } = {}) {
  const id = await withSystem(h.db, async (tx) => {
    const c = await tx.query<{ id: string }>(
      `insert into calls (restaurant_id, location_id, provider_call_sid, from_e164, to_e164, started_at, status) values ($1, $2, $3, $4, '+13475550142', now() - interval '3 minutes', 'IN_PROGRESS') returning id`,
      [r.rid, r.lid, `CAJOB${++n}`, opts.from ?? "+12125550177"]);
    return c.rows[0]!.id;
  });
  let orderId: string | null = null;
  if (opts.order) {
    const o = await confirmedOrder(h, r);
    orderId = o.id;
    await withSystem(h.db, (tx) => tx.query("update orders set call_id = $2 where id = $1", [o.id, id]));
  }
  await withSystem(h.db, async (tx) => void (await endCall(tx, id, "completed", 180)));
  return { id, orderId };
}
const callRow = (id: string) => withSystem(h.db, (tx) => maybeOne<J>(tx, "select status, outcome, summary, caller_name, purge_after, ended_at, from_e164 from calls where id = $1", [id]));

describe("after a call", () => {
  test("a confirmed order that never got sent is sent, and the call is summarised and given an expiry", async () => {
    const { id, orderId } = await endedCall({ order: true });
    await finalizeCall(h.deps, id);
    const o = await withSystem(h.db, (tx) => maybeOne<J>(tx, "select local_status from orders where id = $1", [orderId]));
    assert.equal(o!.local_status, "SUBMITTED_TO_POS");
    const c = (await callRow(id))!;
    assert.equal(c.outcome, "ORDER_SUBMITTED");
    assert.match(c.summary, /Phone order: 1 × Latte \(\$5\.72\)\./);
    assert.equal(c.caller_name, "Priya");
    const days = (new Date(c.purge_after).getTime() - new Date(c.ended_at).getTime()) / 86_400_000;
    assert.equal(Math.round(days), 90, "the default retention");
  });

  test("an unfinished draft is abandoned, and a plain hang-up reads as one", async () => {
    const { id } = await endedCall();
    await finalizeCall(h.deps, id);
    assert.equal((await callRow(id))!.summary, "Caller hung up.");
  });
});

describe("alerts reach people who are not watching the screen", () => {
  const alert = (severity: "INFO" | "WARNING" | "CRITICAL", message = "Something happened") =>
    withSystem(h.db, (tx) => raiseAlert(h.deps, tx, { restaurantId: r.rid, locationId: r.lid, kind: "ORDER_FAILED", severity, message, dedupeKey: `t${++n}` }));

  test("warnings email the owner and managers; critical ones also text the staff numbers that asked", async () => {
    await h.call(maya, "POST", `/locations/${r.lid}/transfer-targets`, { label: "Kitchen", e164: "+13475550103", priority: 1, intent: "GENERAL", activeHours: "ALWAYS", smsAlertOnMiss: true, enabled: true });
    h.email.sent.length = 0;
    await fanOutAlert(h.deps, (await alert("WARNING", "Menu is old"))!);
    assert.deepEqual(h.email.sent.map((m) => m.to).sort(), [jordan.email, maya.email].sort());
    assert.equal(h.twilio.sms.length, 0);
    h.email.sent.length = 0;
    const critical = (await alert("CRITICAL", "An order may be lost"))!;
    await fanOutAlert(h.deps, critical);
    assert.equal(h.email.sent.length, 2);
    assert.deepEqual(h.twilio.sms.map((s) => s.to), ["+13475550103"]);
    assert.match(h.twilio.sms[0]!.body, /An order may be lost/);
    await fanOutAlert(h.deps, critical);
    assert.equal(h.email.sent.length, 2, "an alert is sent once");
  });

  test("information-level alerts stay on the dashboard", async () => {
    h.email.sent.length = 0;
    await fanOutAlert(h.deps, (await alert("INFO"))!);
    assert.equal(h.email.sent.length, 0);
  });
});

describe("retention and privacy", () => {
  test("expired call details are deleted, the call itself stays for the numbers, and the order keeps its items", async () => {
    const { id, orderId } = await endedCall({ order: true, from: "+12125550166" });
    await finalizeCall(h.deps, id);
    await withSystem(h.db, async (tx) => {
      await tx.query("insert into call_transcripts (call_id, restaurant_id, segments) values ($1, $2, '[{\"speaker\":\"CALLER\",\"text\":\"hi\",\"at_ms\":0}]')", [id, r.rid]);
      await tx.query("insert into call_events (restaurant_id, call_id, seq, event_type, actor_type) values ($1, $2, 90, 'tool.search_menu', 'AI')", [r.rid, id]);
    });
    assert.equal((await purgeExpired(h.deps)).transcripts, 0, "nothing is due yet");
    h.setNow(new Date(Date.now() + 91 * 86_400_000));
    const result = await purgeExpired(h.deps);
    h.setNow(null);
    assert.ok(result.transcripts >= 1 && result.events >= 1 && result.calls_anonymised >= 1, JSON.stringify(result));
    const c = (await callRow(id))!;
    assert.equal(c.from_e164, null);
    assert.equal(c.caller_name, null);
    assert.equal(c.outcome, "ORDER_SUBMITTED", "the call is still counted");
    const left = await withSystem(h.db, (tx) => maybeOne<J>(tx, "select (select count(*) from call_events where call_id = $1)::int as events, (select count(*) from call_transcripts where call_id = $1)::int as transcripts", [id]));
    assert.deepEqual([left!.events, left!.transcripts], [0, 0]);
    const o = await withSystem(h.db, (tx) => maybeOne<J>(tx, "select local_status from orders where id = $1", [orderId]));
    assert.equal(o!.local_status, "SUBMITTED_TO_POS");
  });

  test("the application role itself still cannot delete from the append-only tables", async () => {
    const { withTenant } = await import("@receptionist/db");
    await assert.rejects(withTenant(h.db, { restaurantId: r.rid }, (tx) => tx.query("delete from call_events")), /permission denied/);
    await assert.rejects(withTenant(h.db, { restaurantId: r.rid }, (tx) => tx.query("delete from audit_logs")), /permission denied/);
  });

  test("erasing a phone number removes the person from calls, callbacks and orders, and says what it did", async () => {
    const phone = "+12125550101"; // the number confirmedOrder gives its customer
    const { id, orderId } = await endedCall({ order: true, from: phone });
    await withSystem(h.db, async (tx) => {
      await tx.query("insert into callback_requests (restaurant_id, location_id, call_id, customer_name, phone_e164, reason) values ($1, $2, $3, 'Dana', $4, 'Asked about catering')", [r.rid, r.lid, id, phone]);
    });
    await finalizeCall(h.deps, id);
    assert.equal((await h.call(newUser("Nobody"), "POST", `/restaurants/${r.rid}/privacy/erase`, { phone })).status, 404);
    assert.equal((await h.call(jordan, "POST", `/restaurants/${r.rid}/privacy/erase`, { phone })).status, 403, "owner only");
    const res = await h.call(maya, "POST", `/restaurants/${r.rid}/privacy/erase`, { phone });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.calls >= 1 && res.body.callbacks >= 1 && res.body.orders >= 1);
    const c = (await callRow(id))!;
    assert.deepEqual([c.from_e164, c.caller_name, c.summary], [null, null, null]);
    const cb = await withSystem(h.db, (tx) => many<J>(tx, "select customer_name, phone_e164, reason from callback_requests where call_id = $1", [id]));
    assert.deepEqual(cb[0], { customer_name: "Erased", phone_e164: "+10000000000", reason: null });
    const o = await withSystem(h.db, (tx) => maybeOne<J>(tx, "select customer_name, customer_phone_e164, local_status from orders where id = $1", [orderId]));
    assert.deepEqual([o!.customer_name, o!.customer_phone_e164], ["Erased", "+10000000000"]);
    assert.equal(o!.local_status, "SUBMITTED_TO_POS", "even a sent order can lose the person's details");
    const log = (await h.call(maya, "GET", `/restaurants/${r.rid}/audit-log`)).body.items.find((e: J) => e.action === "privacy.erase");
    assert.ok(log);
    assert.ok(!JSON.stringify(log).includes("555"), "the audit entry doesn't repeat the number");
  });
});

describe("keeping Square healthy", () => {
  test("a stale menu raises one alert and stops being stale once a sync lands", async () => {
    h.setNow(new Date(Date.now() + 3 * 3_600_000));
    await withSystem(h.db, (tx) => tx.query("update catalog_syncs set finished_at = now() - interval '3 hours', started_at = now() - interval '3 hours' where location_id = $1", [r.lid]));
    assert.equal(await flagStaleMenus(h.deps), 1);
    assert.equal(await flagStaleMenus(h.deps), 1);
    const open = await withSystem(h.db, (tx) => many<J>(tx, "select kind from alerts where location_id = $1 and kind = 'CATALOG_STALE' and acknowledged_at is null", [r.lid]));
    assert.equal(open.length, 1, "raised once, not every five minutes");
    h.setNow(null);
    h.jobs.pending.length = 0;
    await h.jobs.enqueue("catalog.sync", { locationId: r.lid, kind: "FULL", trigger: "SCHEDULE" });
    await h.jobs.drain();
    const after = await withSystem(h.db, (tx) => many<J>(tx, "select kind from alerts where location_id = $1 and kind = 'CATALOG_STALE' and acknowledged_at is null", [r.lid]));
    assert.equal(after.length, 0, "a good sync clears it");
  });

  test("the safety-net job queues one catch-up sync per connected location", async () => {
    h.jobs.pending.length = 0;
    assert.equal(await reconcileCatalogs(h.deps), 1);
    await reconcileCatalogs(h.deps);
    assert.deepEqual(h.jobs.names(), ["catalog.sync"], "queued once even if it runs twice");
  });

  test("tokens close to expiry are renewed, and a refused renewal switches Square ordering off with an alert", async () => {
    const before = await withSystem(h.db, (tx) => maybeOne<J>(tx, "select access_token_ct from pos_integrations where location_id = $1", [r.lid]));
    await withSystem(h.db, (tx) => tx.query("update pos_integrations set token_expires_at = now() + interval '3 days' where location_id = $1", [r.lid]));
    assert.equal(await renewTokens(h.deps), 1);
    const renewed = await withSystem(h.db, (tx) => maybeOne<J>(tx, "select access_token_ct, token_expires_at from pos_integrations where location_id = $1", [r.lid]));
    assert.notDeepEqual(renewed!.access_token_ct, before!.access_token_ct);
    assert.ok(new Date(renewed!.token_expires_at).getTime() > Date.now() + 20 * 86_400_000);

    h.square!.refreshTokens.clear();
    await withSystem(h.db, (tx) => tx.query("update pos_integrations set token_expires_at = now() + interval '1 day' where location_id = $1", [r.lid]));
    assert.equal(await renewTokens(h.deps), 0);
    assert.equal((await h.call(maya, "GET", `/locations/${r.lid}/integrations`)).body.status, "NEEDS_REAUTH");
    assert.equal((await h.call(maya, "GET", `/locations/${r.lid}`)).body.orderingMode, "DISABLED");
    assert.ok((await h.call(maya, "GET", `/locations/${r.lid}/alerts`)).body.some((a: J) => a.kind === "POS_AUTH_EXPIRED" && a.severity === "CRITICAL"));
  });
});
