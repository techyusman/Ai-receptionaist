// Writes a parsed Square catalog into the menu tables. Re-running it with the same catalog changes
// nothing, and the restaurant's own overlay (hidden from the AI, 86'd until) is never touched.
import { many, one, type Tx } from "@receptionist/db";
import type { ParsedCatalog } from "./parse.ts";

export type ApplyResult = { upserted: number; deleted: number };
export type ApplyInput = { restaurantId: string; locationId: string; parsed: ParsedCatalog; full: boolean; at: Date };

type Ids = Map<string, string>;
type Seen = { categories: Set<string>; lists: Set<string>; modifiers: Set<string>; items: Set<string>; variations: Set<string> };

async function idsFor(tx: Tx, table: "menu_categories" | "modifier_lists" | "modifiers" | "menu_items", locationId: string): Promise<Ids> {
  const rows = await many<{ id: string; square_id: string }>(tx, `select id, square_id from ${table} where location_id = $1`, [locationId]);
  return new Map(rows.map((r) => [r.square_id, r.id]));
}

/** A deleted or unavailable object only ever marks an existing row deleted; it is never created. */
async function markDeleted(tx: Tx, table: string, locationId: string, squareId: string, version: number, at: string): Promise<number> {
  const r = await tx.query(`update ${table} set is_deleted = true, square_version = $3, synced_at = $4 where location_id = $1 and square_id = $2 and not is_deleted`, [locationId, squareId, version, at]);
  return r.rowCount ?? 0;
}

async function applyCategories(tx: Tx, i: ApplyInput, seen: Seen, ids: Ids): Promise<{ up: number; del: number }> {
  const at = i.at.toISOString();
  let up = 0;
  let del = 0;
  for (const c of i.parsed.categories) {
    if (c.deleted) {
      del += await markDeleted(tx, "menu_categories", i.locationId, c.squareId, c.version, at);
      continue;
    }
    seen.categories.add(c.squareId);
    const r = await one<{ id: string }>(
      tx,
      `insert into menu_categories (restaurant_id, location_id, square_id, name, ordinal, is_deleted, square_version, synced_at)
       values ($1, $2, $3, $4, $5, false, $6, $7)
       on conflict (location_id, square_id) do update set name = excluded.name, ordinal = excluded.ordinal, is_deleted = false,
         square_version = excluded.square_version, synced_at = excluded.synced_at returning id`,
      [i.restaurantId, i.locationId, c.squareId, c.name, c.ordinal, c.version, at],
    );
    ids.set(c.squareId, r.id);
    up++;
  }
  return { up, del };
}

async function applyLists(tx: Tx, i: ApplyInput, seen: Seen, listIds: Ids): Promise<{ up: number; del: number }> {
  const at = i.at.toISOString();
  let up = 0;
  let del = 0;
  for (const l of i.parsed.lists) {
    if (l.deleted) {
      del += await markDeleted(tx, "modifier_lists", i.locationId, l.squareId, l.version, at);
      continue;
    }
    seen.lists.add(l.squareId);
    const max = l.max !== null && l.min !== null && l.max < l.min ? l.min : l.max;
    const r = await one<{ id: string }>(
      tx,
      `insert into modifier_lists (restaurant_id, location_id, square_id, name, selection_type, min_selected, max_selected, is_deleted, square_version, raw, synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)
       on conflict (location_id, square_id) do update set name = excluded.name, selection_type = excluded.selection_type,
         min_selected = excluded.min_selected, max_selected = excluded.max_selected, is_deleted = false,
         square_version = excluded.square_version, raw = excluded.raw, synced_at = excluded.synced_at returning id`,
      [i.restaurantId, i.locationId, l.squareId, l.name, l.selectionType, l.min, max, l.version, JSON.stringify(l.raw), at],
    );
    listIds.set(l.squareId, r.id);
    up++;
  }
  return { up, del };
}

async function applyModifiers(tx: Tx, i: ApplyInput, seen: Seen, listIds: Ids, modifierIds: Ids): Promise<{ up: number; del: number }> {
  const at = i.at.toISOString();
  let up = 0;
  let del = 0;
  for (const l of i.parsed.lists) {
    const listId = listIds.get(l.squareId);
    if (!listId || l.deleted) continue;
    for (const m of l.modifiers) {
      if (m.deleted) {
        del += await markDeleted(tx, "modifiers", i.locationId, m.squareId, m.version, at);
        continue;
      }
      seen.modifiers.add(m.squareId);
      const r = await one<{ id: string }>(
        tx,
        `insert into modifiers (restaurant_id, location_id, modifier_list_id, square_id, name, price_minor, currency, ordinal, on_by_default, sold_out, is_deleted, square_version, synced_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12)
         on conflict (location_id, square_id) do update set modifier_list_id = excluded.modifier_list_id, name = excluded.name,
           price_minor = excluded.price_minor, currency = excluded.currency, ordinal = excluded.ordinal, on_by_default = excluded.on_by_default,
           sold_out = excluded.sold_out, is_deleted = false, square_version = excluded.square_version, synced_at = excluded.synced_at returning id`,
        [i.restaurantId, i.locationId, listId, m.squareId, m.name, m.priceMinor, m.currency, m.ordinal, m.onByDefault, m.soldOut, m.version, at],
      );
      modifierIds.set(m.squareId, r.id);
      up++;
    }
  }
  // Nested choices: which lists open when an option is picked. Replaced per option so removals stick.
  for (const l of i.parsed.lists) {
    for (const m of l.modifiers) {
      const modifierId = modifierIds.get(m.squareId);
      if (!modifierId || m.deleted) continue;
      await tx.query("delete from modifier_child_lists where modifier_id = $1", [modifierId]);
      for (const child of m.childListSquareIds) {
        const childId = listIds.get(child);
        if (childId) {
          await tx.query("insert into modifier_child_lists (restaurant_id, location_id, modifier_id, child_list_id) values ($1, $2, $3, $4) on conflict do nothing", [i.restaurantId, i.locationId, modifierId, childId]);
        }
      }
    }
  }
  return { up, del };
}

