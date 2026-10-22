"use client";

import { Search, SearchX, Trash, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { addAlias, removeAlias, resyncMenu, setItemOverlay } from "@/app/actions/content";
import { FilterLinks } from "@/components/app/filters";
import { useAction } from "@/components/app/use-action";
import { Button, IconButton } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { Card, EmptyState, MobileDetail, Table, Td, Th, THead, Tr } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/field";
import { SyncIndicator } from "@/components/ui/live";
import type { MenuStatus } from "@/data/types";

export type ListRow = {
  id: string;
  name: string;
  rule: string;
  options: { name: string; price: string | null; soldOut: boolean; children: string[] }[];
};

export type ItemRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  prices: { name: string; price: string; soldOut: boolean }[];
  offered: boolean;
  reason: string | null;
  aliases: string[];
  aiHidden: boolean;
  unavailableToday: boolean;
  deleted: boolean;
  lists: ListRow[];
};

type Tab = "items" | "categories" | "lists";

export function MenuBrowser({
  tab,
  rows,
  lists,
  categories,
  status,
  canResync,
}: {
  tab: Tab;
  rows: ItemRow[];
  lists: (ListRow & { usedBy: string[] })[];
  categories: { id: string; name: string; items: number }[];
  status: MenuStatus;
  canResync: boolean;
}) {
  const [query, setQuery] = useState("");
  const [onlyOff, setOnlyOff] = useState(false);
  const sync = useAction();
  const q = query.trim().toLowerCase();
  const items = rows.filter((r) => (!onlyOff || !r.offered) && (!q || `${r.name} ${r.aliases.join(" ")} ${r.category}`.toLowerCase().includes(q)));
  const itemHref = (id: string) => `/menu?${new URLSearchParams({ ...(tab !== "items" ? { tab } : {}), item: id })}`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <SyncIndicator
          state={status.state}
          updatedAt={status.lastSuccessAt ?? undefined}
          error={status.lastErrorCode ?? undefined}
          onResync={canResync ? () => sync.run(() => resyncMenu(), { success: "Syncing the menu now" }) : undefined}
        />
        <span className="text-sm text-muted">
          {rows.filter((r) => r.offered).length} of {rows.filter((r) => !r.deleted).length} items can be ordered by phone
        </span>
      </Card>

      <FilterLinks
        label="Menu view"
        options={[
          { href: "/menu", label: "Items", active: tab === "items" },
          { href: "/menu?tab=categories", label: "Categories", active: tab === "categories" },
          { href: "/menu?tab=lists", label: "Choices and add-ons", active: tab === "lists" },
        ]}
      />

      {tab === "items" && (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <FormField label="Search the menu" className="md:w-80">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Item, spoken name or category" />
            </FormField>
            <label className="flex h-10 items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={onlyOff} onChange={(e) => setOnlyOff(e.target.checked)} className="size-4 accent-accent" />
              Only items the AI won&apos;t offer
            </label>
          </div>
          {rows.length === 0 ? (
            <Card>
              <EmptyState icon={UtensilsCrossed} title="No menu yet">
                Connect Square and pick a location. The menu syncs automatically.
              </EmptyState>
            </Card>
          ) : items.length === 0 ? (
            <Card>
              <EmptyState icon={SearchX} title="Nothing matches">
                Try another word, or clear the filter.
              </EmptyState>
            </Card>
          ) : (
            <Table>
              <caption className="sr-only">Menu items</caption>
              <THead>
                <tr>
                  <Th>Item</Th>
                  <Th desktopOnly>Category</Th>
                  <Th desktopOnly>Prices</Th>
                  <Th>Phone orders</Th>
                </tr>
              </THead>
              <tbody>
                {items.map((r) => (
                  <Tr key={r.id} className={r.deleted ? "opacity-60" : undefined}>
                    <Td>
                      <Link href={itemHref(r.id)} scroll={false} className="font-semibold text-fg hover:underline">
                        {r.name}
                      </Link>
                      {r.aliases.length > 0 && <span className="block text-xs text-muted">Also “{r.aliases.join("”, “")}”</span>}
                      <MobileDetail>
                        {r.category} · {r.prices.map((p) => `${p.name} ${p.price}`).join(" · ")}
                      </MobileDetail>
                    </Td>
                    <Td desktopOnly className="text-muted">{r.category}</Td>
                    <Td desktopOnly className="text-muted">
                      {r.prices.map((p) => (
                        <span key={p.name} className={`block ${p.soldOut ? "line-through" : ""}`}>
                          {p.name} {p.price}
                          {p.soldOut && <span className="sr-only"> (sold out)</span>}
                        </span>
                      ))}
                    </Td>
                    <Td>
                      {r.offered ? (
                        <span className="rounded-pill bg-success-subtle px-2 py-0.5 text-xs font-semibold text-success">Offered</span>
                      ) : (
                        <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted">{r.reason}</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}

      {tab === "categories" && (
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-semibold text-fg">{c.name}</span>
                <span className="text-muted">{c.items} items</span>
              </li>
            ))}
          </ul>
          <p className="pt-3 text-xs text-muted">Categories come from Square. The AI uses them to make sense of what callers ask for.</p>
        </Card>
      )}

      {tab === "lists" && (
        <div className="grid gap-4 md:grid-cols-2">
          {lists.map((l) => (
            <Card key={l.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-fg">{l.name}</h2>
                <span className="text-xs text-muted">{l.rule}</span>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {l.options.map((o) => (
                  <li key={o.name} className="text-fg">
                    <span className={o.soldOut ? "line-through" : undefined}>{o.name}</span>
                    {o.price && <span className="text-muted"> {o.price}</span>}
                    {o.soldOut && <span className="text-muted"> (sold out)</span>}
                    {o.children.length > 0 && <span className="block pl-4 text-xs text-muted">then asks: {o.children.join(", ")}</span>}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">{l.usedBy.length ? `Used by ${l.usedBy.join(", ")}` : "Not used by any item"}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* S24 item drawer ----------------------------------------------------------------- */

export function ItemPanel({ item, canEdit, endOfToday }: { item: ItemRow | null; canEdit: boolean; endOfToday: string }) {
  const [alias, setAlias] = useState("");
  const act = useAction();
  if (!item) {
    return (
      <EmptyState icon={Search} title="Item not found">
        It may have been removed from Square.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {item.description && <p className="text-sm text-fg">{item.description}</p>}
      <p className={`text-sm font-semibold ${item.offered ? "text-success" : "text-muted"}`}>{item.offered ? "The AI offers this by phone." : `Not offered by phone: ${item.reason}.`}</p>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">Sizes and prices</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {item.prices.map((p) => (
            <li key={p.name} className="flex justify-between gap-3">
              <span className="text-fg">{p.name}</span>
              <span className="text-muted">{p.soldOut ? "Sold out" : p.price}</span>
            </li>
          ))}
        </ul>
      </section>

      {item.lists.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">What the AI asks</h3>
          {item.lists.map((l) => (
            <div key={l.id} className="rounded-md border border-border p-3 text-sm">
              <p className="font-semibold text-fg">
                {l.name} <span className="font-normal text-muted">({l.rule})</span>
              </p>
              <p className="text-muted">{l.options.map((o) => `${o.name}${o.price ? ` ${o.price}` : ""}${o.soldOut ? " (sold out)" : ""}`).join(", ")}</p>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">What callers call it</h3>
        <p className="text-xs text-muted">The AI already understands the menu name. Add nicknames callers use.</p>
        {item.aliases.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {item.aliases.map((a) => (
              <li key={a} className="flex items-center gap-1 rounded-pill bg-surface-muted py-0.5 pr-1 pl-3 text-sm text-fg">
                {a}
                {canEdit && (
                  <IconButton label={`Remove “${a}”`} size="sm" className="size-6" onClick={() => act.run(() => removeAlias(item.id, a))}>
                    <Trash aria-hidden />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act.run(() => addAlias(item.id, alias), { success: `Callers can now say “${alias}”`, onDone: () => setAlias("") });
            }}
          >
            <FormField label="Add a nickname" className="flex-1" error={act.fieldError("phrase")}>
              <Input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={80} placeholder="e.g. iced coffee" />
            </FormField>
            <Button type="submit" variant="secondary" disabled={!alias.trim()} loading={act.pending}>
              Add
            </Button>
          </form>
        )}
      </section>

      {canEdit && !item.deleted && (
        <section className="flex flex-col gap-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-fg">For phone orders only</h3>
          <Switch
            label="Sold out for the rest of today"
            description="The AI stops offering it until tomorrow. Square isn't changed."
            checked={item.unavailableToday}
            onCheckedChange={(on) => act.run(() => setItemOverlay(item.id, { aiUnavailableUntil: on ? endOfToday : null }), { success: on ? "Marked sold out for today" : "Available again" })}
          />
          <Switch
            label="Never offer this by phone"
            description="For things that don't travel well, or staff-only items."
            checked={item.aiHidden}
            onCheckedChange={(on) => act.run(() => setItemOverlay(item.id, { aiHidden: on }), { success: on ? "Hidden from the AI" : "The AI can offer it again" })}
          />
        </section>
      )}
    </div>
  );
}
