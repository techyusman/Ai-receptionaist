// Menu read model and validation (spec §6.3, §10). Square is the source of truth; this is the cache
// the AI reads during a call. Nothing here trusts a model-chosen id: every reference is looked up.

import type { ModifierChoice, OrderLine } from "./order.ts";

export type ModifierOption = {
  id: string;
  name: string;
  priceMinor: number;
  soldOut: boolean;
  deleted: boolean;
  onByDefault: boolean;
  /** Nested modifier lists that open when this option is chosen. */
  childListIds: string[];
};

export type ModifierList = {
  id: string;
  name: string;
  selectionType: "SINGLE" | "MULTIPLE";
  min: number | null;
  max: number | null;
  options: ModifierOption[];
  deleted: boolean;
};

export type Variation = {
  id: string;
  name: string;
  pricingType: "FIXED_PRICING" | "VARIABLE_PRICING";
  priceMinor: number | null;
  soldOut: boolean;
  deleted: boolean;
};

export type ItemListLink = {
  listId: string;
  /** Square disables a list on an item instead of removing it. */
  enabled: boolean;
  minOverride: number | null;
  maxOverride: number | null;
};

export type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  variations: Variation[];
  lists: ItemListLink[];
  /** Platform overlay: never offer by phone. */
  aiHidden: boolean;
  /** Platform overlay: 86'd until this time (ISO). */
  aiUnavailableUntil: string | null;
  deleted: boolean;
  aliases: string[];
};

export type MenuCategory = { id: string; name: string; ordinal: number };

export type Menu = {
  currency: string;
  syncedAt: string | null;
  categories: MenuCategory[];
  items: MenuItem[];
  lists: Record<string, ModifierList>;
};

export type Rules = { min: number; max: number };

/** Effective min/max for a list on an item: item override, then list setting, then Square's default. */
export function rules(list: ModifierList, link?: ItemListLink): Rules {
  const live = list.options.filter((o) => !o.deleted).length;
  const min = link?.minOverride ?? list.min ?? 0;
  const max = link?.maxOverride ?? list.max ?? (list.selectionType === "SINGLE" ? 1 : live);
  return { min, max: Math.max(max, min) };
}

export type Unavailable = "DELETED" | "HIDDEN" | "86_UNTIL" | "SOLD_OUT" | "NO_FIXED_PRICE";

export function itemAvailability(item: MenuItem, at: Date): { orderable: true } | { orderable: false; reason: Unavailable } {
  if (item.deleted) return { orderable: false, reason: "DELETED" };
  if (item.aiHidden) return { orderable: false, reason: "HIDDEN" };
  if (item.aiUnavailableUntil && new Date(item.aiUnavailableUntil) > at) return { orderable: false, reason: "86_UNTIL" };
  const live = item.variations.filter((v) => !v.deleted);
  if (live.length === 0 || live.every((v) => v.soldOut)) return { orderable: false, reason: "SOLD_OUT" };
  if (live.every((v) => v.pricingType !== "FIXED_PRICING" || v.priceMinor === null)) {
    return { orderable: false, reason: "NO_FIXED_PRICE" };
  }
  return { orderable: true };
}

/* Search ------------------------------------------------------------------- */

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of x) {
    overlap += Math.min(n, y.get(g) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total === 0 ? 0 : (2 * overlap) / total;
}

function score(query: string, name: string): number {
  if (!query || !name) return 0;
  if (query === name) return 1;
  if (name.startsWith(query) || name.includes(` ${query}`)) return 0.85;
  const qTokens = query.split(" ");
  const nTokens = new Set(name.split(" "));
  const tokenHit = qTokens.filter((t) => nTokens.has(t)).length / qTokens.length;
  return Math.max(similarity(query, name), tokenHit * 0.8);
}

export type Candidate = { item: MenuItem; score: number; matched: string };

/** Up to `limit` orderable items for what the caller said. Below 0.35 is not a match. */
export function searchMenu(menu: Menu, query: string, at: Date, limit = 5): Candidate[] {
  const q = normalize(query);
  if (!q) return [];
  const out: Candidate[] = [];
  for (const item of menu.items) {
    if (!itemAvailability(item, at).orderable) continue;
    let best = { score: 0, matched: item.name };
    for (const label of [item.name, ...item.aliases]) {
      const s = score(q, normalize(label));
      if (s > best.score) best = { score: s, matched: label };
    }
    if (best.score >= 0.35) out.push({ item, ...best });
  }
  return out.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit);
}

/* Validation --------------------------------------------------------------- */

export type Selection = {
  itemId: string;
  variationId?: string;
  quantity: number;
  modifiers: { listId: string; optionId: string; quantity?: number; parentOptionId?: string }[];
};

export type ProblemCode =
  | "ITEM_NOT_FOUND"
  | "ITEM_UNAVAILABLE"
  | "VARIATION_REQUIRED"
  | "VARIATION_NOT_FOUND"
  | "VARIATION_UNAVAILABLE"
  | "QUANTITY"
  | "LIST_NOT_ON_ITEM"
  | "OPTION_NOT_FOUND"
  | "OPTION_UNAVAILABLE"
  | "TOO_FEW"
  | "TOO_MANY";

export type Problem = { code: ProblemCode; message: string; listId?: string };

