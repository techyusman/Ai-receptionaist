"use client";

import {
  callerClaim,
  formatMoney,
  lineTotal,
  readBackDigits,
  rules,
  validateSelection,
  type Menu,
  type MenuItem,
  type ModifierList,
  type Order,
  type Selection,
  whatToSay,
} from "@receptionist/domain";
import { Bot, Phone, Search, Trash, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  testAddLine,
  testConfirm,
  testHangUp,
  testReadBack,
  testRemoveLine,
  testSearch,
  testSetCustomer,
  testStart,
  testSubmit,
} from "@/app/actions/test-agent";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, RadioGroup } from "@/components/ui/controls";
import { Banner, Card, EmptyState, StatusPill } from "@/components/ui/display";
import { FormField, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { prettyPhone } from "@/lib/format";

type Candidate = { itemId: string; name: string; matched: string; variations: { id: string; name: string; priceMinor: number }[] };

const ACTIVE = new Set(["DRAFT", "NEEDS_CLARIFICATION", "READY_FOR_CONFIRMATION", "CUSTOMER_CONFIRMED"]);

export function TestAgent(props: {
  menu: Menu;
  order: Order | null;
  aiNumber: string | null;
  currency: string;
  /** The location's country: the callback number is typed the local way (0300 1234567 in Pakistan). */
  country: string;
  restaurant: string;
  pickupPolicy: string;
  orderingOn: boolean;
  orderingOpen: boolean;
  nowIso: string;
}) {
  const { order, menu, currency } = props;
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, start] = useTransition();
  const money = (m: number) => formatMoney(m, currency);

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast({ title: r.message ?? "That didn't work.", variant: "error" });
      else done?.();
    });

  const begin = () =>
    start(async () => {
      const r = await testStart();
      if (!r.ok) return toast({ title: r.message, variant: "error" });
      router.replace(`${pathname}?order=${r.data}`);
    });

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <Phone aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
          <p className="text-sm text-fg">
            {props.aiNumber ? (
              <>
                Or call your AI number, <span className="font-semibold whitespace-nowrap">{prettyPhone(props.aiNumber)}</span>, from your own phone. Real calls
                connect once the phone line is set up.
              </>
            ) : (
              <>You don&apos;t have an AI phone number yet. <Link className="text-accent underline underline-offset-2" href="/agent/phone">Get one</Link> to test by phone.</>
            )}
          </p>
        </div>
      </Card>

      {props.orderingOn && !props.orderingOpen && (
        <Banner tone="info" title="Outside ordering hours">
          Real callers can&apos;t order right now. The AI answers their questions and follows your after-hours setting. You can still test here.
        </Banner>
      )}

      {!props.orderingOn && (
        <Banner tone="warning" title="Phone ordering is off">
          You can still walk through a test order. Real callers won&apos;t be offered ordering until it&apos;s on.
        </Banner>
      )}

      {!order || !ACTIVE.has(order.status) ? (
        <Card>
          {order && <FinishedOrder order={order} money={money} />}
          <EmptyState icon={Bot} title={order ? "Start another test call" : "Start a test call"} action={<Button onClick={begin} loading={pending}>Start a test call</Button>}>
            You play the caller. Each button runs the same step the AI runs on a real call.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <CallerPanel menu={menu} order={order} now={new Date(props.nowIso)} money={money} pending={pending} act={act} />
          <OrderPanel order={order} money={money} pending={pending} act={act} restaurant={props.restaurant} pickupPolicy={props.pickupPolicy} country={props.country} />
        </div>
      )}
    </div>
  );
}

/* What the caller asks for ------------------------------------------------------------ */

