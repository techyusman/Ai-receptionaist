import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { many, withSystem, withTenant } from "@receptionist/db";
import { thirdSpaceCatalog, SAMPLE_SQUARE_LOCATION } from "../src/dev/third-space-catalog.ts";
import { applyCatalog } from "../src/menu/apply.ts";
import { parseCatalog } from "../src/menu/parse.ts";
import { loadMenu } from "../src/menu/read.ts";
import { createOrder, updateDraft } from "../src/orders/service.ts";
import { reconcileOrder } from "../src/pos/reconcile.ts";
import { priceOrder } from "../src/pos/pricing.ts";
import { submitConfirmedOrder } from "../src/pos/submit.ts";
import { confirmedOrder, lineFrom, squareReady, type Ready } from "./fixtures.ts";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
const noSquare = newUser("Nora NoSquare");
let ready: Ready;
let plain: Ready;
const AI = { actor: "AI" as const };

before(async () => {
  h = await startHarness({ square: true });
  ready = await squareReady(h, maya, "Third Space");
  // A second restaurant that never connected Square: its menu was loaded by hand.
  const { restaurantId: rid, locationId: lid } = await signUp(h, noSquare, "No Square Cafe");
  await withSystem(h.db, (tx) => applyCatalog(tx, { restaurantId: rid, locationId: lid, parsed: parseCatalog(thirdSpaceCatalog(), SAMPLE_SQUARE_LOCATION, "USD"), full: true, at: new Date() }));
  await h.call(noSquare, "PATCH", `/locations/${lid}/ordering`, { mode: "DASHBOARD_TICKET", feasibility: "FALLBACK_APPROVED", note: "approved" });
  plain = { rid, lid, menu: await withSystem(h.db, (tx) => loadMenu(tx, lid)) };
});
after(async () => {
  await h.stop();
});

const alertKinds = (lid: string) => withSystem(h.db, async (tx) => (await many<{ kind: string }>(tx, "select kind from alerts where location_id = $1", [lid])).map((a) => a.kind));

async function draftOn(r: Ready, isTest: boolean) {
  return withTenant(h.db, { restaurantId: r.rid, actorType: "AI" }, async (tx) => {
    const o = await createOrder(tx, { restaurantId: r.rid, locationId: r.lid, callId: null, isTest, posMode: "DASHBOARD_TICKET", currency: "USD" }, AI);
    return updateDraft(tx, o.id, { op: "add", line: lineFrom(r.menu, "Latte", "Small", { Milk: ["Oat milk"] }) }, AI);
  });
}

describe("pricing without Square", () => {
  test("a real caller is never given an estimate: no Square means no total", async () => {
    const priced = await priceOrder(h.deps, await draftOn(plain, false));
    assert.equal(priced.ok, false);
    assert.equal(priced.ok === false && priced.reason, "NO_PRICING");
  });

  test("a test call gets a labelled estimate using the location's rough tax rate", async () => {
    await withSystem(h.db, (tx) => tx.query("update locations set estimate_tax_rate_percent = 8.875 where id = $1", [plain.lid]));
    const priced = await priceOrder(h.deps, await draftOn(plain, true));
    assert.ok(priced.ok);
    assert.equal(priced.ok && priced.totals.source, "ESTIMATE");
    assert.equal(priced.ok && priced.totals.totalMinor, 525 + 47);
  });
});

describe("dashboard tickets", () => {
  test("submitting puts a ticket on the live queue and alerts staff, and calls nothing external", async () => {
    const order = await confirmedOrder(h, ready, { posMode: "DASHBOARD_TICKET" });
    h.square!.requests.length = 0;
    const res = await submitConfirmedOrder(h.deps, order.id);
    assert.equal(res.order.status, "SUBMITTED_TO_POS");
    assert.equal(res.order.posOrderId, null);
    assert.equal(res.claim, "SENT_NOT_ACKNOWLEDGED");
    assert.match(res.say, /on their screen/);
    assert.equal(h.square!.requests.filter((q) => q.path === "/v2/orders").length, 0, "nothing was sent to Square");
    assert.ok((await alertKinds(ready.lid)).includes("NEW_TICKET"));
    const live = (await h.call(maya, "GET", `/locations/${ready.lid}/live-tickets`)).body;
    assert.ok(live.some((t: { id: string }) => t.id === order.id));
  });

  test("a test order never raises a kitchen alert", async () => {
    const order = await confirmedOrder(h, ready, { posMode: "DASHBOARD_TICKET", isTest: true });
    const before = (await alertKinds(ready.lid)).filter((k) => k === "NEW_TICKET").length;
    const res = await submitConfirmedOrder(h.deps, order.id);
    assert.equal(res.order.status, "SUBMITTED_TO_POS");
    assert.equal((await alertKinds(ready.lid)).filter((k) => k === "NEW_TICKET").length, before);
  });
});

describe("what happens when an item runs out before the order is sent", () => {
  test("the order goes back to the caller instead of being sent", async () => {
    const order = await confirmedOrder(h, ready);
    await withSystem(h.db, (tx) => tx.query("update menu_items set ai_unavailable_until = now() + interval '1 hour' where location_id = $1 and name = 'Latte'", [ready.lid]));
    h.square!.requests.length = 0;
    const res = await submitConfirmedOrder(h.deps, order.id);
    await withSystem(h.db, (tx) => tx.query("update menu_items set ai_unavailable_until = null where location_id = $1 and name = 'Latte'", [ready.lid]));
    assert.equal(res.order.status, "NEEDS_CLARIFICATION");
    assert.equal(res.claim, "NOT_PLACED");
    assert.ok(res.problems?.some((p) => /isn't available/.test(p.message)));
    assert.equal(h.square!.requests.filter((q) => q.path === "/v2/orders").length, 0);
  });

  test("a stale menu blocks submission", async () => {
    const order = await confirmedOrder(h, ready);
    h.setNow(new Date(Date.now() + 3 * 3_600_000));
    const res = await submitConfirmedOrder(h.deps, order.id);
    h.setNow(null);
    assert.equal(res.order.status, "NEEDS_CLARIFICATION");
    assert.match(res.problems![0]!.message, /hasn't updated recently/);
  });
});

describe("was it seen?", () => {
  test("an unacknowledged Square order becomes 'unverified' after five minutes; an acknowledged one is received", async () => {
    const unseen = await confirmedOrder(h, ready);
    const seen = await confirmedOrder(h, ready);
    await submitConfirmedOrder(h.deps, unseen.id);
    const b = await submitConfirmedOrder(h.deps, seen.id);
    assert.equal(await reconcileOrder(h.deps, unseen.id), "retrying", "too soon to worry");
    h.square!.orders.get(b.order.posOrderId!)!.fulfillments = [{ uid: "f1", type: "PICKUP", state: "RESERVED" }];
    assert.equal(await reconcileOrder(h.deps, seen.id), "resolved");
    h.setNow(new Date(Date.now() + 6 * 60_000));
    assert.equal(await reconcileOrder(h.deps, unseen.id), "unverified");
    h.setNow(null);
    const rows = await withSystem(h.db, (tx) => many<{ id: string; local_status: string }>(tx, "select id, local_status from orders where id = any($1::uuid[])", [[unseen.id, seen.id]]));
    assert.equal(rows.find((r) => r.id === unseen.id)!.local_status, "POS_VISIBILITY_UNVERIFIED");
    assert.equal(rows.find((r) => r.id === seen.id)!.local_status, "RECEIVED_BY_RESTAURANT");
  });
});
