// The second sample restaurant's menu (Tandoor & Crust in Lahore: burgers, pizza and Pakistani food), in
// rupees. Bigger than the café's on purpose: sizes, a required spice level, crusts, up to five toppings, a
// meal deal that then asks for a drink, a size that's sold out, a dish that's sold out, and a catering tray
// with no fixed price. It goes through the same parse and apply code a real Square sync uses. All names and
// prices invented. Prices are in paisa (Rs 650 is 65000), the minor unit Square uses for PKR.
import type { CatalogObject } from "../providers/square.ts";
import { catalogKit, soldOutAt } from "./catalog-kit.ts";

export const TANDOOR_SQUARE_LOCATION = "LSAMPLE0000003";

const { item, list, category } = catalogKit({ present_at_location_ids: [TANDOOR_SQUARE_LOCATION] }, "PKR");
const rs = (rupees: number) => rupees * 100;

export function tandoorCrustCatalog(loc = TANDOOR_SQUARE_LOCATION): CatalogObject[] {
  const soldOut = soldOutAt(loc);
  const spice = "TC_L_SPICE";
  return [
    category("TC_CAT_STARTERS", "Starters", 0), category("TC_CAT_BURGERS", "Burgers and wraps", 1), category("TC_CAT_PIZZA", "Pizza", 2),
    category("TC_CAT_KARAHI", "Karahi and curries", 3), category("TC_CAT_GRILL", "BBQ and grill", 4), category("TC_CAT_RICE", "Biryani and rice", 5),
    category("TC_CAT_BREAD", "Breads", 6), category("TC_CAT_SIDES", "Sides", 7), category("TC_CAT_DESSERT", "Desserts", 8),
    category("TC_CAT_DRINKS", "Drinks", 9), category("TC_CAT_CATERING", "Catering", 10),

    list(spice, "Spice level", "SINGLE", 1, 1, [["TC_M_MILD", "Mild", 0], ["TC_M_MEDIUM", "Medium", 0], ["TC_M_HOT", "Hot", 0], ["TC_M_XHOT", "Extra hot", 0]]),
    list("TC_L_CRUST", "Crust", "SINGLE", 1, 1, [["TC_M_CLASSIC", "Classic hand-tossed", 0], ["TC_M_THIN", "Thin crust", 0], ["TC_M_STUFFED", "Stuffed crust", rs(350)]]),
    list("TC_L_TOPPINGS", "Extra toppings", "MULTIPLE", 0, 5, [
      ["TC_M_XCHEESE", "Extra cheese", rs(200)], ["TC_M_TIKKA_TOP", "Chicken tikka", rs(250)], ["TC_M_PEPPERONI_TOP", "Beef pepperoni", rs(250)],
      ["TC_M_MUSHROOM", "Mushrooms", rs(150)], ["TC_M_JALAPENO", "Jalapeños", rs(100)], ["TC_M_OLIVES", "Black olives", rs(150)], ["TC_M_ONION", "Onions", rs(100)],
    ]),
    list("TC_L_BURGER_ADDONS", "Burger add-ons", "MULTIPLE", 0, 4, [
      ["TC_M_CHEESE_SLICE", "Cheese slice", rs(100)], ["TC_M_EGG", "Fried egg", rs(80)], ["TC_M_B_JALAPENO", "Jalapeños", rs(80)], ["TC_M_PATTY", "Extra patty", rs(400)],
    ]),
    list("TC_L_MEAL", "Make it a meal", "SINGLE", 0, 1, [["TC_M_MEAL", "Meal with fries and a drink", rs(450), { child_modifier_list_ids: ["TC_L_MEAL_DRINK"] }]]),
    list("TC_L_MEAL_DRINK", "Meal drink", "SINGLE", 1, 1, [["TC_M_MD_COKE", "Coke", 0], ["TC_M_MD_DIET", "Diet Coke", 0], ["TC_M_MD_SPRITE", "Sprite", 0], ["TC_M_MD_LASSI", "Mango lassi", rs(150)]]),
    list("TC_L_SAUCE", "Dipping sauce", "SINGLE", 0, 1, [["TC_M_GARLIC", "Garlic mayo", 0], ["TC_M_MINT", "Mint chutney", 0], ["TC_M_IMLI", "Imli (tamarind) chutney", 0], ["TC_M_CHIPOTLE", "Chipotle", 0]]),
    list("TC_L_ADD_BREAD", "Add bread", "MULTIPLE", 0, 3, [["TC_M_AB_NAAN", "Plain naan", rs(60)], ["TC_M_AB_GARLIC", "Garlic naan", rs(120)], ["TC_M_AB_ROTI", "Tandoori roti", rs(40)]]),
    list("TC_L_RAITA", "Add raita", "SINGLE", 0, 1, [["TC_M_RAITA", "Raita", rs(100)]]),
    list("TC_L_LASSI", "Lassi", "SINGLE", 1, 1, [["TC_M_SWEET", "Sweet", 0], ["TC_M_SALTED", "Salted", 0], ["TC_M_MANGO", "Mango", rs(80)]]),
    list("TC_L_SODA", "Soda", "SINGLE", 1, 1, [["TC_M_COKE", "Coke", 0], ["TC_M_DIET", "Diet Coke", 0], ["TC_M_SPRITE", "Sprite", 0], ["TC_M_FANTA", "Fanta", 0]]),

    // Starters
    item("TC_I_SAMOSA", "Samosa", "TC_CAT_STARTERS", "Two crisp pastries with spiced potato and peas, or chicken.", [["TC_V_SAMOSA_VEG", "Vegetable", rs(150)], ["TC_V_SAMOSA_CHK", "Chicken", rs(200)]], ["TC_L_SAUCE"]),
    item("TC_I_PAKORA", "Chicken Pakora", "TC_CAT_STARTERS", "Bite-size chicken fried in spiced gram-flour batter.", [["TC_V_PAKORA", "Regular", rs(600)]], [spice, "TC_L_SAUCE"]),
    item("TC_I_CHAAT", "Chaat Papri", "TC_CAT_STARTERS", "Crisp wafers, chickpeas, yogurt and tamarind chutney. Vegetarian.", [["TC_V_CHAAT", "Regular", rs(350)]], []),
    item("TC_I_MASALA_FRIES", "Masala Fries", "TC_CAT_STARTERS", "Fries tossed in chaat masala and chilli.", [["TC_V_MASALA_FRIES", "Regular", rs(400)]], [spice]),

    // Burgers and wraps
    item("TC_I_SMASH", "Smash Burger", "TC_CAT_BURGERS", "Beef patties smashed thin, cheese, pickles and house sauce.", [["TC_V_SMASH_SINGLE", "Single", rs(750)], ["TC_V_SMASH_DOUBLE", "Double", rs(1050)]], ["TC_L_BURGER_ADDONS", "TC_L_MEAL"]),
    item("TC_I_ZINGER", "Zinger Burger", "TC_CAT_BURGERS", "Crispy spiced chicken fillet, lettuce and mayo.", [["TC_V_ZINGER", "Regular", rs(650)]], [spice, "TC_L_BURGER_ADDONS", "TC_L_MEAL"]),
    item("TC_I_TIKKA_WRAP", "Chicken Tikka Wrap", "TC_CAT_BURGERS", "Chicken tikka, onions and mint chutney in a paratha.", [["TC_V_TIKKA_WRAP", "Regular", rs(650)]], [spice, "TC_L_SAUCE"]),
    item("TC_I_KEBAB_ROLL", "Seekh Kebab Roll", "TC_CAT_BURGERS", "Beef seekh kebab, salad and chutney rolled in paratha.", [["TC_V_KEBAB_ROLL", "Regular", rs(600)]], [spice, "TC_L_SAUCE"]),

    // Pizza
    item("TC_I_MARGHERITA", "Margherita Pizza", "TC_CAT_PIZZA", "Tomato, mozzarella and basil. Vegetarian.", [["TC_V_MARG_S", "Small 8 inch", rs(850)], ["TC_V_MARG_M", "Medium 12 inch", rs(1350)], ["TC_V_MARG_L", "Large 14 inch", rs(1850)]], ["TC_L_CRUST", "TC_L_TOPPINGS"]),
    item("TC_I_TIKKA_PIZZA", "Chicken Tikka Pizza", "TC_CAT_PIZZA", "Chicken tikka, onions, green chillies and mozzarella.", [["TC_V_TIKKA_S", "Small 8 inch", rs(950)], ["TC_V_TIKKA_M", "Medium 12 inch", rs(1550)], ["TC_V_TIKKA_L", "Large 14 inch", rs(2150)]], ["TC_L_CRUST", spice, "TC_L_TOPPINGS"]),
    item("TC_I_PEPPERONI", "Beef Pepperoni Pizza", "TC_CAT_PIZZA", "Beef pepperoni and mozzarella.", [["TC_V_PEP_S", "Small 8 inch", rs(950)], ["TC_V_PEP_M", "Medium 12 inch", rs(1550)], ["TC_V_PEP_L", "Large 14 inch", rs(2150)]], ["TC_L_CRUST", "TC_L_TOPPINGS"]),
    item("TC_I_FAJITA", "Chicken Fajita Pizza", "TC_CAT_PIZZA", "Fajita chicken, peppers, onions and mozzarella.", [["TC_V_FAJ_S", "Small 8 inch", rs(950)], ["TC_V_FAJ_M", "Medium 12 inch", rs(1550)], ["TC_V_FAJ_L", "Large 14 inch", rs(2150)]], ["TC_L_CRUST", "TC_L_TOPPINGS"]),

    // Karahi and curries
    item("TC_I_CHICKEN_KARAHI", "Chicken Karahi", "TC_CAT_KARAHI", "Cooked fresh in the karahi with tomato, ginger and green chilli. Allow 30 minutes.", [["TC_V_CK_HALF", "Half", rs(1600)], ["TC_V_CK_FULL", "Full", rs(2900)]], [spice, "TC_L_ADD_BREAD"]),
    item("TC_I_LAMB_KARAHI", "Mutton Karahi", "TC_CAT_KARAHI", "Bone-in mutton, cooked fresh. Allow 35 minutes.", [["TC_V_LK_HALF", "Half", rs(2400)], ["TC_V_LK_FULL", "Full", rs(4500), soldOut]], [spice, "TC_L_ADD_BREAD"]),
    item("TC_I_DAAL", "Daal Makhani", "TC_CAT_KARAHI", "Black lentils slow-cooked with butter and cream. Vegetarian.", [["TC_V_DAAL", "Regular", rs(650)]], [spice, "TC_L_ADD_BREAD"]),
    item("TC_I_PALAK", "Palak Paneer", "TC_CAT_KARAHI", "Spinach with fresh cheese. Vegetarian.", [["TC_V_PALAK", "Regular", rs(800)]], [spice, "TC_L_ADD_BREAD"]),
    item("TC_I_NIHARI", "Beef Nihari", "TC_CAT_KARAHI", "Slow-cooked beef shank stew. Weekends only, and sold out today.", [["TC_V_NIHARI", "Regular", rs(950), soldOut]], [spice, "TC_L_ADD_BREAD"]),

    // BBQ and grill
    item("TC_I_TIKKA_BOTI", "Chicken Tikka", "TC_CAT_GRILL", "Chicken leg quarter marinated overnight and charred in the tandoor.", [["TC_V_TIKKA_BOTI", "Regular", rs(450)]], [spice]),
    item("TC_I_SEEKH", "Seekh Kebab", "TC_CAT_GRILL", "Four minced-meat kebabs off the grill.", [["TC_V_SEEKH_BEEF", "Beef", rs(900)], ["TC_V_SEEKH_CHK", "Chicken", rs(800)]], [spice, "TC_L_SAUCE"]),
    item("TC_I_MIXED_GRILL", "Mixed Grill Platter", "TC_CAT_GRILL", "Chicken tikka, seekh kebabs, malai boti and naan for two.", [["TC_V_MIXED_GRILL", "Regular", rs(3200)]], [spice]),

    // Biryani and rice
    item("TC_I_BIRYANI", "Biryani", "TC_CAT_RICE", "Layered basmati rice, slow-cooked with spices.", [["TC_V_BIR_CHK", "Chicken", rs(550)], ["TC_V_BIR_BEEF", "Beef", rs(600)], ["TC_V_BIR_VEG", "Vegetable", rs(450)]], [spice, "TC_L_RAITA"]),
    item("TC_I_RICE", "Plain Basmati Rice", "TC_CAT_RICE", "Steamed basmati.", [["TC_V_RICE", "Regular", rs(250)]], []),

    // Breads
    item("TC_I_NAAN", "Naan", "TC_CAT_BREAD", "From the tandoor.", [["TC_V_NAAN", "Regular", rs(60)]], []),
    item("TC_I_GARLIC_NAAN", "Garlic Naan", "TC_CAT_BREAD", "Naan brushed with garlic butter.", [["TC_V_GARLIC_NAAN", "Regular", rs(120)]], []),
    item("TC_I_CHEESE_NAAN", "Cheese Naan", "TC_CAT_BREAD", "Naan stuffed with melted cheese.", [["TC_V_CHEESE_NAAN", "Regular", rs(300)]], []),
    item("TC_I_ROTI", "Tandoori Roti", "TC_CAT_BREAD", "Whole-wheat flatbread.", [["TC_V_ROTI", "Regular", rs(40)]], []),

    // Sides
    item("TC_I_RAITA_SIDE", "Raita", "TC_CAT_SIDES", "Yogurt with cucumber and mint.", [["TC_V_RAITA_SIDE", "Regular", rs(120)]], []),
    item("TC_I_SALAD", "Kachumber Salad", "TC_CAT_SIDES", "Cucumber, tomato and onion with lemon.", [["TC_V_SALAD", "Regular", rs(150)]], []),
    item("TC_I_FRIES", "Fries", "TC_CAT_SIDES", "Skin-on fries.", [["TC_V_FRIES", "Regular", rs(350)]], ["TC_L_SAUCE"]),

    // Desserts
    item("TC_I_GULAB", "Gulab Jamun", "TC_CAT_DESSERT", "Two warm milk dumplings in syrup.", [["TC_V_GULAB", "Regular", rs(250)]], []),
    item("TC_I_KHEER", "Kheer", "TC_CAT_DESSERT", "Rice pudding with cardamom and pistachio.", [["TC_V_KHEER", "Regular", rs(300)]], []),
    item("TC_I_BROWNIE", "Chocolate Brownie", "TC_CAT_DESSERT", "Warm, with a scoop of vanilla.", [["TC_V_BROWNIE", "Regular", rs(450)]], []),

    // Drinks
    item("TC_I_LASSI", "Lassi", "TC_CAT_DRINKS", "Chilled yogurt drink.", [["TC_V_LASSI", "Regular", rs(300)]], ["TC_L_LASSI"]),
    item("TC_I_SODA", "Soft Drink", "TC_CAT_DRINKS", "A can of soda.", [["TC_V_SODA", "Can", rs(150)]], ["TC_L_SODA"]),
    item("TC_I_DOODH_PATTI", "Doodh Patti Chai", "TC_CAT_DRINKS", "Strong milky tea.", [["TC_V_DOODH_PATTI", "Regular", rs(120)]], []),
    item("TC_I_KASHMIRI", "Kashmiri Chai", "TC_CAT_DRINKS", "Pink tea with pistachio.", [["TC_V_KASHMIRI", "Regular", rs(250)]], []),
    item("TC_I_WATER", "Mineral Water", "TC_CAT_DRINKS", "Small bottle.", [["TC_V_WATER", "Each", rs(80)]], []),

    // Catering: priced per order by the owner, so the AI must not quote it.
    item("TC_I_TRAY", "Biryani Tray", "TC_CAT_CATERING", "Serves about ten. Priced with the owner; two days' notice.", [["TC_V_TRAY", "Serves 10", 0, { pricing_type: "VARIABLE_PRICING", price_money: undefined }]], []),
  ];
}