async function applyItems(tx: Tx, i: ApplyInput, seen: Seen, categoryIds: Ids, listIds: Ids): Promise<{ up: number; del: number }> {
  const at = i.at.toISOString();
  let up = 0;
  let del = 0;
  for (const item of i.parsed.items) {
    if (item.deleted) {
      del += await markDeleted(tx, "menu_items", i.locationId, item.squareId, item.version, at);
      continue;
    }
    seen.items.add(item.squareId);
    const r = await one<{ id: string }>(
      tx,
      `insert into menu_items (restaurant_id, location_id, category_id, square_id, name, description, is_deleted, square_version, raw, synced_at)
       values ($1, $2, $3, $4, $5, $6, false, $7, $8, $9)
       on conflict (location_id, square_id) do update set category_id = excluded.category_id, name = excluded.name,
         description = excluded.description, is_deleted = false, square_version = excluded.square_version, raw = excluded.raw, synced_at = excluded.synced_at
       returning id`,
      [i.restaurantId, i.locationId, item.categorySquareId ? (categoryIds.get(item.categorySquareId) ?? null) : null, item.squareId, item.name, item.description, item.version, JSON.stringify(item.raw), at],
    );
    up++;
    for (const v of item.variations) {
      if (v.deleted) {
        del += await markDeleted(tx, "menu_variations", i.locationId, v.squareId, v.version, at);
        continue;
      }
      seen.variations.add(v.squareId);
      await tx.query(
        `insert into menu_variations (restaurant_id, location_id, item_id, square_id, name, pricing_type, price_minor, currency, ordinal, sold_out, is_deleted, square_version, synced_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12)
         on conflict (location_id, square_id) do update set item_id = excluded.item_id, name = excluded.name, pricing_type = excluded.pricing_type,
           price_minor = excluded.price_minor, currency = excluded.currency, ordinal = excluded.ordinal, sold_out = excluded.sold_out,
           is_deleted = false, square_version = excluded.square_version, synced_at = excluded.synced_at`,
        [i.restaurantId, i.locationId, r.id, v.squareId, v.name, v.pricingType, v.priceMinor, v.currency, v.ordinal, v.soldOut, v.version, at],
      );
      up++;
    }
    await tx.query("delete from item_modifier_lists where item_id = $1", [r.id]);
    for (const link of item.lists) {
      const listId = listIds.get(link.listSquareId);
      if (!listId) continue;
      await tx.query(
        `insert into item_modifier_lists (restaurant_id, location_id, item_id, modifier_list_id, enabled, min_selected_override, max_selected_override, ordinal)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
        [i.restaurantId, i.locationId, r.id, listId, link.enabled, link.min !== null && link.min >= 0 ? link.min : null, link.max !== null && link.max >= 1 ? link.max : null, link.ordinal],
      );
    }
  }
  return { up, del };
}

export async function applyCatalog(tx: Tx, input: ApplyInput): Promise<ApplyResult> {
  const seen: Seen = { categories: new Set(), lists: new Set(), modifiers: new Set(), items: new Set(), variations: new Set() };
  const categoryIds = await idsFor(tx, "menu_categories", input.locationId);
  const listIds = await idsFor(tx, "modifier_lists", input.locationId);
  const modifierIds = await idsFor(tx, "modifiers", input.locationId);
  const results = [
    await applyCategories(tx, input, seen, categoryIds),
    await applyLists(tx, input, seen, listIds),
    await applyModifiers(tx, input, seen, listIds, modifierIds),
    await applyItems(tx, input, seen, categoryIds, listIds),
  ];
  let deleted = results.reduce((n, r) => n + r.del, 0);
  if (input.full) {
    // A full sync is the whole truth: anything Square no longer returns is gone from the AI menu.
    const at = input.at.toISOString();
    const sweep = async (table: string, ids: Set<string>) => {
      const r = await tx.query(`update ${table} set is_deleted = true, synced_at = $3 where location_id = $1 and not is_deleted and not (square_id = any($2::text[]))`, [input.locationId, [...ids], at]);
      deleted += r.rowCount ?? 0;
    };
    await sweep("menu_categories", seen.categories);
    await sweep("menu_items", seen.items);
    await sweep("menu_variations", seen.variations);
    await sweep("modifier_lists", seen.lists);
    await sweep("modifiers", seen.modifiers);
  }
  return { upserted: results.reduce((n, r) => n + r.up, 0), deleted };
}
