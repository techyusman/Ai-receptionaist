// Order writes. Each function loads the order with a row lock, asks the domain model whether the
// change is allowed, writes it, and returns the order as the database now holds it (the database
// owns the version number: its triggers bump it on every content change).
import { applyChange, createDraft, type Actor, type DraftChange, type Order, type OrderLine, type PosMode, type Result } from "@receptionist/domain";
import { many, one, type Tx } from "@receptionist/db";
import { loadOrder } from "./repo.ts";

export type Who = { actor: Actor; userId?: string | null; reason?: string };

/** The order_events trigger reads these settings to record who changed the status and why. */
async function stamp(tx: Tx, who: Who): Promise<void> {
  await tx.query(
    "select set_config('app.actor_type', $1, true), set_config('app.reason', $2, true), set_config('app.user_id', coalesce($3, current_setting('app.user_id', true), ''), true)",
    [who.actor, who.reason ?? "", who.userId ?? null],
  );
}

export async function createOrder(
  tx: Tx,
  input: { restaurantId: string; locationId: string; callId: string | null; isTest: boolean; posMode: PosMode; currency: string },
  who: Who,
): Promise<Order> {
  // Throws if a test order is aimed at a real POS; the database has the same check.
  createDraft({
    id: "pending", locationId: input.locationId, callId: input.callId, isTest: input.isTest, posMode: input.posMode,
    currency: input.currency, idempotencyKey: "pending", ctx: { actor: who.actor, at: new Date().toISOString() },
  });
  await stamp(tx, who);
  const row = await one<{ id: string }>(
    tx,
    `insert into orders (restaurant_id, location_id, call_id, is_test, pos_mode, currency)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.restaurantId, input.locationId, input.callId, input.isTest, input.posMode, input.currency],
  );
  return (await loadOrder(tx, row.id))!;
}

async function refreshLineTotals(tx: Tx, orderId: string): Promise<void> {
  await tx.query(
    `update order_items oi set line_total_minor = (oi.unit_price_minor + coalesce(
         (select sum(m.price_minor * m.quantity) from order_item_modifiers m where m.order_item_id = oi.id), 0)) * oi.quantity
      where oi.order_id = $1`,
    [orderId],
  );
}

async function insertModifiers(tx: Tx, restaurantId: string, itemRowId: string, line: Omit<OrderLine, "lineNo">): Promise<void> {
  // Parents first, so a nested choice can point at the row of the choice that opened it.
  const rowIdByModifier = new Map<string, string>();
  const pending = [...line.modifiers];
  let guard = pending.length + 1;
  while (pending.length && guard-- > 0) {
    for (let i = 0; i < pending.length; i++) {
      const m = pending[i]!;
      if (m.parentModifierId && !rowIdByModifier.has(m.parentModifierId)) continue;
      const ids = await one<{ square_modifier_id: string; square_modifier_list_id: string }>(
        tx,
        `select md.square_id as square_modifier_id, ml.square_id as square_modifier_list_id
           from modifiers md join modifier_lists ml on ml.id = md.modifier_list_id where md.id = $1`,
        [m.modifierId],
      );
      const r = await one<{ id: string }>(
        tx,
        `insert into order_item_modifiers (restaurant_id, order_item_id, parent_id, modifier_id, square_modifier_id,
                                           square_modifier_list_id, name, price_minor, quantity)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [restaurantId, itemRowId, m.parentModifierId ? rowIdByModifier.get(m.parentModifierId) : null, m.modifierId,
         ids.square_modifier_id, ids.square_modifier_list_id, m.name, m.priceMinor, m.quantity],
      );
      rowIdByModifier.set(m.modifierId, r.id);
      pending.splice(i, 1);
      i--;
    }
  }
  if (pending.length) throw new Error("A nested choice points at a parent that isn't on the line.");
}

async function addLine(tx: Tx, restaurantId: string, orderId: string, lineNo: number, line: Omit<OrderLine, "lineNo">): Promise<void> {
  const v = await one<{ square_id: string; item_square_id: string }>(
    tx,
    "select v.square_id, i.square_id as item_square_id from menu_variations v join menu_items i on i.id = v.item_id where v.id = $1",
    [line.variationId],
  );
  const item = await one<{ id: string }>(
    tx,
    `insert into order_items (restaurant_id, order_id, line_no, variation_id, square_item_id, square_variation_id, item_name,
                             variation_name, quantity, unit_price_minor, special_instructions, validation_status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'VALID') returning id`,
    [restaurantId, orderId, lineNo, line.variationId, v.item_square_id, v.square_id, line.itemName,
     line.variationName, line.quantity, line.unitPriceMinor, line.note ?? null],
  );
  await insertModifiers(tx, restaurantId, item.id, line);
}

