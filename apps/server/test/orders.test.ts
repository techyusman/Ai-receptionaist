import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { many, withSystem, withTenant, type Tx } from "@receptionist/db";
import { confirm, readyForConfirmation, startSubmission, submissionSucceeded, subtotal, toOrderLine, validateSelection, type Menu, type Order, type Selection } from "@receptionist/domain";
import { thirdSpaceCatalog, SAMPLE_SQUARE_LOCATION } from "../src/dev/third-space-catalog.ts";
import { applyCatalog } from "../src/menu/apply.ts";
import { parseCatalog } from "../src/menu/parse.ts";
import { loadMenu } from "../src/menu/read.ts";
import { loadOrder } from "../src/orders/repo.ts";
import { createOrder, recordAttemptResult, recordAttemptStart, transition, updateDraft } from "../src/orders/service.ts";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
const sam = newUser("Sam Staff");
let rid: string;
let lid: string;
let menu: Menu;
const AI = { actor: "AI" as const };
const at = () => new Date().toISOString();
const tenant = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(h.db, { restaurantId: rid, userId: maya.id, actorType: "AI" }, fn);

function line(name: string, variation: string, picks: Record<string, string[]> = {}, quantity = 1, parents: Record<string, string> = {}) {
  const item = menu.items.find((i) => i.name === name)!;
  const sel: Selection = {
    itemId: item.id, variationId: item.variations.find((v) => v.name === variation)!.id, quantity,
    modifiers: Object.entries(picks).flatMap(([list, options]) => {
      const l = Object.values(menu.lists).find((x) => x.name === list)!;
      return options.map((o) => {
        const parent = parents[o] ? Object.values(menu.lists).flatMap((pl) => pl.options).find((x) => x.name === parents[o]) : undefined;
        return { listId: l.id, optionId: l.options.find((x) => x.name === o)!.id, ...(parent ? { parentOptionId: parent.id } : {}) };
      });
    }),
  };
  assert.deepEqual(validateSelection(menu, sel, new Date()), []);
  return toOrderLine(menu, sel);
}

async function newDraft(isTest = true): Promise<Order> {
  return tenant((tx) => createOrder(tx, { restaurantId: rid, locationId: lid, callId: null, isTest, posMode: "DASHBOARD_TICKET", currency: "USD" }, AI));
}

before(async () => {
  h = await startHarness();
  ({ restaurantId: rid, locationId: lid } = await signUp(h, maya, "Third Space"));
  await withSystem(h.db, (tx) => applyCatalog(tx, { restaurantId: rid, locationId: lid, parsed: parseCatalog(thirdSpaceCatalog(), SAMPLE_SQUARE_LOCATION, "USD"), full: true, at: new Date() }));
  menu = await withSystem(h.db, (tx) => loadMenu(tx, lid));
  await h.call(maya, "PATCH", `/locations/${lid}/ordering`, { mode: "DASHBOARD_TICKET", feasibility: "FALLBACK_APPROVED", note: "approved" });
  const inv = await h.call(maya, "POST", `/restaurants/${rid}/invitations`, { email: sam.email, role: "STAFF" });
  assert.equal(inv.status, 201);
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.email.sent.at(-1)!.text)![1]!);
  assert.equal((await h.call(sam, "POST", "/invitations/accept", { token })).status, 200);
});
after(async () => {
  await h.stop();
});

/** Drives an order from empty to submitted, the way the voice tools will. */
async function placeOrder(o: Order, source: "ESTIMATE" | "SQUARE" = "ESTIMATE"): Promise<Order> {
  return tenant(async (tx) => {
    let cur = await updateDraft(tx, o.id, { op: "add", line: line("Latte", "Small", { Milk: ["Oat milk"] }) }, AI);
    cur = await updateDraft(tx, o.id, { op: "customer", customer: { name: "Priya", phone: "+12125550101", phoneSource: "SPOKEN" } }, AI);
    const sub = subtotal(cur);
    cur = await transition(tx, o.id, (x) => readyForConfirmation(x, { subtotalMinor: sub, taxMinor: 0, totalMinor: sub, version: x.version, calculatedAt: at(), source }, 0, { actor: "AI", at: at() }), AI);
    cur = await transition(tx, o.id, (x) => confirm(x, x.version, { actor: "AI", at: at() }), AI);
    cur = await transition(tx, o.id, (x) => startSubmission(x, { actor: "SYSTEM", at: at() }), { actor: "SYSTEM" });
    await recordAttemptStart(tx, cur, Buffer.from("hash"));
    await recordAttemptResult(tx, cur.id, cur.submissionAttempts, { outcome: "CREATED" });
    return transition(tx, o.id, (x) => submissionSucceeded(x, { actor: "SYSTEM", at: at() }), { actor: "SYSTEM" });
  });
}

