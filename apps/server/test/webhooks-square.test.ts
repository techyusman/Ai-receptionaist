import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { many, withSystem } from "@receptionist/db";
import { submitConfirmedOrder } from "../src/pos/submit.ts";
import { squareSignature } from "../src/webhooks/square.ts";
import { confirmedOrder, squareReady, type Ready } from "./fixtures.ts";
import { newUser, startHarness, type Harness } from "./harness.ts";

let h: Harness;
let r: Ready;
const maya = newUser("Maya Owner");
const KEY = "square-signature-key";
const URL_ = "https://api.example.test/webhooks/square";
let n = 0;

const event = (type: string, data: Record<string, unknown> = {}, id = `evt-${++n}`) => ({ merchant_id: "MSAMPLE", type, event_id: id, created_at: new Date().toISOString(), data: { type: "x", id: "obj", object: data } });
async function deliver(body: object, opts: { key?: string; url?: string; header?: string | null; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const sig = opts.header === null ? undefined : (opts.header ?? squareSignature(opts.key ?? KEY, opts.url ?? URL_, raw));
  return h.app.inject({ method: "POST", url: "/webhooks/square", headers: { "content-type": "application/json", ...(sig ? { "x-square-hmacsha256-signature": sig } : {}) }, payload: raw });
}
const events = () => withSystem(h.db, (tx) => many<{ provider_event_id: string; processing_status: string }>(tx, "select provider_event_id, processing_status from webhook_events order by received_at"));

before(async () => {
  h = await startHarness({ square: true });
  r = await squareReady(h, maya, "Third Space");
  h.jobs.pending.length = 0;
});
after(async () => {
  await h.stop();
});

describe("signature checks", () => {
  test("a correctly signed delivery is stored and queued", async () => {
    const res = await deliver(event("catalog.version.updated", { catalog_version: { updated_at: "2026-10-02T00:00:00Z" } }, "evt-ok"));
    assert.equal(res.statusCode, 200);
    assert.deepEqual((await events()).map((e) => e.provider_event_id), ["evt-ok"]);
    assert.deepEqual(h.jobs.names(), ["webhook.process"]);
  });

  test("a wrong key, a wrong URL, a missing header and a tampered body are all refused and leave no trace", async () => {
    const before = (await events()).length;
    const body = event("catalog.version.updated");
    assert.equal((await deliver(body, { key: "someone-elses-key" })).statusCode, 403);
    assert.equal((await deliver(body, { url: "http://localhost/webhooks/square" })).statusCode, 403, "signed over the request URL instead of the configured one");
    assert.equal((await deliver(body, { header: null })).statusCode, 403);
    const raw = JSON.stringify(body);
    const sig = squareSignature(KEY, URL_, raw);
    assert.equal((await deliver(body, { raw: raw.replace("MSAMPLE", "MOTHER"), header: sig })).statusCode, 403);
    assert.equal((await events()).length, before, "a forged delivery cannot claim an event id");
  });

  test("a repeated event id is acknowledged but processed once", async () => {
    const body = event("catalog.version.updated", {}, "evt-dup");
    const first = await deliver(body);
    const second = await deliver(body);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(JSON.parse(second.body).duplicate, true);
    assert.equal((await events()).filter((e) => e.provider_event_id === "evt-dup").length, 1);
  });
});

describe("processing", () => {
  test("a burst of catalog changes becomes a single debounced incremental sync", async () => {
    h.jobs.pending.length = 0;
    for (let i = 0; i < 4; i++) await deliver(event("catalog.version.updated", { catalog_version: { updated_at: "2026-10-03T00:00:00Z" } }));
    await h.jobs.drain(4);
    const syncs = h.jobs.pending.filter((j) => j.name === "catalog.sync");
    assert.equal(syncs.length, 1, "four webhooks, one sync");
    assert.equal((syncs[0]!.data as { kind: string }).kind, "INCREMENTAL");
    assert.ok(syncs[0]!.options.delaySeconds! >= 20);
  });

  test("Square showing an order as reserved marks it received by the restaurant", async () => {
    const order = await confirmedOrder(h, r);
    const sent = await submitConfirmedOrder(h.deps, order.id);
    const squareId = sent.order.posOrderId!;
    h.square!.orders.get(squareId)!.fulfillments = [{ uid: "f1", type: "PICKUP", state: "RESERVED" }];
    await deliver(event("order.fulfillment.updated", { order_fulfillment_updated: { order_id: squareId, location_id: "LSAMPLE0000001", state: "OPEN", version: 2 } }));
    h.jobs.pending.splice(0, h.jobs.pending.length, ...h.jobs.pending.filter((j) => j.name === "webhook.process"));
    await h.jobs.drain();
    const detail = (await h.call(maya, "GET", `/orders/${order.id}`)).body;
    assert.equal(detail.status, "RECEIVED_BY_RESTAURANT");
    assert.equal(detail.events.at(-1).actor, "WEBHOOK");
  });

  test("an update for an order we never sent is ignored, and so is an unknown event type", async () => {
    await deliver(event("order.updated", { order_updated: { order_id: "SOMEONE-ELSES", location_id: "L1", state: "OPEN", version: 1 } }));
    await deliver(event("customer.created", {}));
    await h.jobs.drain();
    const rows = await events();
    assert.ok(rows.slice(-2).every((e) => e.processing_status === "IGNORED"), JSON.stringify(rows.slice(-2)));
  });

  test("revoking access at Square disconnects the restaurant, pauses Square ordering and raises an alert", async () => {
    const loc = (await h.call(maya, "GET", `/locations/${r.lid}`)).body;
    assert.equal(loc.orderingMode, "SQUARE");
    await deliver(event("oauth.authorization.revoked", { revocation_type: "MERCHANT_REVOKED" }));
    await h.jobs.drain();
    const integ = (await h.call(maya, "GET", `/locations/${r.lid}/integrations`)).body;
    assert.equal(integ.status, "REVOKED");
    assert.equal((await h.call(maya, "GET", `/locations/${r.lid}`)).body.orderingMode, "DISABLED");
    const alerts = (await h.call(maya, "GET", `/locations/${r.lid}/alerts`)).body;
    assert.ok(alerts.some((a: { kind: string; severity: string }) => a.kind === "POS_REVOKED" && a.severity === "CRITICAL"));
  });
});
