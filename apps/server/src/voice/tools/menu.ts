import { formatMoney, freshness, itemAvailability, normalize, rules, searchMenu, type Menu, type MenuItem } from "@receptionist/domain";
import { withSystem } from "@receptionist/db";
import { z } from "zod";
import { loadMenu } from "../../menu/read.ts";
import type { CallContext } from "../context.ts";
import { ok, refuse, type ToolDef } from "./types.ts";

const money = (ctx: CallContext, minor: number) => formatMoney(minor, ctx.currency);

function summarise(ctx: CallContext, item: MenuItem, menu: Menu) {
  const live = item.variations.filter((v) => !v.deleted && !v.soldOut && v.priceMinor !== null);
  const needs = item.lists.some((l) => {
    const list = menu.lists[l.listId];
    return l.enabled && list && !list.deleted && rules(list, l).min >= 1;
  });
  return {
    item: ctx.handles.for("m", item.id),
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    variations: live.map((v) => ({ variation: ctx.handles.for("v", v.id), name: v.name, price: money(ctx, v.priceMinor!) })),
    must_choose_variation: live.length > 1,
    has_required_choices: needs,
  };
}

const searchSchema = z.object({ query: z.string().trim().min(1).max(80), category: z.string().trim().max(60).optional() });

export const searchMenuTool: ToolDef<typeof searchSchema> = {
  name: "search_menu",
  description: "Find menu items the caller asked for, by name or description. Returns up to 5 candidates with sizes and prices. Only offer items this returns; never invent an item, size or price.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What the caller said they want, e.g. 'oat latte'." },
      category: { type: "string", description: "Optional menu category to narrow the search." },
    },
    required: ["query"],
  },
  schema: searchSchema,
  async run(deps, ctx, args) {
    const menu = await withSystem(deps.db, (tx) => loadMenu(tx, ctx.locationId));
    const stale = freshness(menu.syncedAt, ctx.settings.menuStaleMaxAgeSeconds, deps.now()) === "stale";
    let found = searchMenu(menu, args.query, deps.now(), 8);
    if (args.category) {
      const want = normalize(args.category);
      const cats = new Set(menu.categories.filter((c) => normalize(c.name).includes(want)).map((c) => c.id));
      if (cats.size) found = found.filter((c) => c.item.categoryId && cats.has(c.item.categoryId));
    }
    const top = found.slice(0, 5);
    if (!top.length) {
      const names = menu.categories.map((c) => c.name).slice(0, 6);
      return ok({ matches: [], menu_is_stale: stale, say: "Nothing on the menu matches that. Offer the categories, or ask what else they would like.", categories: names });
    }
    return ok({ matches: top.map((c) => summarise(ctx, c.item, menu)), menu_is_stale: stale });
  },
};

const optionsSchema = z.object({ item: z.string().trim().min(1).max(20) });

export const getItemOptions: ToolDef<typeof optionsSchema> = {
  name: "get_item_options",
  description: "List the sizes and the choices (milk, bread, add-ons and so on) for one item from search_menu, including which choices are required and their extra cost.",
  parameters: { type: "object", properties: { item: { type: "string", description: "The item handle from search_menu, like 'm3'." } }, required: ["item"] },
  schema: optionsSchema,
  async run(deps, ctx, args) {
    const itemId = ctx.handles.resolve("m", args.item);
    if (!itemId) return refuse("UNKNOWN_ITEM", "I don't recognise that item. Search the menu again.");
    const menu = await withSystem(deps.db, (tx) => loadMenu(tx, ctx.locationId));
    const item = menu.items.find((i) => i.id === itemId);
    if (!item || !itemAvailability(item, deps.now()).orderable) return refuse("UNAVAILABLE", "That item isn't available right now.");
    const lists: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const visit = (listId: string, link: MenuItem["lists"][number] | undefined, opensFrom?: string) => {
      const list = menu.lists[listId];
      if (!list || list.deleted || seen.has(listId)) return;
      seen.add(listId);
      const r = rules(list, link);
      lists.push({
        list: ctx.handles.for("l", list.id), name: list.name, required: r.min >= 1, choose_at_least: r.min, choose_at_most: r.max,
        ...(opensFrom ? { only_when_chosen: opensFrom } : {}),
        options: list.options.filter((o) => !o.deleted && !o.soldOut).map((o) => ({
          option: ctx.handles.for("o", o.id), name: o.name, ...(o.priceMinor ? { extra_cost: money(ctx, o.priceMinor) } : {}),
          ...(o.childListIds.length ? { opens_choice: o.childListIds.map((c) => menu.lists[c]?.name).filter(Boolean) } : {}),
        })),
      });
      for (const o of list.options) for (const child of o.childListIds) visit(child, undefined, o.name);
    };
    for (const link of item.lists) if (link.enabled) visit(link.listId, link);
    const live = item.variations.filter((v) => !v.deleted && !v.soldOut && v.priceMinor !== null);
    return ok({
      item: args.item, name: item.name,
      variations: live.map((v) => ({ variation: ctx.handles.for("v", v.id), name: v.name, price: money(ctx, v.priceMinor!) })),
      must_choose_variation: live.length > 1, choices: lists,
    });
  },
};
