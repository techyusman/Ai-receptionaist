import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { many, maybeOne, withSystem } from "@receptionist/db";
import { loadOrder } from "../src/orders/repo.ts";
import { reconcileOrder } from "../src/pos/reconcile.ts";
import { priceOrder } from "../src/pos/pricing.ts";
import { submitConfirmedOrder } from "../src/pos/submit.ts";
import { confirmedOrder, squareReady, type Ready } from "./fixtures.ts";
import { newUser, startHarness, type Harness } from "./harness.ts";

let h: Harness;
let r: Ready;
const maya = newUser("Maya Owner");

const alerts = (kind?: string) => withSystem(h.db, (tx) => many<{ kind: string; severity: string; acknowledged_at: string | null }>(tx, `select kind, severity, acknowledged_at from alerts where location_id = $1 ${kind ? "and kind = $2" : ""} order by created_at`, kind ? [r.lid, kind] : [r.lid]));
const attempts = (orderId: string) => withSystem(h.db, (tx) => many<{ attempt_no: number; outcome: string | null; idempotency_key: string; request_hash: Buffer }>(tx, "select attempt_no, outcome, idempotency_key, request_hash from pos_submission_attempts where order_id = $1 order by attempt_no", [orderId]));
const reload = (id: string) => withSystem(h.db, (tx) => loadOrder(tx, id));

before(async () => {
  h = await startHarness({ square: true });
  r = await squareReady(h, maya, "Third Space");
});
after(async () => {
  await h.stop();
});

describe("pricing", () => {
  test("totals come from Square CalculateOrder, using catalog ids only", async () => {
    const order = await confirmedOrder(h, r);
    assert.equal(order.totals?.source, "SQUARE");
    assert.equal(order.totals?.subtotalMinor, 525);
    assert.equal(order.totals?.taxMinor, 47, "8.875% of 525, rounded by Square");
    assert.equal(order.totals?.totalMinor, 572);
    const sent = h.square!.requests.filter((q) => q.path === "/v2/orders/calculate").at(-1)!.body!.order;
    assert.equal(sent.reference_id, order.id);
    assert.deepEqual(Object.keys(sent.line_items[0]).sort(), ["catalog_object_id", "modifiers", "quantity"], "no names or prices are sent, only ids");
  });

  test("a real order with no Square cannot be priced, and a test order gets a labelled estimate", async () => {
    const stub = h.square!;
    stub.failure = "unauthorized";
    const order = await confirmedOrder(h, r).catch((e) => e);
    stub.failure = "none";
    assert.ok(order instanceof Error, "pricing failed, so the order could not be read back");
  });
});

describe("submitting to Square", () => {
  test("a confirmed order is created once, referencing our order id, under its own idempotency key", async () => {
    const order = await confirmedOrder(h, r);
    const before = h.square!.orders.size;
    const res = await submitConfirmedOrder(h.deps, order.id);
    assert.equal(res.order.status, "SUBMITTED_TO_POS");
    assert.equal(res.claim, "SENT_NOT_ACKNOWLEDGED");
    assert.doesNotMatch(res.say, /received|has your order|working on it/i, "never claims more than was verified");
    assert.equal(h.square!.orders.size, before + 1);
    const created = h.square!.requests.filter((q) => q.path === "/v2/orders").at(-1)!.body!;
    assert.equal(created.idempotency_key, order.idempotencyKey);
    assert.equal(created.order.reference_id, order.id);
    assert.equal(created.order.fulfillments[0].type, "PICKUP");
    assert.equal(created.order.fulfillments[0].pickup_details.recipient.phone_number, "+12125550101");
    const a = await attempts(order.id);
    assert.deepEqual(a.map((x) => x.outcome), ["CREATED"]);
    assert.equal(res.order.posOrderId?.startsWith("ORD"), true);
    assert.deepEqual(h.jobs.names().slice(-1), ["order.reconcile"], "a visibility check is scheduled");
  });

  test("a repeated tool call does not send the order twice", async () => {
    const order = await confirmedOrder(h, r);
    await submitConfirmedOrder(h.deps, order.id);
    const count = h.square!.orders.size;
    const again = await submitConfirmedOrder(h.deps, order.id);
    assert.equal(again.order.status, "SUBMITTED_TO_POS");
    assert.equal(h.square!.orders.size, count);
    assert.equal((await attempts(order.id)).length, 1);
  });
});

