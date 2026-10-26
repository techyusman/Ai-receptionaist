// Builders for the sample restaurants' Square-shaped catalogs. Each kit stamps every object with where it is
// sold, so several sample restaurants can share one Square stand-in and each sees only its own menu.
import type { CatalogObject } from "../providers/square.ts";

export type Presence = { present_at_all_locations?: boolean; present_at_location_ids?: string[]; absent_at_location_ids?: string[] };
type Extra = Record<string, unknown>;
/** [id, name, price in cents, extra fields] for a modifier or a variation. */
export type Option = [string, string, number, Extra?];

export function catalogKit(presence: Presence) {
  const money = (amount: number) => ({ amount, currency: "USD" });

  const modifier = (id: string, listId: string, name: string, ordinal: number, price: number, extra: Extra = {}): CatalogObject =>
    ({ type: "MODIFIER", id, version: 1, ...presence, modifier_data: { name, ordinal, price_money: money(price), modifier_list_id: listId, ...extra } });

  const list = (id: string, name: string, type: "SINGLE" | "MULTIPLE", min: number, max: number, mods: Option[]): CatalogObject => ({
    type: "MODIFIER_LIST", id, version: 1, ...presence,
    modifier_list_data: {
      name, selection_type: type, min_selected_modifiers: min, max_selected_modifiers: max,
      modifiers: mods.map(([mid, mname, price, extra], i) => modifier(mid, id, mname, i, price, extra)),
    },
  });

  const variation = (id: string, itemId: string, name: string, ordinal: number, price: number, extra: Extra = {}): CatalogObject =>
    ({ type: "ITEM_VARIATION", id, version: 1, ...presence, item_variation_data: { item_id: itemId, name, ordinal, pricing_type: "FIXED_PRICING", price_money: money(price), ...extra } });

  const item = (id: string, name: string, category: string, description: string, variations: Option[], lists: string[], extra: Extra = {}): CatalogObject => ({
    type: "ITEM", id, version: 1, ...presence,
    item_data: {
      name, description, category_id: category, product_type: "REGULAR",
      variations: variations.map(([vid, vname, price, vextra], i) => variation(vid, id, vname, i, price, vextra)),
      modifier_list_info: lists.map((l) => ({ modifier_list_id: l, enabled: true })),
      ...extra,
    },
  });

  const category = (id: string, name: string, ordinal: number): CatalogObject => ({ type: "CATEGORY", id, version: 1, ...presence, category_data: { name, ordinal } });

  return { item, list, category };
}

/** Square's per-location override for something sold out today. */
export const soldOutAt = (locationId: string) => ({ location_overrides: [{ location_id: locationId, sold_out: true }] });
