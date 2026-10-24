// Reads Square catalog objects into plain records, for one chosen Square location. Square's JSON is
// loose (optional fields, location overrides, nested lists), so everything here is defensive: an
// object that doesn't make sense is skipped and counted, never allowed to crash the whole sync.
import type { CatalogObject } from "../providers/square.ts";

export type ParsedVariation = {
  squareId: string; itemSquareId: string; name: string; ordinal: number;
  pricingType: "FIXED_PRICING" | "VARIABLE_PRICING"; priceMinor: number | null; currency: string; soldOut: boolean; version: number; deleted: boolean;
};
export type ParsedItem = {
  squareId: string; name: string; description: string | null; categorySquareId: string | null; version: number; deleted: boolean;
  raw: Record<string, unknown>;
  variations: ParsedVariation[];
  lists: { listSquareId: string; enabled: boolean; min: number | null; max: number | null; ordinal: number }[];
};
export type ParsedModifier = {
  squareId: string; listSquareId: string; name: string; priceMinor: number; currency: string; ordinal: number; onByDefault: boolean;
  soldOut: boolean; childListSquareIds: string[]; version: number; deleted: boolean;
};
export type ParsedList = {
  squareId: string; name: string; selectionType: "SINGLE" | "MULTIPLE"; min: number | null; max: number | null; version: number; deleted: boolean;
  raw: Record<string, unknown>; modifiers: ParsedModifier[];
};
export type ParsedCategory = { squareId: string; name: string; ordinal: number; version: number; deleted: boolean };

export type ParsedCatalog = {
  categories: ParsedCategory[]; items: ParsedItem[]; lists: ParsedList[];
  /** Objects that were present but unusable, so a sync can report them. */
  skipped: number;
  latestUpdatedAt: string | null;
};

type Money = { amount?: number; currency?: string } | undefined;
type Override = { location_id?: string; price_money?: Money; pricing_type?: string; sold_out?: boolean };

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Is this object offered at the chosen location? Square lists it everywhere, or only at, or everywhere except. */
export function presentAt(o: Pick<CatalogObject, "present_at_all_locations" | "present_at_location_ids" | "absent_at_location_ids">, locationId: string): boolean {
  if (o.present_at_all_locations) return !(o.absent_at_location_ids ?? []).includes(locationId);
  return (o.present_at_location_ids ?? []).includes(locationId);
}

function overrideFor(data: Record<string, unknown>, locationId: string): Override {
  return (arr(data.location_overrides) as Override[]).find((o) => o?.location_id === locationId) ?? {};
}

function parseVariation(o: CatalogObject, loc: string, currency: string, parentItemId?: string): ParsedVariation | null {
  const d = asRecord(o.item_variation_data);
  const item = parentItemId ?? str(d.item_id);
  if (!item || !o.id) return null;
  const ov = overrideFor(d, loc);
  const money = ov.price_money ?? (d.price_money as Money);
  const pricingType = (ov.pricing_type ?? (d.pricing_type as string | undefined)) === "VARIABLE_PRICING" ? "VARIABLE_PRICING" : "FIXED_PRICING";
  return {
    squareId: o.id, itemSquareId: item, name: str(d.name) ?? "Regular", ordinal: num(d.ordinal) ?? 0, pricingType,
    priceMinor: pricingType === "FIXED_PRICING" ? num(money?.amount) : null,
    currency: money?.currency ?? currency, soldOut: ov.sold_out === true, version: o.version ?? 0,
    deleted: o.is_deleted === true || !presentAt(o, loc),
  };
}

function parseModifier(o: CatalogObject, loc: string, currency: string, parentListId?: string): ParsedModifier | null {
  const d = asRecord(o.modifier_data);
  const list = parentListId ?? str(d.modifier_list_id);
  if (!list || !o.id) return null;
  const ov = overrideFor(d, loc);
  const money = ov.price_money ?? (d.price_money as Money);
  return {
    squareId: o.id, listSquareId: list, name: str(d.name) ?? "Option", priceMinor: num(money?.amount) ?? 0, currency: money?.currency ?? currency,
    ordinal: num(d.ordinal) ?? 0, onByDefault: d.on_by_default === true, soldOut: ov.sold_out === true,
    childListSquareIds: arr(d.child_modifier_list_ids).filter((x): x is string => typeof x === "string"),
    version: o.version ?? 0, deleted: o.is_deleted === true || !presentAt(o, loc),
  };
}