function CallerPanel({
  menu,
  order,
  now,
  money,
  pending,
  act,
}: {
  menu: Menu;
  order: Order;
  now: Date;
  money: (m: number) => string;
  pending: boolean;
  act: (fn: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [chosen, setChosen] = useState<MenuItem | null>(null);
  const [searching, startSearch] = useTransition();
  const toast = useToast();
  const editable = order.status === "DRAFT" || order.status === "NEEDS_CLARIFICATION" || order.status === "READY_FOR_CONFIRMATION" || order.status === "CUSTOMER_CONFIRMED";

  const search = () =>
    startSearch(async () => {
      const r = await testSearch(query);
      if (!r.ok) return toast({ title: r.message, variant: "error" });
      setResults(r.data);
      setChosen(null);
    });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <User aria-hidden className="size-4 text-muted" />
        <h2 className="text-lg text-fg">The caller asks for…</h2>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) search();
        }}
      >
        <FormField label="What the caller said" className="flex-1">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. a large oat latte" disabled={!editable} />
        </FormField>
        <Button type="submit" variant="secondary" className="mt-6.5" loading={searching} disabled={!editable || !query.trim()}>
          <Search aria-hidden /> Find
        </Button>
      </form>

      {results && !chosen && (
        <div className="flex flex-col gap-2" aria-live="polite">
          {results.length === 0 ? (
            <p className="rounded-md bg-surface-muted p-3 text-sm text-fg">
              <span className="font-semibold">The AI says:</span> “I can&apos;t find that on our menu right now. Is there something else I can get you?”
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">Menu matches (the AI only ever offers these):</p>
              <ul className="flex flex-col gap-1">
                {results.map((c) => (
                  <li key={c.itemId}>
                    <button
                      type="button"
                      onClick={() => setChosen(menu.items.find((i) => i.id === c.itemId) ?? null)}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <span className="text-sm font-semibold text-fg">
                        {c.name}
                        {c.matched !== c.name && <span className="block text-xs font-normal text-muted">heard “{c.matched}”</span>}
                      </span>
                      <span className="text-xs text-muted">{c.variations.map((v) => `${v.name} ${money(v.priceMinor)}`).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {chosen && (
        <ItemBuilder
          key={chosen.id}
          menu={menu}
          item={chosen}
          now={now}
          money={money}
          pending={pending}
          onCancel={() => setChosen(null)}
          onAdd={(sel) =>
            act(
              async () => {
                const r = await testAddLine(order.id, sel);
                if (r.ok && r.data.problems.length) return { ok: false, message: r.data.problems[0]!.message };
                return r;
              },
              () => {
                setChosen(null);
                setResults(null);
                setQuery("");
              },
            )
          }
        />
      )}
    </Card>
  );
}

function openLists(menu: Menu, item: MenuItem, picked: Record<string, string[]>): { list: ModifierList; min: number; max: number; parent?: string }[] {
  const out: { list: ModifierList; min: number; max: number; parent?: string }[] = [];
  const seen = new Set<string>();
  const visit = (listId: string, link?: MenuItem["lists"][number], parent?: string) => {
    const list = menu.lists[listId];
    if (!list || list.deleted || seen.has(listId)) return;
    seen.add(listId);
    out.push({ list, ...rules(list, link), parent });
    for (const optionId of picked[listId] ?? []) {
      const option = list.options.find((o) => o.id === optionId);
      for (const child of option?.childListIds ?? []) visit(child, undefined, optionId);
    }
  };
  for (const link of item.lists) if (link.enabled) visit(link.listId, link);
  return out;
}

function ItemBuilder({
  menu,
  item,
  now,
  money,
  pending,
  onAdd,
  onCancel,
}: {
  menu: Menu;
  item: MenuItem;
  now: Date;
  money: (m: number) => string;
  pending: boolean;
  onAdd: (sel: Selection) => void;
  onCancel: () => void;
}) {
  const variations = item.variations.filter((v) => !v.deleted);
  const [variationId, setVariationId] = useState<string | undefined>(variations.length === 1 ? variations[0]!.id : undefined);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const lists = openLists(menu, item, picked);

  const selection: Selection = {
    itemId: item.id,
    variationId,
    quantity,
    modifiers: lists.flatMap(({ list, parent }) => (picked[list.id] ?? []).map((optionId) => ({ listId: list.id, optionId, ...(parent ? { parentOptionId: parent } : {}) }))),
  };
  const problems = validateSelection(menu, selection, now);

  const toggle = (listId: string, optionId: string, single: boolean) =>
    setPicked((p) => {
      const cur = p[listId] ?? [];
      const next = single ? [optionId] : cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId];
      // Dropping an option closes its nested lists.
      const drop = new Set(cur.filter((x) => !next.includes(x)).flatMap((x) => menu.lists[listId]?.options.find((o) => o.id === x)?.childListIds ?? []));
      return Object.fromEntries(Object.entries({ ...p, [listId]: next }).filter(([k]) => !drop.has(k)));
    });

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-fg">{item.name}</h3>
          {item.description && <p className="text-sm text-muted">{item.description}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Back to results
        </Button>
      </div>

      {variations.length > 1 && (
        <RadioGroup
          legend="Size or option"
          variant="list"
          value={variationId}
          onValueChange={setVariationId}
          options={variations.map((v) => ({
            value: v.id,
            title: `${v.name} · ${v.priceMinor !== null ? money(v.priceMinor) : "price varies"}`,
            ...(v.soldOut ? { disabledReason: "Sold out" } : {}),
          }))}
        />
      )}

      {lists.map(({ list, min, max, parent }) => {
        const single = max === 1;
        const chosen = picked[list.id] ?? [];
        const hint = min === 0 ? (single ? "optional" : `optional, up to ${max}`) : min === max ? `choose ${min}` : `choose ${min} to ${max}`;
        return (
          <div key={list.id} className={parent ? "border-l-2 border-border pl-3" : undefined}>
            {single ? (
              <RadioGroup
                legend={`${list.name} (${hint})`}
                value={chosen[0] ?? (min === 0 ? "__none" : undefined)}
                onValueChange={(v) => (v === "__none" ? setPicked((p) => ({ ...p, [list.id]: [] })) : toggle(list.id, v, true))}
                options={[
                  ...(min === 0 ? [{ value: "__none", title: `No ${list.name.toLowerCase()}` }] : []),
                  ...list.options
                    .filter((o) => !o.deleted)
                    .map((o) => ({ value: o.id, title: o.priceMinor ? `${o.name} (+${money(o.priceMinor)})` : o.name, ...(o.soldOut ? { disabledReason: "Sold out" } : {}) })),
                ]}
              />
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-semibold text-fg">{`${list.name} (${hint})`}</legend>
                {list.options
                  .filter((o) => !o.deleted)
                  .map((o) => (
                    <Checkbox
                      key={o.id}
                      label={o.priceMinor ? `${o.name} (+${money(o.priceMinor)})` : o.name}
                      checked={chosen.includes(o.id)}
                      disabled={o.soldOut || (!chosen.includes(o.id) && chosen.length >= max)}
                      onCheckedChange={() => toggle(list.id, o.id, false)}
                    />
                  ))}
              </fieldset>
            )}
          </div>
        );
      })}

      <FormField label="How many">
        <Input type="number" min={1} max={99} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} className="w-24" />
      </FormField>

      {problems.length > 0 ? (
        <div className="rounded-md bg-surface-muted p-3 text-sm text-fg" aria-live="polite">
          <span className="font-semibold">The AI asks:</span> “{problems[0]!.message}”
        </div>
      ) : (
        <p className="text-sm text-success" aria-live="polite">
          Ready to add.
        </p>
      )}

      <Button onClick={() => onAdd(selection)} disabled={problems.length > 0} loading={pending}>
        Add to order
      </Button>
    </div>
  );
}

/* The order so far ----------------------------------------------------------------------- */

function OrderPanel({
  order,
  money,
  pending,
  act,
  restaurant,
  pickupPolicy,
  country,
}: {
  order: Order;
  money: (m: number) => string;
  pending: boolean;
  act: (fn: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) => void;
  restaurant: string;
  pickupPolicy: string;
  country: string;
}) {
  const [name, setName] = useState(order.customer.name ?? "");
  const [phone, setPhone] = useState(order.customer.phone ? order.customer.phone.replace(/^\+1/, "") : "");
  const hasCustomer = !!order.customer.name && !!order.customer.phone;
  const s = order.status;

  const say = (() => {
    if (order.lines.length === 0) return `“Thanks for calling ${restaurant}. What can I get started for you?”`;
    if (!hasCustomer) return "“Can I get a name and a callback number for the order?”";
    if (s === "DRAFT" || s === "NEEDS_CLARIFICATION") return "“Anything else? If not, I'll read the order back.”";
    if (s === "READY_FOR_CONFIRMATION" && order.totals)
      return `“That's ${order.lines.map((l) => `${l.quantity} ${l.variationName.toLowerCase() === "regular" ? "" : `${l.variationName.toLowerCase()} `}${l.itemName}${l.modifiers.length ? ` with ${l.modifiers.map((m) => m.name.toLowerCase()).join(" and ")}` : ""}`).join(", ")}. Your total is ${money(order.totals.totalMinor)} with tax, and you'll pay when you pick it up. Shall I send that in?”`;
    if (s === "CUSTOMER_CONFIRMED") return "“Great, sending it to the team now.”";
    return null;
  })();

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot aria-hidden className="size-4 text-muted" />
          <h2 className="text-lg text-fg">The order so far</h2>
        </div>
        <StatusPill domain="order" value={order.status} size="sm" />
      </div>

      {say && (
        <p className="rounded-md bg-accent-subtle p-3 text-sm text-fg" aria-live="polite">
          <span className="font-semibold text-accent">The AI says: </span>
          {say}
        </p>
      )}

      {order.lines.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. Ask for something on the left.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {order.lines.map((l) => (
            <li key={l.lineNo} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">
                  {l.quantity} × {l.itemName} <span className="font-normal text-muted">({l.variationName})</span>
                </p>
                {l.modifiers.length > 0 && <p className="text-xs text-muted">{l.modifiers.map((m) => m.name).join(", ")}</p>}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm text-fg">{money(lineTotal(l))}</span>
                <IconButton label={`Remove ${l.itemName}`} size="sm" disabled={pending} onClick={() => act(() => testRemoveLine(order.id, l.lineNo))}>
                  <Trash aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => testSetCustomer(order.id, name, phone));
        }}
      >
        <FormField label="Caller's name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Callback number">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" placeholder={country === "PK" ? "0300 1234567" : "212 555 0123"} />
        </FormField>
        <Button type="submit" variant="secondary" disabled={pending}>
          Save
        </Button>
      </form>
      {order.customer.phone && <p className="-mt-2 text-xs text-muted">The AI reads it back digit by digit: {readBackDigits(order.customer.phone)}.</p>}

      {order.totals && order.totals.version === order.version && (
        <dl className="grid grid-cols-2 gap-1 rounded-md bg-surface-muted p-3 text-sm">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-right text-fg">{money(order.totals.subtotalMinor)}</dd>
          <dt className="text-muted">Tax</dt>
          <dd className="text-right text-fg">{money(order.totals.taxMinor)}</dd>
          <dt className="font-semibold text-fg">Total, paid at pickup</dt>
          <dd className="text-right font-semibold text-fg">{money(order.totals.totalMinor)}</dd>
        </dl>
      )}
      {pickupPolicy && <p className="text-xs text-muted">Pickup policy the AI mentions: {pickupPolicy}</p>}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          variant="secondary"
          disabled={pending || order.lines.length === 0 || !hasCustomer || s === "READY_FOR_CONFIRMATION" || s === "CUSTOMER_CONFIRMED"}
          onClick={() => act(() => testReadBack(order.id))}
        >
          Read it back
        </Button>
        <Button variant="secondary" disabled={pending || s !== "READY_FOR_CONFIRMATION"} onClick={() => act(() => testConfirm(order.id, order.version))}>
          Caller says yes
        </Button>
        <Button
          disabled={pending || s !== "CUSTOMER_CONFIRMED"}
          onClick={() => act(() => testSubmit(order.id))}
        >
          Send to the restaurant
        </Button>
        <Button variant="ghost" className="ml-auto" disabled={pending} onClick={() => act(() => testHangUp(order.id))}>
          Caller hangs up
        </Button>
      </div>
      <p className="text-xs text-muted">Changing anything after the read-back sends the order back to “Taking order”, so the caller has to confirm again.</p>
    </Card>
  );
}

function FinishedOrder({ order, money }: { order: Order; money: (m: number) => string }) {
  const claim = callerClaim(order);
  // The exact sentence the voice agent would say, from the same shared rule.
  const told: Record<string, string> = { STOPPED: "Nothing was sent. The draft was dropped." };
  if (claim !== "STOPPED") told[claim] = `“${whatToSay(claim, order)}”`;
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-fg">Last test call</h2>
        <StatusPill domain="order" value={order.status} size="sm" />
      </div>
      <p className="text-sm text-fg">
        {order.lines.length ? order.lines.map((l) => `${l.quantity} × ${l.itemName}`).join(", ") : "No items"}
        {order.totals ? ` · ${money(order.totals.totalMinor)}` : ""}
      </p>
      {told[claim] && (
        <p className="text-sm text-muted">
          <span className="font-semibold text-fg">The AI told the caller: </span>
          {told[claim]}
        </p>
      )}
      {order.status === "SUBMITTED_TO_POS" && (
        <Link href="/live" className="text-sm text-accent underline underline-offset-2">
          See it on Live orders
        </Link>
      )}
    </div>
  );
}
