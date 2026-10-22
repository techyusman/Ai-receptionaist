import assert from "node:assert/strict";
import { test } from "node:test";
import { freshness, itemAvailability, rules, searchMenu, toOrderLine, validateSelection, type Menu } from "./menu.ts";

const at = new Date("2026-10-22T16:00:00Z");

const menu: Menu = {
  currency: "USD",
  syncedAt: "2026-10-22T15:50:00Z",
  categories: [{ id: "c1", name: "Coffee", ordinal: 0 }],
  lists: {
    milk: {
      id: "milk", name: "Milk", selectionType: "SINGLE", min: 1, max: 1, deleted: false,
      options: [
        { id: "whole", name: "Whole milk", priceMinor: 0, soldOut: false, deleted: false, onByDefault: true, childListIds: [] },
        { id: "oat", name: "Oat milk", priceMinor: 75, soldOut: false, deleted: false, onByDefault: false, childListIds: ["oatBrand"] },
        { id: "soy", name: "Soy milk", priceMinor: 75, soldOut: true, deleted: false, onByDefault: false, childListIds: [] },
      ],
    },
    oatBrand: {
      id: "oatBrand", name: "Oat brand", selectionType: "SINGLE", min: 1, max: 1, deleted: false,
      options: [{ id: "house", name: "House oat", priceMinor: 0, soldOut: false, deleted: false, onByDefault: false, childListIds: [] }],
    },
    extras: {
      id: "extras", name: "Extras", selectionType: "MULTIPLE", min: null, max: 2, deleted: false,
      options: [
        { id: "shot", name: "Extra shot", priceMinor: 100, soldOut: false, deleted: false, onByDefault: false, childListIds: [] },
        { id: "syrup", name: "Vanilla syrup", priceMinor: 60, soldOut: false, deleted: false, onByDefault: false, childListIds: [] },
        { id: "cream", name: "Whipped cream", priceMinor: 50, soldOut: false, deleted: false, onByDefault: false, childListIds: [] },
      ],
    },
  },
  items: [
    {
      id: "latte", name: "Latte", description: null, categoryId: "c1", aiHidden: false, aiUnavailableUntil: null, deleted: false,
      aliases: ["cafe latte"],
      variations: [
        { id: "small", name: "Small", pricingType: "FIXED_PRICING", priceMinor: 450, soldOut: false, deleted: false },
        { id: "large", name: "Large", pricingType: "FIXED_PRICING", priceMinor: 550, soldOut: false, deleted: false },
      ],
      lists: [
        { listId: "milk", enabled: true, minOverride: null, maxOverride: null },
        { listId: "extras", enabled: true, minOverride: null, maxOverride: null },
      ],
    },
    {
      id: "brew", name: "Cold Brew", description: null, categoryId: "c1", aiHidden: false, aiUnavailableUntil: null, deleted: false,
      aliases: ["iced coffee"],
      variations: [{ id: "brew-one", name: "Regular", pricingType: "FIXED_PRICING", priceMinor: 500, soldOut: false, deleted: false }],
      lists: [{ listId: "milk", enabled: false, minOverride: null, maxOverride: null }],
    },
    {
      id: "pumpkin", name: "Pumpkin Loaf", description: null, categoryId: null, aiHidden: false, aiUnavailableUntil: null, deleted: false,
      aliases: [],
      variations: [{ id: "slice", name: "Slice", pricingType: "FIXED_PRICING", priceMinor: 400, soldOut: true, deleted: false }],
      lists: [],
    },
    {
      id: "secret", name: "Staff Special", description: null, categoryId: null, aiHidden: true, aiUnavailableUntil: null, deleted: false,
      aliases: [],
      variations: [{ id: "s1", name: "Regular", pricingType: "FIXED_PRICING", priceMinor: 300, soldOut: false, deleted: false }],
      lists: [],
    },
  ],
};

const item = (id: string) => menu.items.find((i) => i.id === id)!;

