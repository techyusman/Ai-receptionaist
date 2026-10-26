// The second sample restaurant's menu (Tandoor & Crust) is there to exercise every kind of choice. These
// tests hold it to that, through the same parse, apply and rules the AI uses.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { withSystem } from "@receptionist/db";
import { itemAvailability, searchMenu, validateSelection, type Menu, type MenuItem } from "@receptionist/domain";
import { tandoorCrustCatalog, TANDOOR_SQUARE_LOCATION } from "../src/dev/tandoor-crust-catalog.ts";
import { thirdSpaceCatalog } from "../src/dev/third-space-catalog.ts";
import { applyCatalog } from "../src/menu/apply.ts";
import { parseCatalog } from "../src/menu/parse.ts";
import { loadMenu } from "../src/menu/read.ts";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
let menu: Menu;
const at = new Date("2026-10-26T18:00:00Z");

before(async () => {
  h = await startHarness();
  const { restaurantId, locationId } = await signUp(h, newUser("Ali Owner"), "Tandoor & Crust");
  // Both sample menus share one Square stand-in; this location must get only its own.
  const parsed = parseCatalog([...thirdSpaceCatalog(), ...tandoorCrustCatalog()], TANDOOR_SQUARE_LOCATION, "PKR");
  await withSystem(h.db, (tx) => applyCatalog(tx, { restaurantId, locationId, parsed, full: true, at }));
  menu = await withSystem(h.db, (tx) => loadMenu(tx, locationId));
});
after(async () => {
  await h.stop();
});

const named = (name: string): MenuItem => {
  const item = menu.items.find((i) => i.name === name);
  assert.ok(item, `no ${name} on the menu`);
  return item;
};
const listId = (name: string) => Object.values(menu.lists).find((l) => l.name === name)!.id;
const option = (list: string, name: string) => menu.lists[listId(list)]!.options.find((o) => o.name === name)!.id;

test("38 items in rupees, and none of the café's", () => {
  assert.equal(menu.items.filter((i) => !i.deleted).length, 38);
  assert.equal(named("Zinger Burger").variations[0]!.priceMinor, 65000, "Rs 650");
  assert.equal(menu.items.find((i) => i.name === "Latte"), undefined);
});

test("a karahi needs a size and a spice level; the sold-out full size can't be chosen", () => {
  const karahi = named("Mutton Karahi");
  const half = karahi.variations.find((v) => v.name === "Half")!;
  const full = karahi.variations.find((v) => v.name === "Full")!;
  assert.equal(full.soldOut, true);
  const noSpice = validateSelection(menu, { itemId: karahi.id, variationId: half.id, quantity: 1, modifiers: [] }, at);
  assert.match(noSpice[0]!.message, /spice level/i);
  const ok = validateSelection(menu, { itemId: karahi.id, variationId: half.id, quantity: 1, modifiers: [{ listId: listId("Spice level"), optionId: option("Spice level", "Medium") }] }, at);
  assert.deepEqual(ok, []);
  assert.ok(validateSelection(menu, { itemId: karahi.id, variationId: full.id, quantity: 1, modifiers: [{ listId: listId("Spice level"), optionId: option("Spice level", "Hot") }] }, at).length > 0);
});

test("a meal deal then asks which drink; pizza toppings stop at five", () => {
  const burger = named("Smash Burger");
  const single = burger.variations.find((v) => v.name === "Single")!;
  const meal = { listId: listId("Make it a meal"), optionId: option("Make it a meal", "Meal with fries and a drink") };
  const noDrink = validateSelection(menu, { itemId: burger.id, variationId: single.id, quantity: 1, modifiers: [meal] }, at);
  assert.match(noDrink[0]!.message, /meal drink/i);
  const drink = { listId: listId("Meal drink"), optionId: option("Meal drink", "Mango lassi"), parentOptionId: meal.optionId };
  assert.deepEqual(validateSelection(menu, { itemId: burger.id, variationId: single.id, quantity: 1, modifiers: [meal, drink] }, at), []);

  const pizza = named("Margherita Pizza");
  const large = pizza.variations.find((v) => v.name === "Large 14 inch")!;
  const crust = { listId: listId("Crust"), optionId: option("Crust", "Thin crust") };
  const six = menu.lists[listId("Extra toppings")]!.options.slice(0, 6).map((o) => ({ listId: listId("Extra toppings"), optionId: o.id }));
  assert.match(validateSelection(menu, { itemId: pizza.id, variationId: large.id, quantity: 1, modifiers: [crust, ...six] }, at)[0]!.message, /at most 5/i);
});

test("the sold-out nihari and the catering tray with no fixed price are never offered", () => {
  assert.equal(itemAvailability(named("Beef Nihari"), at).orderable, false);
  assert.equal(searchMenu(menu, "nihari", at).length, 0);
  assert.equal(named("Biryani Tray").variations[0]!.priceMinor, null);
  assert.ok(!searchMenu(menu, "biryani tray", at).some((c) => c.item.name === "Biryani Tray"), "a tray with no price can't be ordered by phone");
  assert.ok(searchMenu(menu, "biryani", at).some((c) => c.item.name === "Biryani"));
});