describe("the order lifecycle against Postgres", () => {
  test("a draft becomes a submitted ticket, then staff accept it, and every step is on the timeline", async () => {
    const o = await placeOrder(await newDraft());
    assert.equal(o.status, "SUBMITTED_TO_POS");
    assert.equal(o.lines[0]!.modifiers[0]!.name, "Oat milk");
    assert.equal(o.totals?.totalMinor, 525, "450 for the small latte plus 75 for oat milk");
    assert.equal((await h.call(sam, "POST", `/orders/${o.id}/accept`)).status, 200);
    assert.equal((await h.call(sam, "POST", `/orders/${o.id}/accept`)).status, 200, "a double tap is harmless");
    const detail = (await h.call(sam, "GET", `/orders/${o.id}`)).body;
    assert.equal(detail.status, "RECEIVED_BY_RESTAURANT");
    assert.deepEqual(detail.events.map((e: { to: string }) => e.to), ["DRAFT", "READY_FOR_CONFIRMATION", "CUSTOMER_CONFIRMED", "SUBMISSION_PENDING", "SUBMITTED_TO_POS", "RECEIVED_BY_RESTAURANT"]);
    assert.equal(detail.events.at(-1).actorName, "Sam Staff");
    assert.equal(detail.attempts.length, 1);
    assert.equal(detail.attempts[0].outcome, "CREATED");
  });

  test("F07-N1/N2 staff can't cancel; the owner can, with a reason, and it's on the timeline", async () => {
    const o = await placeOrder(await newDraft());
    assert.equal((await h.call(sam, "POST", `/orders/${o.id}/cancel`, { reason: "Caller asked us to." })).status, 403);
    const short = await h.call(maya, "POST", `/orders/${o.id}/cancel`, { reason: "x" });
    assert.equal(short.status, 400);
    assert.equal(short.body.error.field, "reason");
    const done = await h.call(maya, "POST", `/orders/${o.id}/cancel`, { reason: "Caller asked us to." });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const detail = (await h.call(maya, "GET", `/orders/${o.id}`)).body;
    assert.equal(detail.status, "CANCELLED");
    assert.equal(detail.events.at(-1).reason, "Caller asked us to.");
  });

  test("changing anything after read-back voids the confirmation and the old yes cannot be reused", async () => {
    const o = await newDraft();
    await tenant(async (tx) => {
      await updateDraft(tx, o.id, { op: "add", line: line("Cold Brew", "Regular") }, AI);
      const cur = (await loadOrder(tx, o.id))!;
      const sub = subtotal(cur);
      const ready = await transition(tx, o.id, (x) => readyForConfirmation(x, { subtotalMinor: sub, taxMinor: 0, totalMinor: sub, version: x.version, calculatedAt: at(), source: "ESTIMATE" }, 0, { actor: "AI", at: at() }), AI);
      const edited = await updateDraft(tx, o.id, { op: "add", line: line("Drip Coffee", "Large") }, AI);
      assert.equal(edited.status, "DRAFT", "an edit after read-back sends it back to draft");
      assert.ok(edited.version > ready.version);
      await assert.rejects(transition(tx, o.id, (x) => confirm(x, ready.version, { actor: "AI", at: at() }), AI), /Read the order back|older version/);
    });
  });

  test("a repeated tool call with a stale expected version changes nothing", async () => {
    const o = await newDraft();
    await tenant(async (tx) => {
      const first = await updateDraft(tx, o.id, { op: "add", line: line("Chai Latte", "Regular", { Milk: ["Whole milk"] }) }, AI, o.version);
      await assert.rejects(updateDraft(tx, o.id, { op: "add", line: line("Chai Latte", "Regular", { Milk: ["Whole milk"] }) }, AI, o.version), /Expected version/);
      const after = (await loadOrder(tx, o.id))!;
      assert.equal(after.lines.length, 1);
      assert.equal(after.version, first.version);
    });
  });
});

describe("integrity rules", () => {
  test("submitted content is frozen, in the domain and in the database", async () => {
    const o = await placeOrder(await newDraft());
    await tenant(async (tx) => {
      await assert.rejects(updateDraft(tx, o.id, { op: "add", line: line("Drip Coffee", "Small") }, AI), /can no longer change/);
    });
    await assert.rejects(withSystem(h.db, (tx) => tx.query("update order_items set quantity = 5 where order_id = $1", [o.id])), /can no longer change/);
  });

  test("nested choices keep their parent, and a quantity change updates the line", async () => {
    const o = await newDraft();
    const cur = await tenant(async (tx) => {
      const sandwich = line("Breakfast Sandwich", "Regular", { Bread: ["Sourdough"], Egg: ["Fried egg"], "Add-ons": ["Avocado", "Bacon"], "Avocado style": ["Smashed"] }, 1, { Smashed: "Avocado" });
      await updateDraft(tx, o.id, { op: "add", line: sandwich }, AI);
      return updateDraft(tx, o.id, { op: "quantity", lineNo: 1, quantity: 2 }, AI);
    });
    const mods = cur.lines[0]!.modifiers;
    assert.equal(mods.length, 5);
    const smashed = mods.find((m) => m.name === "Smashed")!;
    const avocado = mods.find((m) => m.name === "Avocado")!;
    assert.equal(smashed.parentModifierId, avocado.modifierId);
    assert.equal(cur.lines[0]!.quantity, 2);
    const rows = await withSystem(h.db, (tx) => many<{ line_total_minor: number }>(tx, "select line_total_minor from order_items where order_id = $1", [o.id]));
    assert.equal(rows[0]!.line_total_minor, (900 + 150 + 200) * 2, "the sandwich, avocado and bacon, times two");
  });

  test("a real order cannot carry an estimate, and a test order can never target Square", async () => {
    const real = await newDraft(false);
    await tenant(async (tx) => {
      await updateDraft(tx, real.id, { op: "add", line: line("Drip Coffee", "Small") }, AI);
      const cur = (await loadOrder(tx, real.id))!;
      await assert.rejects(
        transition(tx, real.id, (x) => readyForConfirmation(x, { subtotalMinor: 300, taxMinor: 0, totalMinor: 300, version: cur.version, calculatedAt: at(), source: "ESTIMATE" }, 0, { actor: "AI", at: at() }), AI),
        /estimate_only_for_tests/,
      );
    });
    await assert.rejects(tenant((tx) => createOrder(tx, { restaurantId: rid, locationId: lid, callId: null, isTest: true, posMode: "SQUARE", currency: "USD" }, AI)), /never go to Square/);
  });
});