test("unavailable items are never offered", () => {
  assert.deepEqual(itemAvailability(item("pumpkin"), at), { orderable: false, reason: "SOLD_OUT" });
  assert.deepEqual(itemAvailability(item("secret"), at), { orderable: false, reason: "HIDDEN" });
  const eightySixed = { ...item("latte"), aiUnavailableUntil: "2026-10-22T23:00:00Z" };
  assert.deepEqual(itemAvailability(eightySixed, at), { orderable: false, reason: "86_UNTIL" });
  assert.deepEqual(itemAvailability(eightySixed, new Date("2026-10-23T00:00:00Z")), { orderable: true });
});

test("search finds names, aliases and near-misses, and skips unavailable items", () => {
  assert.equal(searchMenu(menu, "latte", at)[0]?.item.id, "latte");
  assert.equal(searchMenu(menu, "an iced coffee", at)[0]?.item.id, "brew");
  assert.equal(searchMenu(menu, "lattay", at)[0]?.item.id, "latte");
  assert.equal(searchMenu(menu, "pumpkin loaf", at).length, 0);
  assert.equal(searchMenu(menu, "staff special", at).length, 0);
  assert.equal(searchMenu(menu, "pizza", at).length, 0);
});

test("required choices are asked for", () => {
  const p = validateSelection(menu, { itemId: "latte", quantity: 1, modifiers: [] }, at);
  assert.deepEqual(p.map((x) => x.code).sort(), ["TOO_FEW", "VARIATION_REQUIRED"]);
  assert.match(p.find((x) => x.code === "TOO_FEW")!.message, /Whole milk, Oat milk/);
});

test("a valid latte passes, and limits are enforced", () => {
  const ok = { itemId: "latte", variationId: "large", quantity: 1, modifiers: [{ listId: "milk", optionId: "whole" }] };
  assert.deepEqual(validateSelection(menu, ok, at), []);
  const tooMany = { ...ok, modifiers: [...ok.modifiers, { listId: "extras", optionId: "shot" }, { listId: "extras", optionId: "syrup" }, { listId: "extras", optionId: "cream" }] };
  assert.deepEqual(validateSelection(menu, tooMany, at).map((p) => p.code), ["TOO_MANY"]);
});

test("nested modifier lists open when their parent is chosen", () => {
  const sel = { itemId: "latte", variationId: "small", quantity: 1, modifiers: [{ listId: "milk", optionId: "oat" }] };
  assert.deepEqual(validateSelection(menu, sel, at).map((p) => p.listId), ["oatBrand"]);
  const done = { ...sel, modifiers: [...sel.modifiers, { listId: "oatBrand", optionId: "house", parentOptionId: "oat" }] };
  assert.deepEqual(validateSelection(menu, done, at), []);
});

test("sold-out options, disabled lists and foreign lists are rejected", () => {
  const soy = { itemId: "latte", variationId: "small", quantity: 1, modifiers: [{ listId: "milk", optionId: "soy" }] };
  assert.deepEqual(validateSelection(menu, soy, at).map((p) => p.code), ["OPTION_UNAVAILABLE"]);
  const disabled = { itemId: "brew", quantity: 1, modifiers: [{ listId: "milk", optionId: "whole" }] };
  assert.deepEqual(validateSelection(menu, disabled, at).map((p) => p.code), ["LIST_NOT_ON_ITEM"]);
});

test("order lines are priced from the menu, not from the caller or the model", () => {
  const l = toOrderLine(menu, { itemId: "latte", variationId: "large", quantity: 2, modifiers: [{ listId: "milk", optionId: "oat" }] });
  assert.equal(l.unitPriceMinor, 550);
  assert.equal(l.modifiers[0]?.priceMinor, 75);
  assert.equal(l.variationName, "Large");
});

test("effective rules fall back to Square's defaults", () => {
  assert.deepEqual(rules(menu.lists.extras!), { min: 0, max: 2 });
  assert.deepEqual(rules(menu.lists.milk!, { listId: "milk", enabled: true, minOverride: 0, maxOverride: null }), { min: 0, max: 1 });
});

test("a menu older than the limit is stale", () => {
  assert.equal(freshness(menu.syncedAt, 3600, at), "fresh");
  assert.equal(freshness(menu.syncedAt, 300, at), "stale");
  assert.equal(freshness(null, 3600, at), "stale");
});