function parseItem(o: CatalogObject, loc: string): ParsedItem {
  const d = asRecord(o.item_data);
  const category = str(d.category_id) ?? str(asRecord(arr(d.categories)[0]).id) ?? str(asRecord(d.reporting_category).id);
  return {
    squareId: o.id, name: str(d.name) ?? "Item", description: str(d.description_plain_text) ?? str(d.description), categorySquareId: category,
    version: o.version ?? 0, deleted: o.is_deleted === true || !presentAt(o, loc) || d.is_archived === true,
    raw: { product_type: d.product_type ?? null }, variations: [],
    lists: arr(d.modifier_list_info)
      .map((x, i) => {
        const info = asRecord(x);
        return { listSquareId: str(info.modifier_list_id) ?? "", enabled: info.enabled !== false, min: num(info.min_selected_modifiers), max: num(info.max_selected_modifiers), ordinal: i };
      })
      .filter((l) => l.listSquareId),
  };
}

function parseList(o: CatalogObject, loc: string): ParsedList {
  const d = asRecord(o.modifier_list_data);
  const min = num(d.min_selected_modifiers);
  const max = num(d.max_selected_modifiers);
  return {
    squareId: o.id, name: str(d.name) ?? "Options", selectionType: d.selection_type === "MULTIPLE" ? "MULTIPLE" : "SINGLE",
    min: min !== null && min >= 0 ? min : null, max: max !== null && max >= 1 ? max : null,
    version: o.version ?? 0, deleted: o.is_deleted === true || !presentAt(o, loc), raw: {}, modifiers: [],
  };
}

export function parseCatalog(objects: CatalogObject[], squareLocationId: string, fallbackCurrency: string): ParsedCatalog {
  const out: ParsedCatalog = { categories: [], items: [], lists: [], skipped: 0, latestUpdatedAt: null };
  const variations = new Map<string, ParsedVariation>();
  const modifiersByList = new Map<string, Map<string, ParsedModifier>>();
  const items = new Map<string, ParsedItem>();
  const lists = new Map<string, ParsedList>();
  const addModifier = (m: ParsedModifier) => {
    const bucket = modifiersByList.get(m.listSquareId) ?? new Map<string, ParsedModifier>();
    bucket.set(m.squareId, m);
    modifiersByList.set(m.listSquareId, bucket);
  };

  for (const o of objects) {
    if (o.updated_at && (!out.latestUpdatedAt || o.updated_at > out.latestUpdatedAt)) out.latestUpdatedAt = o.updated_at;
    try {
      if (o.type === "CATEGORY") {
        const d = asRecord(o.category_data);
        out.categories.push({ squareId: o.id, name: str(d.name) ?? "Category", ordinal: num(d.ordinal) ?? 0, version: o.version ?? 0, deleted: o.is_deleted === true || !presentAt(o, squareLocationId) });
      } else if (o.type === "ITEM") {
        items.set(o.id, parseItem(o, squareLocationId));
        for (const v of arr(asRecord(o.item_data).variations)) {
          const pv = parseVariation(v as CatalogObject, squareLocationId, fallbackCurrency, o.id);
          if (pv) variations.set(pv.squareId, pv);
        }
      } else if (o.type === "ITEM_VARIATION") {
        const pv = parseVariation(o, squareLocationId, fallbackCurrency);
        if (pv) variations.set(pv.squareId, pv);
        else out.skipped++;
      } else if (o.type === "MODIFIER_LIST") {
        lists.set(o.id, parseList(o, squareLocationId));
        for (const m of arr(asRecord(o.modifier_list_data).modifiers)) {
          const pm = parseModifier(m as CatalogObject, squareLocationId, fallbackCurrency, o.id);
          if (pm) addModifier(pm);
        }
      } else if (o.type === "MODIFIER") {
        const pm = parseModifier(o, squareLocationId, fallbackCurrency);
        if (pm) addModifier(pm);
        else out.skipped++;
      }
    } catch {
      out.skipped++;
    }
  }

  for (const v of variations.values()) items.get(v.itemSquareId)?.variations.push(v);
  for (const [listId, bucket] of modifiersByList) {
    const list = lists.get(listId);
    if (list) list.modifiers = [...bucket.values()];
  }
  out.items = [...items.values()];
  out.lists = [...lists.values()];
  return out;
}
