// A small Square-shaped catalog for the sample restaurant (Third Space). Used by the seed script and
// by tests, and it goes through the same parse and apply code a real sync uses. All names invented.
import type { CatalogObject } from "../providers/square.ts";

export const SAMPLE_SQUARE_LOCATION = "LSAMPLE0000001";

const everywhere = { present_at_all_locations: true } as const;
const money = (amount: number) => ({ amount, currency: "USD" });

function modifier(id: string, listId: string, name: string, ordinal: number, price: number, extra: Record<string, unknown> = {}): CatalogObject {
  return { type: "MODIFIER", id, version: 1, ...everywhere, modifier_data: { name, ordinal, price_money: money(price), modifier_list_id: listId, ...extra } };
}

function list(id: string, name: string, type: "SINGLE" | "MULTIPLE", min: number, max: number, mods: [string, string, number, Record<string, unknown>?][]): CatalogObject {
  return {
    type: "MODIFIER_LIST", id, version: 1, ...everywhere,
    modifier_list_data: {
      name, selection_type: type, min_selected_modifiers: min, max_selected_modifiers: max,
      modifiers: mods.map(([mid, mname, price, extra], i) => modifier(mid, id, mname, i, price, extra)),
    },
  };
}

function variation(id: string, itemId: string, name: string, ordinal: number, price: number, extra: Record<string, unknown> = {}): CatalogObject {
  return { type: "ITEM_VARIATION", id, version: 1, ...everywhere, item_variation_data: { item_id: itemId, name, ordinal, pricing_type: "FIXED_PRICING", price_money: money(price), ...extra } };
}

function item(id: string, name: string, category: string, description: string, variations: [string, string, number, Record<string, unknown>?][], lists: string[], extra: Record<string, unknown> = {}): CatalogObject {
  return {
    type: "ITEM", id, version: 1, ...everywhere,
    item_data: {
      name, description, category_id: category, product_type: "REGULAR",
      variations: variations.map(([vid, vname, price, vextra], i) => variation(vid, id, vname, i, price, vextra)),
      modifier_list_info: lists.map((l) => ({ modifier_list_id: l, enabled: true })),
      ...extra,
    },
  };
}

const category = (id: string, name: string, ordinal: number): CatalogObject => ({ type: "CATEGORY", id, version: 1, ...everywhere, category_data: { name, ordinal } });

export function thirdSpaceCatalog(loc = SAMPLE_SQUARE_LOCATION): CatalogObject[] {
  const soldOut = { location_overrides: [{ location_id: loc, sold_out: true }] };
  return [
    category("CAT_COFFEE", "Coffee", 0), category("CAT_TEA", "Tea", 1), category("CAT_FOOD", "Breakfast & lunch", 2), category("CAT_BAKERY", "Bakery", 3),
    list("L_MILK", "Milk", "SINGLE", 1, 1, [["M_WHOLE", "Whole milk", 0], ["M_OAT", "Oat milk", 75], ["M_ALMOND", "Almond milk", 75], ["M_SKIM", "Skim milk", 0]]),
    list("L_EXTRAS", "Extras", "MULTIPLE", 0, 3, [["M_SHOT", "Extra shot", 100], ["M_VANILLA", "Vanilla syrup", 60], ["M_CARAMEL", "Caramel syrup", 60]]),
    list("L_TEMP", "Temperature", "SINGLE", 0, 1, [["M_HOT", "Hot", 0], ["M_ICED", "Iced", 0]]),
    list("L_BREAD", "Bread", "SINGLE", 1, 1, [["M_SOUR", "Sourdough", 0], ["M_CROISSANT", "Croissant", 150], ["M_GF", "Gluten-free bread", 200]]),
    list("L_EGG", "Egg", "SINGLE", 0, 1, [["M_FRIED", "Fried egg", 0], ["M_SCRAMBLED", "Scrambled egg", 0], ["M_NOEGG", "No egg", 0]]),
    list("L_ADDONS", "Add-ons", "MULTIPLE", 0, 3, [["M_BACON", "Bacon", 200], ["M_AVOCADO", "Avocado", 150, { child_modifier_list_ids: ["L_AVOCADO_STYLE"] }], ["M_CHEDDAR", "Cheddar", 0]]),
    list("L_AVOCADO_STYLE", "Avocado style", "SINGLE", 1, 1, [["M_SLICED", "Sliced", 0], ["M_SMASHED", "Smashed", 0]]),
    item("I_LATTE", "Latte", "CAT_COFFEE", "Double espresso with steamed milk.", [["V_LATTE_S", "Small", 450], ["V_LATTE_L", "Large", 550]], ["L_MILK", "L_EXTRAS", "L_TEMP"]),
    item("I_CAPP", "Cappuccino", "CAT_COFFEE", "Equal parts espresso, milk and foam.", [["V_CAPP", "Regular", 475]], ["L_MILK", "L_EXTRAS"]),
    item("I_COLDBREW", "Cold Brew", "CAT_COFFEE", "Steeped for 18 hours, served over ice.", [["V_CB_R", "Regular", 500], ["V_CB_L", "Large", 600]], ["L_EXTRAS"]),
    item("I_DRIP", "Drip Coffee", "CAT_COFFEE", "House blend, refilled all morning.", [["V_DRIP_S", "Small", 300], ["V_DRIP_L", "Large", 375]], []),
    item("I_MATCHA", "Matcha Latte", "CAT_TEA", "Ceremonial-grade matcha with milk.", [["V_MATCHA", "Regular", 575]], ["L_MILK", "L_TEMP"]),
    item("I_CHAI", "Chai Latte", "CAT_TEA", "House-spiced chai concentrate.", [["V_CHAI", "Regular", 525]], ["L_MILK", "L_TEMP"]),
    item("I_SANDWICH", "Breakfast Sandwich", "CAT_FOOD", "Egg and cheddar on your choice of bread.", [["V_SAND", "Regular", 900]], ["L_BREAD", "L_EGG", "L_ADDONS"]),
    item("I_TOAST", "Avocado Toast", "CAT_FOOD", "Smashed avocado, chili flakes and lemon on toast.", [["V_TOAST", "Regular", 1100]], ["L_BREAD"]),
    item("I_ALMOND", "Almond Croissant", "CAT_BAKERY", "Twice-baked with almond cream. Contains nuts.", [["V_ALMOND", "Each", 450]], []),
    item("I_PUMPKIN", "Pumpkin Loaf", "CAT_BAKERY", "Seasonal. Sold out today.", [["V_PUMPKIN", "Slice", 400, soldOut]], []),
    item("I_CIDER", "Spiced Cider", "CAT_TEA", "Seasonal hot cider.", [["V_CIDER", "Regular", 450]], []),
  ];
}
