// What the order costs. A real caller is only ever read a total Square calculated (CalculateOrder);
// if Square can't price the order the AI says so and offers a person. A rough estimate exists for test
// calls only, and the database refuses to attach one to a real order.
import { subtotal, taxOn, type Order, type Totals } from "@receptionist/domain";
import { maybeOne, withSystem } from "@receptionist/db";
import type { Deps } from "../deps.ts";
import { SquareApiError } from "../providers/square.ts";
import { squareSession } from "./integration.ts";
import { buildSquareOrder } from "./square-order.ts";

export type PriceResult = { ok: true; totals: Totals } | { ok: false; reason: "NO_PRICING" | "SQUARE_ERROR" | "EMPTY"; message: string };

export async function priceOrder(deps: Deps, order: Order): Promise<PriceResult> {
  if (order.lines.length === 0) return { ok: false, reason: "EMPTY", message: "There's nothing on the order yet." };
  const at = deps.now().toISOString();
  const session = await squareSession(deps, order.locationId).catch(() => null);
  if (session?.posLocationId) {
    try {
      const body = await withSystem(deps.db, (tx) => buildSquareOrder(tx, order.id, session.posLocationId!));
      const priced = await session.api.calculateOrder(session.token, body);
      const total = priced.total_money?.amount;
      if (typeof total !== "number") return { ok: false, reason: "SQUARE_ERROR", message: "Square didn't return a total." };
      const tax = priced.total_tax_money?.amount ?? 0;
      return { ok: true, totals: { subtotalMinor: total - tax, taxMinor: tax, totalMinor: total, version: order.version, calculatedAt: at, source: "SQUARE" } };
    } catch (e) {
      return { ok: false, reason: "SQUARE_ERROR", message: e instanceof SquareApiError ? `Square couldn't price the order (${e.code}).` : "Square couldn't price the order." };
    }
  }
  if (order.isTest) {
    const loc = await withSystem(deps.db, (tx) => maybeOne<{ estimate_tax_rate_percent: number }>(tx, "select estimate_tax_rate_percent from locations where id = $1", [order.locationId]));
    const sub = subtotal(order);
    const tax = taxOn(sub, loc?.estimate_tax_rate_percent ?? 0);
    return { ok: true, totals: { subtotalMinor: sub, taxMinor: tax, totalMinor: sub + tax, version: order.version, calculatedAt: at, source: "ESTIMATE" } };
  }
  return { ok: false, reason: "NO_PRICING", message: "Prices come from Square, and Square isn't connected for this location." };
}
