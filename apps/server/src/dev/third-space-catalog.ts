// A small Square-shaped catalog for the sample restaurant (Third Space). Used by the seed script and
// by tests, and it goes through the same parse and apply code a real sync uses. All names invented.
import type { CatalogObject } from "../providers/square.ts";
import { catalogKit } from "./catalog-kit.ts";
import { TANDOOR_SQUARE_LOCATION } from "./tandoor-crust-catalog.ts";

export const SAMPLE_SQUARE_LOCATION = "LSAMPLE0000001";

// Sold at every location of the Square stand-in except the second sample restaurant's.
const { item, list, category } = catalogKit({ present_at_all_locations: true, absent_at_location_ids: [TANDOOR_SQUARE_LOCATION] });

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
