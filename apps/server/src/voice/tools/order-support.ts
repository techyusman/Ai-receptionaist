// Shared by the order tools: finding or starting the call's order, turning the model's short handles
// into real menu ids, and describing an order back to the model in words it can read out.
import { formatMoney, lineTotal, prettyPhone, readBackDigits, type Menu, type Order, type OrderLine, type Selection } from "@receptionist/domain";
import { many, maybeOne, type Tx } from "@receptionist/db";
import type { CallContext } from "../context.ts";
import { createOrder } from "../../orders/service.ts";
import { loadOrder } from "../../orders/repo.ts";

export type ChoiceArg = { list: string; option: string; quantity?: number | undefined; parent_option?: string | undefined };

/** The one order this call is building, or null if none has been started. */
export async function currentOrder(tx: Tx, ctx: CallContext): Promise<Order | null> {
  const row = await maybeOne<{ id: string }>(
    tx,
    `select id from orders where call_id = $1 and local_status in
       ('DRAFT','NEEDS_CLARIFICATION','READY_FOR_CONFIRMATION','CUSTOMER_CONFIRMED','SUBMISSION_PENDING','SUBMISSION_UNKNOWN','SUBMITTED_TO_POS','POS_VISIBILITY_UNVERIFIED','RECEIVED_BY_RESTAURANT')
     order by created_at desc limit 1`,
    [ctx.callId],
  );
  return row ? loadOrder(tx, row.id) : null;
}

export async function startOrder(tx: Tx, ctx: CallContext): Promise<Order> {
  const live = await maybeOne<{ ordering_mode: "SQUARE" | "DASHBOARD_TICKET" }>(tx, "select ordering_mode from locations where id = $1 and ordering_mode <> 'DISABLED'", [ctx.locationId]);
  // A test call never goes to a real POS, whatever the location is set to.
  const posMode = ctx.isTest || !live || live.ordering_mode === "DASHBOARD_TICKET" ? "DASHBOARD_TICKET" : "SQUARE";
  return createOrder(tx, { restaurantId: ctx.restaurantId, locationId: ctx.locationId, callId: ctx.callId, isTest: ctx.isTest, posMode, currency: ctx.currency }, { actor: "AI" });
}

/** Resolves the handles in a model's choices. A handle that was never issued yields null, never a guess. */
export function selectionFrom(ctx: CallContext, base: { itemId: string; variationId?: string; quantity: number }, choices: ChoiceArg[] | undefined): Selection | { error: string } {
  const modifiers: Selection["modifiers"] = [];
  for (const c of choices ?? []) {
    const listId = ctx.handles.resolve("l", c.list);
    const optionId = ctx.handles.resolve("o", c.option);
    if (!listId || !optionId) return { error: "One of those choices isn't one I offered. Look the item's options up again." };
    const parentOptionId = c.parent_option ? ctx.handles.resolve("o", c.parent_option) : null;
    if (c.parent_option && !parentOptionId) return { error: "One of those choices isn't one I offered. Look the item's options up again." };
    modifiers.push({ listId, optionId, ...(c.quantity ? { quantity: c.quantity } : {}), ...(parentOptionId ? { parentOptionId } : {}) });
  }
  return { ...base, modifiers };
}

export function describeLine(ctx: CallContext, l: OrderLine) {
  return {
    line: l.lineNo, quantity: l.quantity, name: l.itemName, variation: l.variationName,
    choices: l.modifiers.map((m) => m.name), ...(l.note ? { note: l.note } : {}), line_price: formatMoney(lineTotal(l), ctx.currency),
  };
}

export function describeOrder(ctx: CallContext, o: Order) {
  return {
    version: o.version, status: o.status, lines: o.lines.map((l) => describeLine(ctx, l)),
    customer_name: o.customer.name ?? null, customer_phone: o.customer.phone ? prettyPhone(o.customer.phone) : null,
    ...(o.note ? { note: o.note } : {}),
  };
}

/** "2 1 2, 5 5 5, 0 1 0 1": digits grouped so they can be read slowly and checked. */
export const digitsForReadBack = (e164: string): string => readBackDigits(e164);

export async function listLinePrices(tx: Tx, orderId: string) {
  return many<{ line_no: number; line_total_minor: number }>(tx, "select line_no, line_total_minor from order_items where order_id = $1 order by line_no", [orderId]);
}
export type { Menu };
