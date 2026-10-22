import "server-only";
import type { BoardTicket } from "@/components/app/live-board";
import type { OrderSummary } from "@/data/types";
import { fmtTime, formatMoney } from "@/lib/format";

/** Order → ticket, formatted in the restaurant's time zone. */
export function toTicket(o: OrderSummary, timeZone: string): BoardTicket {
  return {
    id: o.id,
    customerName: o.customer.name || "Caller",
    phoneLast4: o.customer.phone?.slice(-4) ?? "----",
    pickup: o.pickupAt ? fmtTime(o.pickupAt, timeZone) : "ASAP",
    createdAt: o.createdAt,
    total: o.totals ? formatMoney(o.totals.totalMinor, o.currency) : "–",
    lines: o.lines.map((l) => ({
      qty: l.quantity,
      name: l.variationName && !["Regular", "Each"].includes(l.variationName) ? `${l.itemName} (${l.variationName})` : l.itemName,
      modifiers: l.modifiers.map((m) => m.name),
      note: l.note,
    })),
    state:
      o.status === "RECEIVED_BY_RESTAURANT"
        ? "accepted"
        : o.status === "SUBMISSION_UNKNOWN" || o.status === "POS_VISIBILITY_UNVERIFIED"
          ? "check-needed"
          : "new",
    test: o.isTest,
  };
}
