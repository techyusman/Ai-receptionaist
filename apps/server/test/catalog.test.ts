import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { many, withSystem } from "@receptionist/db";
import { validateSelection } from "@receptionist/domain";
import { thirdSpaceCatalog, SAMPLE_SQUARE_LOCATION } from "../src/dev/third-space-catalog.ts";
import { applyCatalog } from "../src/menu/apply.ts";
import { parseCatalog } from "../src/menu/parse.ts";
import { loadMenu } from "../src/menu/read.ts";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
let rid: string;
let lid: string;

const sync = (objects = thirdSpaceCatalog(), full = true) =>
  withSystem(h.db, (tx) => applyCatalog(tx, { restaurantId: rid, locationId: lid, parsed: parseCatalog(objects, SAMPLE_SQUARE_LOCATION, "USD"), full, at: new Date("2026-10-20T12:00:00Z") }));
const count = async (table: string, where = "not is_deleted") => (await withSystem(h.db, (tx) => many<{ n: number }>(tx, `select count(*)::int as n from ${table} where location_id = $1 and ${where}`, [lid])))[0]!.n;

before(async () => {
  h = await startHarness();
  ({ restaurantId: rid, locationId: lid } = await signUp(h, maya, "Third Space"));
});
after(async () => {
  await h.stop();
});

describe("catalog sync", () => {
  test("loads items, variations, modifier lists and nested lists from Square-shaped objects", async () => {
    const r = await sync();
    assert.ok(r.upserted > 40);
    assert.equal(await count("menu_items"), 11);
    assert.equal(await count("menu_variations"), 14);
    assert.equal(await count("modifier_lists"), 7);
    assert.equal(await count("menu_categories"), 4);
    const nested = await withSystem(h.db, (tx) => many(tx, `select 1 from modifier_child_lists c join modifiers m on m.id = c.modifier_id where m.name = 'Avocado'`));
    assert.equal(nested.length, 1, "Avocado opens the Avocado style list");
  });

  test("running the same sync again changes nothing", async () => {
    const before = await withSystem(h.db, (tx) => many<{ id: string }>(tx, "select id from menu_items where location_id = $1 order by square_id", [lid]));
    const r = await sync();
    assert.equal(r.deleted, 0);
    const after = await withSystem(h.db, (tx) => many<{ id: string }>(tx, "select id from menu_items where location_id = $1 order by square_id", [lid]));
    assert.deepEqual(after, before, "row ids are stable across syncs");
    assert.equal(await count("menu_items"), 11);
  });

  test("the read model matches the domain Menu and validates a real order selection", async () => {
    const menu = await withSystem(h.db, (tx) => loadMenu(tx, lid));
    assert.equal(menu.currency, "USD");
    const latte = menu.items.find((i) => i.name === "Latte")!;
    assert.equal(latte.variations.length, 2);
    const milk = Object.values(menu.lists).find((l) => l.name === "Milk")!;
    const missing = validateSelection(menu, { itemId: latte.id, variationId: latte.variations[0]!.id, quantity: 1, modifiers: [] }, new Date());
    assert.ok(missing.some((p) => p.code === "TOO_FEW"), "milk is required");
    const ok = validateSelection(menu, { itemId: latte.id, variationId: latte.variations[0]!.id, quantity: 1, modifiers: [{ listId: milk.id, optionId: milk.options[1]!.id }] }, new Date());
    assert.deepEqual(ok, []);
    const pumpkin = menu.items.find((i) => i.name === "Pumpkin Loaf")!;
    assert.equal(pumpkin.variations[0]!.soldOut, true, "Square's sold-out override is carried over");
    const sandwich = menu.items.find((i) => i.name === "Breakfast Sandwich")!;
    const addons = Object.values(menu.lists).find((l) => l.name === "Add-ons")!;
    const avocado = addons.options.find((o) => o.name === "Avocado")!;
    assert.equal(avocado.childListIds.length, 1);
    assert.ok(sandwich.lists.length === 3);
  });

  test("the restaurant's own overlay survives a re-sync", async () => {
    const menu = (await h.call(maya, "GET", `/locations/${lid}/menu`)).body;
    const cider = menu.items.find((i: { name: string }) => i.name === "Spiced Cider");
    const hide = await h.call(maya, "PATCH", `/menu-items/${cider.id}/overlay`, { aiHidden: true });
    assert.equal(hide.status, 200);
    await sync();
    const after = (await h.call(maya, "GET", `/locations/${lid}/menu`)).body.items.find((i: { name: string }) => i.name === "Spiced Cider");
    assert.equal(after.aiHidden, true);
  });

  test("a full sync removes what Square no longer returns; an incremental sync applies explicit deletions", async () => {
    const without = thirdSpaceCatalog().filter((o) => o.id !== "I_CIDER" && o.id !== "V_CIDER");
    const withVarOfCider = thirdSpaceCatalog().filter((o) => o.id === "I_CIDER");
    void withVarOfCider;
    const r = await sync(without, true);
    assert.ok(r.deleted >= 1);
    assert.equal(await count("menu_items"), 10);
    // Bring it back, then delete the latte with an incremental event.
    await sync();
    assert.equal(await count("menu_items"), 11);
    const del = await sync([{ type: "ITEM", id: "I_LATTE", is_deleted: true, version: 2, present_at_all_locations: true }], false);
    assert.equal(del.deleted, 1);
    assert.equal(await count("menu_items"), 10);
    const menu = await withSystem(h.db, (tx) => loadMenu(tx, lid));
    assert.ok(menu.items.find((i) => i.name === "Latte")?.deleted, "the deleted item stays on file for order history but is marked deleted");
    await sync();
  });

  test("an item that only exists at another Square location is ignored", async () => {
    const other = thirdSpaceCatalog().map((o) => (o.id === "I_ALMOND" ? { ...o, present_at_all_locations: false, present_at_location_ids: ["LOTHER"] } : o));
    await sync(other, true);
    const almond = (await withSystem(h.db, (tx) => loadMenu(tx, lid))).items.find((i) => i.name === "Almond Croissant");
    assert.ok(!almond || almond.deleted);
    await sync();
  });
});

describe("aliases", () => {
  test("a spoken name can be added, clashes are refused, and it can be removed", async () => {
    const menu = (await h.call(maya, "GET", `/locations/${lid}/menu`)).body;
    const latte = menu.items.find((i: { name: string }) => i.name === "Latte");
    const chai = menu.items.find((i: { name: string }) => i.name === "Chai Latte");
    assert.equal((await h.call(maya, "POST", `/locations/${lid}/menu/aliases`, { itemId: latte.id, phrase: "flat white-ish" })).status, 201);
    const clash = await h.call(maya, "POST", `/locations/${lid}/menu/aliases`, { itemId: chai.id, phrase: "flat white-ish" });
    assert.equal(clash.status, 409);
    assert.match(clash.body.error.message, /already means Latte/);
    const nameClash = await h.call(maya, "POST", `/locations/${lid}/menu/aliases`, { itemId: chai.id, phrase: "latte" });
    assert.equal(nameClash.status, 409);
    const del = await h.app.inject({ method: "DELETE", url: `/api/v1/locations/${lid}/menu/aliases?itemId=${latte.id}&phrase=${encodeURIComponent("flat white-ish")}`, headers: { authorization: `Bearer ${await h.token(maya)}` } });
    assert.equal(del.statusCode, 204);
    const again = (await h.call(maya, "GET", `/locations/${lid}/menu`)).body.items.find((i: { name: string }) => i.name === "Latte");
    assert.ok(!again.aliases.includes("flat white-ish"));
  });
});