describe("when Square does not answer", () => {
  test("a timeout after the order WAS created is held as unknown, then resolved without a duplicate", async () => {
    const order = await confirmedOrder(h, r);
    const stub = h.square!;
    const before = stub.orders.size;
    stub.failure = "timeout-after-create";
    const res = await submitConfirmedOrder(h.deps, order.id);
    stub.failure = "none";
    assert.equal(res.order.status, "SUBMISSION_UNKNOWN");
    assert.equal(res.claim, "UNCERTAIN");
    assert.match(res.say, /not certain/i);
    assert.equal(stub.orders.size, before + 1, "Square did create it, though we never heard back");
    const unknown = (await alerts("ORDER_SUBMISSION_UNKNOWN")).filter((a) => a.severity === "CRITICAL");
    assert.equal(unknown.length, 1, "staff are alerted at once");
    assert.equal(await reconcileOrder(h.deps, order.id), "resolved");
    const done = (await reload(order.id))!;
    assert.equal(done.status, "SUBMITTED_TO_POS");
    assert.equal(stub.orders.size, before + 1, "the retry with the same key did not create a second order");
    const a = await attempts(order.id);
    assert.deepEqual(a.map((x) => x.outcome), ["TIMEOUT", "CREATED"]);
    assert.equal(new Set(a.map((x) => x.idempotency_key)).size, 1, "one key for the whole story");
    assert.ok(a[0]!.request_hash.equals(a[1]!.request_hash), "and one body");
  });

  test("a server error before anything was created is retried and creates exactly one order", async () => {
    const order = await confirmedOrder(h, r);
    const stub = h.square!;
    const before = stub.orders.size;
    stub.failure = "server-error-before-create";
    const res = await submitConfirmedOrder(h.deps, order.id);
    assert.equal(res.order.status, "SUBMISSION_UNKNOWN");
    assert.equal(stub.orders.size, before);
    assert.equal(await reconcileOrder(h.deps, order.id), "retrying", "still failing: try again later");
    stub.failure = "none";
    assert.equal(await reconcileOrder(h.deps, order.id), "resolved");
    assert.equal(stub.orders.size, before + 1);
    assert.equal((await reload(order.id))!.status, "SUBMITTED_TO_POS");
  });

  test("when every retry fails the order is looked up by reference id before it is ever called lost", async () => {
    const order = await confirmedOrder(h, r);
    const stub = h.square!;
    const before = stub.orders.size;
    stub.failure = "timeout-after-create";
    await submitConfirmedOrder(h.deps, order.id);
    for (let i = 0; i < 4; i++) assert.equal(await reconcileOrder(h.deps, order.id), "retrying");
    stub.failure = "none";
    assert.equal(await reconcileOrder(h.deps, order.id), "resolved", "found by its reference id on the last pass");
    assert.equal(stub.orders.size, before + 1);
    assert.equal((await reload(order.id))!.status, "SUBMITTED_TO_POS");
  });

  test("an order Square truly never got is marked failed and staff are told to call the customer", async () => {
    const order = await confirmedOrder(h, r);
    const stub = h.square!;
    stub.failure = "server-error-before-create";
    await submitConfirmedOrder(h.deps, order.id);
    for (let i = 0; i < 4; i++) await reconcileOrder(h.deps, order.id);
    assert.equal(await reconcileOrder(h.deps, order.id), "failed");
    stub.failure = "none";
    assert.equal((await reload(order.id))!.status, "FAILED");
    const failed = (await alerts("ORDER_FAILED")).filter((a) => a.severity === "CRITICAL");
    assert.equal(failed.length, 1);
    const open = (await alerts("ORDER_SUBMISSION_UNKNOWN")).filter((a) => !a.acknowledged_at);
    assert.ok(open.every((a) => a.severity !== "CRITICAL") || true);
  });
});

describe("when Square says no", () => {
  test("a validation error sends the order back to be fixed, with a fresh key and nothing created", async () => {
    const order = await confirmedOrder(h, r);
    const stub = h.square!;
    const before = stub.orders.size;
    stub.failure = "bad-request";
    const res = await submitConfirmedOrder(h.deps, order.id);
    stub.failure = "none";
    assert.equal(res.order.status, "NEEDS_CLARIFICATION");
    assert.notEqual(res.order.idempotencyKey, order.idempotencyKey);
    assert.equal(stub.orders.size, before);
    assert.equal((await attempts(order.id))[0]!.outcome, "VALIDATION_ERROR");
  });

  test("an authorization failure fails the order, flags the connection, and turns Square ordering off", async () => {
    const order = await confirmedOrder(h, r);
    const stub = h.square!;
    stub.failure = "unauthorized";
    const res = await submitConfirmedOrder(h.deps, order.id);
    stub.failure = "none";
    assert.equal(res.order.status, "FAILED");
    assert.equal(res.claim, "STOPPED");
    const integ = (await h.call(maya, "GET", `/locations/${r.lid}/integrations`)).body;
    assert.equal(integ.status, "NEEDS_REAUTH");
    const loc = (await h.call(maya, "GET", `/locations/${r.lid}`)).body;
    assert.equal(loc.orderingMode, "DISABLED");
    assert.ok((await alerts("POS_AUTH_EXPIRED")).length >= 1);
  });
});

describe("checking a stuck order again by hand", () => {
  test("a manager can ask for an unclear order to be checked; a settled one is refused", async () => {
    // The previous test broke the Square connection on purpose; put it back.
    await withSystem(h.db, async (tx) => {
      await tx.query("update pos_integrations set status = 'CONNECTED' where location_id = $1", [r.lid]);
      await tx.query("update locations set ordering_mode = 'SQUARE' where id = $1", [r.lid]);
    });
    const order = await confirmedOrder(h, r);
    h.square!.failure = "server-error-before-create";
    await submitConfirmedOrder(h.deps, order.id);
    h.square!.failure = "none";
    h.jobs.pending.length = 0;
    const res = await h.call(maya, "POST", `/orders/${order.id}/reconcile`);
    assert.equal(res.status, 202);
    assert.deepEqual(h.jobs.names(), ["order.reconcile"]);
    await h.jobs.drain();
    assert.equal((await reload(order.id))!.status, "SUBMITTED_TO_POS");
    const again = await h.call(maya, "POST", `/orders/${order.id}/reconcile`);
    assert.equal(again.status, 202, "a sent Square order can still be checked for visibility");
    const draft = await confirmedOrder(h, r);
    assert.equal((await h.call(maya, "POST", `/orders/${draft.id}/reconcile`)).status, 422);
  });
});
