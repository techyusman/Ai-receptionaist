import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { withSystem } from "@receptionist/db";
import { thirdSpaceCatalog, SAMPLE_SQUARE_LOCATION } from "../src/dev/third-space-catalog.ts";
import { applyCatalog } from "../src/menu/apply.ts";
import { parseCatalog } from "../src/menu/parse.ts";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
const sam = newUser("Sam Staff");
let rid: string;
let lid: string;
type J = Record<string, any>;

before(async () => {
  h = await startHarness();
  ({ restaurantId: rid, locationId: lid } = await signUp(h, maya, "Third Space"));
  await withSystem(h.db, (tx) => applyCatalog(tx, { restaurantId: rid, locationId: lid, parsed: parseCatalog(thirdSpaceCatalog(), SAMPLE_SQUARE_LOCATION, "USD"), full: true, at: new Date() }));
  await withSystem(h.db, (tx) => tx.query("insert into catalog_syncs (restaurant_id, location_id, kind, trigger, status, finished_at) values ($1, $2, 'FULL', 'MANUAL', 'SUCCEEDED', now())", [rid, lid]));
  await h.call(maya, "PATCH", `/locations/${lid}/ordering`, { mode: "DASHBOARD_TICKET", feasibility: "FALLBACK_APPROVED", note: "approved" });
  await withSystem(h.db, (tx) => tx.query("update locations set estimate_tax_rate_percent = 8.875 where id = $1", [lid]));
  await h.call(maya, "POST", `/restaurants/${rid}/invitations`, { email: sam.email, role: "STAFF" });
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.email.sent.at(-1)!.text)![1]!);
  await h.call(sam, "POST", "/invitations/accept", { token });
});
after(async () => {
  await h.stop();
});

const base = () => `/locations/${lid}/test-agent`;

describe("the dashboard test call", () => {
  test("walks an order from search to a ticket on the Live orders board, flagged as a test", async () => {
    const found = (await h.call(maya, "GET", `${base()}/search?q=latte`)).body as J[];
    const latte = found[0]!;
    const small = latte.variations.find((v: J) => v.name === "Small");
    const menu = (await h.call(maya, "GET", `/locations/${lid}/menu`)).body;
    const milk = Object.values(menu.lists as Record<string, J>).find((l) => l.name === "Milk")!;
    const start = await h.call(maya, "POST", `${base()}/calls`);
    assert.equal(start.status, 201);
    const oid = start.body.orderId;

    const missing = await h.call(maya, "POST", `${base()}/orders/${oid}/lines`, { itemId: latte.itemId, variationId: small.id, quantity: 1, modifiers: [] });
    assert.equal(missing.body.problems[0].code, "TOO_FEW");
    const added = await h.call(maya, "POST", `${base()}/orders/${oid}/lines`, { itemId: latte.itemId, variationId: small.id, quantity: 1, modifiers: [{ listId: milk.id, optionId: milk.options[1].id }] });
    assert.deepEqual(added.body.problems, []);

    assert.equal((await h.call(maya, "POST", `${base()}/orders/${oid}/read-back`)).status, 422, "name and number first");
    assert.equal((await h.call(maya, "PUT", `${base()}/orders/${oid}/customer`, { name: "Priya", phone: "212 555" })).status, 422);
    assert.equal((await h.call(maya, "PUT", `${base()}/orders/${oid}/customer`, { name: "Priya", phone: "212 555 0143" })).status, 200);
    const rb = await h.call(maya, "POST", `${base()}/orders/${oid}/read-back`);
    assert.equal(rb.status, 200, JSON.stringify(rb.body));
    assert.equal(rb.body.totals.source, "ESTIMATE");
    assert.equal(rb.body.totals.totalMinor, 450 + 75 + 47);

    assert.equal((await h.call(maya, "POST", `${base()}/orders/${oid}/confirm`, { version: rb.body.version - 1 })).status, 422, "a stale yes");
    assert.equal((await h.call(maya, "POST", `${base()}/orders/${oid}/confirm`, { version: rb.body.version })).status, 200);
    const sent = await h.call(maya, "POST", `${base()}/orders/${oid}/submit`);
    assert.equal(sent.body.claim, "SENT_NOT_ACKNOWLEDGED");

    const live = (await h.call(sam, "GET", `/locations/${lid}/live-tickets`)).body;
    const ticket = live.find((t: J) => t.id === oid);
    assert.equal(ticket.isTest, true);
    assert.equal((await h.call(sam, "POST", `/orders/${oid}/accept`)).status, 200);

    assert.equal((await h.call(maya, "POST", `${base()}/orders/${oid}/hang-up`)).status, 200);
    const calls = (await h.call(maya, "GET", `/locations/${lid}/calls`)).body.items;
    const call = calls.find((c: J) => c.orderId === oid);
    assert.equal(call.isTest, true);
    assert.equal(call.outcome, "ORDER_SUBMITTED");
    assert.equal(call.callerName, "Priya");
    const analytics = (await h.call(maya, "GET", `/locations/${lid}/analytics?range=7d`)).body;
    assert.equal(analytics.calls, 0, "test calls are not counted in analytics");
    assert.equal(analytics.orders, 0);
  });

  test("staff cannot run test calls, and one location's test order isn't reachable from another", async () => {
    assert.equal((await h.call(sam, "POST", `${base()}/calls`)).status, 403);
    const other = newUser("Other Owner");
    const o = await signUp(h, other, "Other Cafe");
    const start = await h.call(maya, "POST", `${base()}/calls`);
    const wrong = await h.call(other, "POST", `/locations/${o.locationId}/test-agent/orders/${start.body.orderId}/read-back`);
    assert.equal(wrong.status, 404);
  });

  test("hanging up part-way abandons the draft and ends the call with an outcome", async () => {
    const start = await h.call(maya, "POST", `${base()}/calls`);
    await h.call(maya, "POST", `${base()}/orders/${start.body.orderId}/hang-up`);
    const order = (await h.call(maya, "GET", `/orders/${start.body.orderId}`)).body;
    assert.equal(order.status, "ABANDONED");
    const calls = (await h.call(maya, "GET", `/locations/${lid}/calls`)).body.items;
    assert.equal(calls.find((c: J) => c.orderId === start.body.orderId).outcome, "CALLER_HUNG_UP");
  });
});
