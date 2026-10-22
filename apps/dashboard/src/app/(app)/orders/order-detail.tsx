import { lineTotal } from "@receptionist/domain";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState, StatusPill } from "@/components/ui/display";
import type { OrderDetail } from "@/data/types";
import { fmtDateTime, fmtTime, formatMoney, prettyPhone } from "@/lib/format";
import { statusVocabulary } from "@/lib/status";
import { OrderActions } from "./order-actions";

const actorLabel: Record<string, string> = { AI: "AI", SYSTEM: "System", STAFF: "Staff", SUPPORT: "Support", WEBHOOK: "Square" };

/** S12 order summary: items, totals, the full status timeline and submission attempts. */
export function OrderDetailPanel({
  order,
  timeZone,
  canAccept,
  canManage,
}: {
  order: OrderDetail | null;
  timeZone: string;
  canAccept: boolean;
  canManage: boolean;
}) {
  if (!order) {
    return (
      <EmptyState icon={SearchX} title="Order not found">
        It may belong to another location, or the link is wrong.
      </EmptyState>
    );
  }
  const money = (m: number) => formatMoney(m, order.currency);
  const label = (s: string) => (statusVocabulary.order as Record<string, { label: string }>)[s]?.label ?? s;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill domain="order" value={order.status} />
        {order.isTest && <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-xs font-semibold text-muted">Test order</span>}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Customer</dt>
        <dd className="text-fg">{order.customer.name || "Not given"}</dd>
        <dt className="text-muted">Callback</dt>
        <dd className="text-fg">
          {order.customer.phone ? (
            <a className="text-accent underline-offset-2 hover:underline" href={`tel:${order.customer.phone}`}>
              {prettyPhone(order.customer.phone)}
            </a>
          ) : (
            "Not given"
          )}
          {order.customer.phoneSource === "CALLER_ID_CONFIRMED" && <span className="text-muted"> (caller ID, confirmed)</span>}
        </dd>
        <dt className="text-muted">Pickup</dt>
        <dd className="text-fg">{order.pickupAt ? fmtTime(order.pickupAt, timeZone) : "As soon as possible"}</dd>
        <dt className="text-muted">Placed</dt>
        <dd className="text-fg">{fmtDateTime(order.createdAt, timeZone)}</dd>
        <dt className="text-muted">Goes to</dt>
        <dd className="text-fg">{order.posMode === "SQUARE" ? `Square${order.posOrderId ? ` (${order.posOrderId})` : ""}` : "Live orders screen"}</dd>
      </dl>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">Items</h3>
        {order.lines.length === 0 ? (
          <p className="text-sm text-muted">No items were added.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {order.lines.map((l) => (
              <li key={l.lineNo} className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">
                    {l.quantity} × {l.itemName} <span className="font-normal text-muted">({l.variationName})</span>
                  </p>
                  {l.modifiers.map((m) => (
                    <p key={`${m.listId}-${m.modifierId}`} className="text-xs text-muted">
                      {m.parentModifierId ? "↳ " : ""}
                      {m.name}
                      {m.priceMinor ? ` (+${money(m.priceMinor)})` : ""}
                    </p>
                  ))}
                  {l.note && <p className="text-xs text-muted italic">“{l.note}”</p>}
                </div>
                <span className="text-sm whitespace-nowrap text-fg">{money(lineTotal(l))}</span>
              </li>
            ))}
          </ul>
        )}
        {order.totals && (
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-right text-fg">{money(order.totals.subtotalMinor)}</dd>
            <dt className="text-muted">Tax</dt>
            <dd className="text-right text-fg">{money(order.totals.taxMinor)}</dd>
            <dt className="font-semibold text-fg">Total, paid at pickup</dt>
            <dd className="text-right font-semibold text-fg">{money(order.totals.totalMinor)}</dd>
          </dl>
        )}
      </section>

      <OrderActions id={order.id} status={order.status} customer={order.customer.name ?? "this caller"} canAccept={canAccept} canManage={canManage} />

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-fg">Timeline</h3>
        <ol className="flex flex-col gap-2 border-l-2 border-border pl-4">
          {order.events.map((e, i) => (
            <li key={i} className="text-sm">
              <p className="text-fg">
                {e.from ? `${label(e.from)} → ${label(e.to)}` : `Started: ${label(e.to)}`}
                <span className="text-muted"> · version {e.version}</span>
              </p>
              <p className="text-xs text-muted">
                {fmtTime(e.at, timeZone)} · {e.actorName ?? actorLabel[e.actor] ?? e.actor}
                {e.reason ? ` · ${e.reason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {order.attempts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">Submission attempts</h3>
          <ul className="flex flex-col gap-1 text-xs text-muted">
            {order.attempts.map((a) => (
              <li key={a.attemptNo}>
                Attempt {a.attemptNo} at {fmtTime(a.startedAt, timeZone)}: {a.outcome ? a.outcome.toLowerCase().replace("_", " ") : "no answer yet"}
                {a.httpStatus ? ` (HTTP ${a.httpStatus})` : ""} · key <span className="font-mono">{a.idempotencyKey.slice(0, 8)}…</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {order.callId && (
        <Link href={`/calls?call=${order.callId}`} className="text-sm text-accent underline underline-offset-2">
          Open the call
        </Link>
      )}
    </div>
  );
}
