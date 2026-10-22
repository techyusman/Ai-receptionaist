import { itemAvailability, localClock, rules, zonedTimeToUtc, type Menu, type MenuItem } from "@receptionist/domain";
import type { Metadata } from "next";
import { Suspense } from "react";
import { str } from "@/components/app/filters";
import { CardSkeleton, PageHeader } from "@/components/app/page";
import { UrlDrawer } from "@/components/app/url-drawer";
import { fmtTime, formatMoney } from "@/lib/format";
import { can } from "@/lib/permissions";
import * as api from "@/server/api";
import { ItemPanel, MenuBrowser, type ItemRow, type ListRow } from "./menu-browser";

export const metadata: Metadata = { title: "Menu" };

// S23 menu browser, with S24 (item details and AI overlays) as a drawer on ?item=.
export default function MenuPage({ searchParams }: PageProps<"/menu">) {
  return (
    <>
      <PageHeader title="Menu" description="What the AI can offer, synced from Square. Change items and prices in Square; use this page for spoken names and to stop the AI offering something." />
      <Suspense fallback={<CardSkeleton rows={10} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const why = { DELETED: "Deleted in Square", HIDDEN: "Hidden from the AI", "86_UNTIL": "Unavailable today", SOLD_OUT: "Sold out in Square", NO_FIXED_PRICE: "No fixed price" } as const;

function ruleText(min: number, max: number): string {
  if (min === 0) return max === 1 ? "optional, pick 1" : `optional, up to ${max}`;
  return min === max ? `required, pick ${min}` : `required, pick ${min} to ${max}`;
}

function toListRow(menu: Menu, listId: string, min: number, max: number): ListRow | null {
  const list = menu.lists[listId];
  if (!list || list.deleted) return null;
  return {
    id: list.id,
    name: list.name,
    rule: ruleText(min, max),
    options: list.options
      .filter((o) => !o.deleted)
      .map((o) => ({
        name: o.name,
        price: o.priceMinor ? `+${formatMoney(o.priceMinor, menu.currency)}` : null,
        soldOut: o.soldOut,
        children: o.childListIds.map((c) => menu.lists[c]).filter((c) => !!c && !c.deleted).map((c) => `${c!.name} (${ruleText(rules(c!).min, rules(c!).max)})`),
      })),
  };
}

async function Content({ searchParams }: { searchParams: PageProps<"/menu">["searchParams"] }) {
  const sp = await searchParams;
  const itemId = str(sp.item);
  const tab = str(sp.tab) === "lists" ? "lists" : str(sp.tab) === "categories" ? "categories" : "items";
  const [menu, status, location, session] = await Promise.all([api.getMenu(), api.getMenuStatus(), api.getLocation(), api.getSessionInfo()]);
  const tz = location.timezone;
  const now = new Date();
  const categories = new Map(menu.categories.map((c) => [c.id, c.name]));

  const toRow = (i: MenuItem): ItemRow => {
    const a = itemAvailability(i, now);
    return {
      id: i.id,
      name: i.name,
      description: i.description,
      category: i.categoryId ? (categories.get(i.categoryId) ?? "Uncategorised") : "Uncategorised",
      prices: i.variations
        .filter((v) => !v.deleted)
        .map((v) => ({ name: v.name, price: v.priceMinor !== null ? formatMoney(v.priceMinor, menu.currency) : "Varies", soldOut: v.soldOut })),
      offered: a.orderable,
      reason: a.orderable ? null : a.reason === "86_UNTIL" && i.aiUnavailableUntil ? `Unavailable until ${fmtTime(i.aiUnavailableUntil, tz)}` : why[a.reason],
      aliases: i.aliases,
      aiHidden: i.aiHidden,
      unavailableToday: !!i.aiUnavailableUntil && new Date(i.aiUnavailableUntil) > now,
      deleted: i.deleted,
      lists: i.lists
        .filter((l) => l.enabled)
        .map((l) => {
          const list = menu.lists[l.listId];
          return list ? toListRow(menu, l.listId, rules(list, l).min, rules(list, l).max) : null;
        })
        .filter((x): x is ListRow => !!x),
    };
  };

  const rows = menu.items.map(toRow).sort((a, b) => Number(b.offered) - Number(a.offered) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const lists = Object.values(menu.lists)
    .filter((l) => !l.deleted)
    .map((l) => ({ ...toListRow(menu, l.id, rules(l).min, rules(l).max)!, usedBy: menu.items.filter((i) => !i.deleted && i.lists.some((x) => x.enabled && x.listId === l.id)).map((i) => i.name) }));
  const cats = menu.categories.map((c) => ({ id: c.id, name: c.name, items: rows.filter((r) => r.category === c.name && !r.deleted).length }));
  const item = itemId ? rows.find((r) => r.id === itemId) ?? null : null;
  const endOfToday = zonedTimeToUtc(localClock(now, tz).date, "23:59", tz).toISOString();
  const canEdit = can(session.role, "menu.overlay");
  const base = tab === "items" ? "/menu" : `/menu?tab=${tab}`;

  return (
    <>
      <MenuBrowser
        tab={tab}
        rows={rows}
        lists={lists}
        categories={cats}
        status={status}
        canResync={can(session.role, "square.connect")}
      />
      <UrlDrawer open={!!itemId} title={item?.name ?? "Item"} closeHref={base}>
        {itemId && <ItemPanel item={item} canEdit={canEdit} endOfToday={endOfToday} />}
      </UrlDrawer>
    </>
  );
}