/** Applies one edit to an open order. expectedVersion makes a repeated tool call fail instead of applying twice. */
export async function updateDraft(tx: Tx, orderId: string, change: DraftChange, who: Who, expectedVersion?: number): Promise<Order> {
  const order = await loadOrder(tx, orderId, { forUpdate: true });
  if (!order) throw new Error("order not found");
  // Validates frozen, quantity and line rules and the version; the SQL below only runs if this passes.
  applyChange(order, change, { actor: who.actor, at: new Date().toISOString(), expectedVersion });
  await stamp(tx, who);
  const { restaurant_id: restaurantId } = await one<{ restaurant_id: string }>(tx, "select restaurant_id from orders where id = $1", [orderId]);
  switch (change.op) {
    case "add": {
      const lineNo = order.lines.reduce((m, l) => Math.max(m, l.lineNo), 0) + 1;
      await addLine(tx, restaurantId, orderId, lineNo, change.line);
      break;
    }
    case "remove":
      await tx.query("delete from order_items where order_id = $1 and line_no = $2", [orderId, change.lineNo]);
      break;
    case "quantity":
      await tx.query("update order_items set quantity = $3 where order_id = $1 and line_no = $2", [orderId, change.lineNo, change.quantity]);
      break;
    case "modifiers": {
      const item = await one<{ id: string }>(tx, "select id from order_items where order_id = $1 and line_no = $2", [orderId, change.lineNo]);
      await tx.query("delete from order_item_modifiers where order_item_id = $1", [item.id]);
      const line = order.lines.find((l) => l.lineNo === change.lineNo)!;
      await insertModifiers(tx, restaurantId, item.id, { ...line, modifiers: change.modifiers });
      if (change.unitPriceMinor !== undefined) await tx.query("update order_items set unit_price_minor = $2 where id = $1", [item.id, change.unitPriceMinor]);
      break;
    }
    case "line-note":
      await tx.query("update order_items set special_instructions = $3 where order_id = $1 and line_no = $2", [orderId, change.lineNo, change.note ?? null]);
      break;
    case "customer":
      await tx.query(
        `update orders set customer_name = coalesce($2, customer_name), customer_phone_e164 = coalesce($3, customer_phone_e164),
                customer_phone_source = coalesce($4, customer_phone_source) where id = $1`,
        [orderId, change.customer.name ?? null, change.customer.phone ?? null, change.customer.phoneSource ?? null],
      );
      break;
    case "pickup":
      await tx.query("update orders set pickup_at = $2 where id = $1", [orderId, change.pickupAt]);
      break;
    case "note":
      await tx.query("update orders set special_instructions = $2 where id = $1", [orderId, change.note ?? null]);
      break;
  }
  await refreshLineTotals(tx, orderId);
  return (await loadOrder(tx, orderId))!;
}

/**
 * Runs a domain transition (confirm, accept, cancel, ...) and writes the lifecycle columns it changed.
 * The row stays locked until the transaction ends, so two staff tapping Accept at once serialise and
 * the second sees the order already accepted.
 */
export async function transition(tx: Tx, orderId: string, fn: (o: Order) => Result, who: Who): Promise<Order> {
  const before = await loadOrder(tx, orderId, { forUpdate: true });
  if (!before) throw new Error("order not found");
  const { order: next } = fn(before);
  await stamp(tx, who);
  await tx.query(
    `update orders set local_status = $2, confirmed_version = $3, confirmed_at = $4,
        subtotal_minor = $5, tax_minor = $6, total_minor = $7, totals_version = $8, totals_calculated_at = $9, totals_source = $10,
        idempotency_key = $11, submission_attempts = $12,
        last_submit_attempt_at = case when $12::int > submission_attempts then now() else last_submit_attempt_at end,
        submitted_at = $13, received_at = $14, received_by = $15, square_order_id = $16, failed_reason = $17, cancelled_reason = $18
      where id = $1`,
    [
      orderId, next.status, next.confirmedVersion, next.confirmedAt,
      next.totals?.subtotalMinor ?? null, next.totals?.taxMinor ?? null, next.totals?.totalMinor ?? null,
      next.totals?.version ?? null, next.totals?.calculatedAt ?? null, next.totals?.source ?? null,
      next.idempotencyKey, next.submissionAttempts, next.submittedAt, next.receivedAt, next.receivedBy,
      next.posOrderId, next.failedReason, next.cancelledReason,
    ],
  );
  return (await loadOrder(tx, orderId))!;
}

type AttemptOutcome = "CREATED" | "TRANSIENT_ERROR" | "VALIDATION_ERROR" | "AUTH_ERROR" | "TIMEOUT" | "RATE_LIMITED" | "UNKNOWN";

export async function recordAttemptStart(tx: Tx, order: Order, requestHash: Buffer): Promise<void> {
  const row = await one<{ restaurant_id: string }>(tx, "select restaurant_id from orders where id = $1", [order.id]);
  await tx.query(
    `insert into pos_submission_attempts (restaurant_id, order_id, attempt_no, order_version, idempotency_key, request_hash)
     values ($1, $2, $3, $4, $5, $6) on conflict (order_id, attempt_no) do nothing`,
    [row.restaurant_id, order.id, order.submissionAttempts, order.version, order.idempotencyKey, requestHash],
  );
}

export async function recordAttemptResult(
  tx: Tx,
  orderId: string,
  attemptNo: number,
  r: { outcome: AttemptOutcome; httpStatus?: number | null; providerRequestId?: string | null; squareOrderId?: string | null; errorCode?: string | null },
): Promise<void> {
  await tx.query(
    `update pos_submission_attempts set finished_at = now(), outcome = $3, http_status = $4, provider_request_id = $5,
            square_order_id = $6, error_code = $7 where order_id = $1 and attempt_no = $2`,
    [orderId, attemptNo, r.outcome, r.httpStatus ?? null, r.providerRequestId ?? null, r.squareOrderId ?? null, r.errorCode ?? null],
  );
}

export async function listAttempts(tx: Tx, orderId: string) {
  return many<{ attempt_no: number; started_at: string; outcome: string | null; http_status: number | null; idempotency_key: string }>(
    tx,
    "select attempt_no, started_at, outcome, http_status, idempotency_key from pos_submission_attempts where order_id = $1 order by attempt_no",
    [orderId],
  );
}