export function validateSelection(menu: Menu, sel: Selection, at: Date): Problem[] {
  const problems: Problem[] = [];
  const item = menu.items.find((i) => i.id === sel.itemId);
  if (!item) return [{ code: "ITEM_NOT_FOUND", message: "That item isn't on the current menu." }];
  const avail = itemAvailability(item, at);
  if (!avail.orderable) return [{ code: "ITEM_UNAVAILABLE", message: `${item.name} isn't available right now.` }];

  if (!Number.isInteger(sel.quantity) || sel.quantity < 1 || sel.quantity > 99) {
    problems.push({ code: "QUANTITY", message: "Quantity must be from 1 to 99." });
  }

  const liveVariations = item.variations.filter((v) => !v.deleted);
  if (!sel.variationId) {
    if (liveVariations.length > 1) {
      problems.push({ code: "VARIATION_REQUIRED", message: `Which ${item.name}: ${liveVariations.map((v) => v.name).join(", ")}?` });
    }
  } else {
    const v = liveVariations.find((x) => x.id === sel.variationId);
    if (!v) problems.push({ code: "VARIATION_NOT_FOUND", message: "That size or option isn't on the menu." });
    else if (v.soldOut || v.pricingType !== "FIXED_PRICING" || v.priceMinor === null) {
      problems.push({ code: "VARIATION_UNAVAILABLE", message: `${item.name} (${v.name}) isn't available right now.` });
    }
  }

  // Open lists: the item's enabled lists, then (repeatedly) the child lists of chosen options, so
  // nested modifiers of any depth are checked, including required ones nothing was picked from.
  const open = new Map<string, { list: ModifierList; link?: ItemListLink }>();
  for (const link of item.lists) {
    const list = menu.lists[link.listId];
    if (link.enabled && list && !list.deleted) open.set(list.id, { list, link });
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of sel.modifiers) {
      const option = open.get(m.listId)?.list.options.find((o) => o.id === m.optionId && !o.deleted);
      for (const childId of option?.childListIds ?? []) {
        const child = menu.lists[childId];
        if (child && !child.deleted && !open.has(childId)) {
          open.set(childId, { list: child });
          grew = true;
        }
      }
    }
  }
  const chosenByList = new Map<string, number>();

  for (const m of sel.modifiers) {
    const entry = open.get(m.listId);
    if (!entry) {
      problems.push({ code: "LIST_NOT_ON_ITEM", message: `That choice doesn't apply to ${item.name}.`, listId: m.listId });
      continue;
    }
    const option = entry.list.options.find((o) => o.id === m.optionId);
    if (!option || option.deleted) {
      problems.push({ code: "OPTION_NOT_FOUND", message: `That isn't one of the ${entry.list.name} choices.`, listId: m.listId });
      continue;
    }
    if (option.soldOut) {
      problems.push({ code: "OPTION_UNAVAILABLE", message: `${option.name} isn't available right now.`, listId: m.listId });
    }
    chosenByList.set(m.listId, (chosenByList.get(m.listId) ?? 0) + (m.quantity ?? 1));
  }

  for (const { list, link } of open.values()) {
    const { min, max } = rules(list, link);
    const n = chosenByList.get(list.id) ?? 0;
    if (n < min) {
      const names = list.options.filter((o) => !o.deleted && !o.soldOut).map((o) => o.name);
      problems.push({
        code: "TOO_FEW",
        listId: list.id,
        message: min === 1 ? `Choose a ${list.name.toLowerCase()}: ${names.join(", ")}.` : `Choose at least ${min} for ${list.name}.`,
      });
    } else if (n > max) {
      problems.push({ code: "TOO_MANY", listId: list.id, message: `Choose at most ${max} for ${list.name}.` });
    }
  }
  return problems;
}

/** Builds a priced order line. Call validateSelection first; this throws on unknown references. */
export function toOrderLine(menu: Menu, sel: Selection): Omit<OrderLine, "lineNo"> {
  const item = menu.items.find((i) => i.id === sel.itemId);
  if (!item) throw new Error(`Unknown item ${sel.itemId}`);
  const live = item.variations.filter((v) => !v.deleted);
  const variation = sel.variationId ? live.find((v) => v.id === sel.variationId) : live.length === 1 ? live[0] : undefined;
  if (!variation || variation.priceMinor === null) throw new Error(`No priced variation for ${item.name}`);
  const modifiers: ModifierChoice[] = sel.modifiers.map((m) => {
    const option = menu.lists[m.listId]?.options.find((o) => o.id === m.optionId);
    if (!option) throw new Error(`Unknown option ${m.optionId}`);
    const parent = m.parentOptionId;
    return {
      modifierId: option.id,
      listId: m.listId,
      name: option.name,
      priceMinor: option.priceMinor,
      quantity: m.quantity ?? 1,
      ...(parent ? { parentModifierId: parent } : {}),
    };
  });
  return {
    itemId: item.id,
    variationId: variation.id,
    itemName: item.name,
    variationName: variation.name,
    quantity: sel.quantity,
    unitPriceMinor: variation.priceMinor,
    modifiers,
  };
}

export type Freshness = "fresh" | "stale";

/** Orders are refused on a stale menu (FR-MENU-010). */
export function freshness(syncedAt: string | null, maxAgeSeconds: number, now: Date): Freshness {
  if (!syncedAt) return "stale";
  return now.getTime() - new Date(syncedAt).getTime() > maxAgeSeconds * 1000 ? "stale" : "fresh";
}
