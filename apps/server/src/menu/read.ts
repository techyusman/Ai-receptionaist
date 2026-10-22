// The menu as the AI and the dashboard read it: rows from the synced Square catalog (plus the
// restaurant's own overlay and aliases) assembled into the domain Menu. Reads Postgres only; Square is
// never called while a caller is waiting.
import type { Menu, MenuItem, ModifierList, ItemListLink, Variation } from "@receptionist/domain";
import { many, maybeOne, type Tx } from "@receptionist/db";

export async function loadMenu(tx: Tx, locationId: string): Promise<Menu> {
  const [loc, categories, items, variations, links, lists, options, children, aliases, synced] = await Promise.all([
    maybeOne<{ currency: string }>(tx, "select currency from locations where id = $1", [locationId]),
    many<{ id: string; name: string; ordinal: number }>(tx, "select id, name, ordinal from menu_categories where location_id = $1 and not is_deleted order by ordinal, name", [locationId]),
    many<{ id: string; name: string; description: string | null; category_id: string | null; ai_hidden: boolean; ai_unavailable_until: string | null; is_deleted: boolean }>(
      tx, "select id, name, description, category_id, ai_hidden, ai_unavailable_until, is_deleted from menu_items where location_id = $1 order by name", [locationId]),
    many<{ id: string; item_id: string; name: string; pricing_type: Variation["pricingType"]; price_minor: number | null; sold_out: boolean; is_deleted: boolean }>(
      tx, "select id, item_id, name, pricing_type, price_minor, sold_out, is_deleted from menu_variations where location_id = $1 order by ordinal, name", [locationId]),
    many<{ item_id: string; modifier_list_id: string; enabled: boolean; min_selected_override: number | null; max_selected_override: number | null }>(
      tx, "select item_id, modifier_list_id, enabled, min_selected_override, max_selected_override from item_modifier_lists where location_id = $1 order by ordinal", [locationId]),
    many<{ id: string; name: string; selection_type: ModifierList["selectionType"]; min_selected: number | null; max_selected: number | null; is_deleted: boolean }>(
      tx, "select id, name, selection_type, min_selected, max_selected, is_deleted from modifier_lists where location_id = $1", [locationId]),
    many<{ id: string; modifier_list_id: string; name: string; price_minor: number; sold_out: boolean; is_deleted: boolean; on_by_default: boolean }>(
      tx, "select id, modifier_list_id, name, price_minor, sold_out, is_deleted, on_by_default from modifiers where location_id = $1 order by ordinal, name", [locationId]),
    many<{ modifier_id: string; child_list_id: string }>(tx, "select modifier_id, child_list_id from modifier_child_lists where location_id = $1", [locationId]),
    many<{ item_id: string; phrase: string }>(tx, "select item_id, phrase from menu_aliases where location_id = $1 order by lower(phrase)", [locationId]),
    maybeOne<{ last_success_at: string | null }>(tx, "select last_success_at from location_menu_status where location_id = $1", [locationId]),
  ]);

  const childrenByModifier = new Map<string, string[]>();
  for (const c of children) childrenByModifier.set(c.modifier_id, [...(childrenByModifier.get(c.modifier_id) ?? []), c.child_list_id]);

  const listMap: Record<string, ModifierList> = {};
  for (const l of lists) {
    listMap[l.id] = {
      id: l.id, name: l.name, selectionType: l.selection_type, min: l.min_selected, max: l.max_selected, deleted: l.is_deleted,
      options: options.filter((o) => o.modifier_list_id === l.id).map((o) => ({
        id: o.id, name: o.name, priceMinor: o.price_minor, soldOut: o.sold_out, deleted: o.is_deleted, onByDefault: o.on_by_default,
        childListIds: childrenByModifier.get(o.id) ?? [],
      })),
    };
  }

  const variationsByItem = new Map<string, Variation[]>();
  for (const v of variations) {
    const list = variationsByItem.get(v.item_id) ?? [];
    list.push({ id: v.id, name: v.name, pricingType: v.pricing_type, priceMinor: v.price_minor, soldOut: v.sold_out, deleted: v.is_deleted });
    variationsByItem.set(v.item_id, list);
  }
  const linksByItem = new Map<string, ItemListLink[]>();
  for (const k of links) {
    const list = linksByItem.get(k.item_id) ?? [];
    list.push({ listId: k.modifier_list_id, enabled: k.enabled, minOverride: k.min_selected_override, maxOverride: k.max_selected_override });
    linksByItem.set(k.item_id, list);
  }
  const aliasesByItem = new Map<string, string[]>();
  for (const al of aliases) aliasesByItem.set(al.item_id, [...(aliasesByItem.get(al.item_id) ?? []), al.phrase]);

  return {
    currency: loc?.currency ?? "USD",
    syncedAt: synced?.last_success_at ?? null,
    categories,
    items: items.map((i): MenuItem => ({
      id: i.id, name: i.name, description: i.description, categoryId: i.category_id, variations: variationsByItem.get(i.id) ?? [],
      lists: linksByItem.get(i.id) ?? [], aiHidden: i.ai_hidden, aiUnavailableUntil: i.ai_unavailable_until, deleted: i.is_deleted,
      aliases: aliasesByItem.get(i.id) ?? [],
    })),
    lists: listMap,
  };
}
