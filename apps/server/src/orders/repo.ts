// Orders as the database stores them, and as the domain model sees them. The domain functions in
// @receptionist/domain decide whether a change is allowed; this file reads orders into that shape and
// writes the result back. The database re-checks everything with triggers, so a bug here can't
// confirm a stale version or edit a submitted order.
import type { Order, OrderLine, ModifierChoice, OrderStatus, PosMode } from "@receptionist/domain";
import { many, maybeOne, type Tx } from "@receptionist/db";

type OrderRow = {
  id: string; location_id: string; call_id: string | null; is_test: boolean; pos_mode: PosMode; local_status: OrderStatus;
  version: number; confirmed_version: number | null; confirmed_at: string | null; pickup_at: string | null;
  customer_name: string | null; customer_phone_e164: string | null; customer_phone_source: "CALLER_ID_CONFIRMED" | "SPOKEN" | null;
  special_instructions: string | null; currency: string; subtotal_minor: number | null; tax_minor: number | null; total_minor: number | null;
  totals_version: number | null; totals_calculated_at: string | null; totals_source: "SQUARE" | "ESTIMATE" | null;
  idempotency_key: string; submission_attempts: number; submitted_at: string | null; received_at: string | null; received_by: string | null;
  square_order_id: string | null; failed_reason: string | null; cancelled_reason: string | null; created_at: string; updated_at: string;
};

type ItemRow = {
  id: string; order_id: string; line_no: number; variation_id: string; item_id: string; item_name: string; variation_name: string;
  quantity: number; unit_price_minor: number; special_instructions: string | null;
};
type ModRow = {
  order_item_id: string; modifier_id: string; list_id: string; name: string; price_minor: number; quantity: number; parent_modifier_id: string | null;
};

const ORDER_COLUMNS = `o.id, o.location_id, o.call_id, o.is_test, o.pos_mode, o.local_status, o.version, o.confirmed_version, o.confirmed_at,
  o.pickup_at, o.customer_name, o.customer_phone_e164, o.customer_phone_source, o.special_instructions, o.currency,
  o.subtotal_minor, o.tax_minor, o.total_minor, o.totals_version, o.totals_calculated_at, o.totals_source, o.idempotency_key,
  o.submission_attempts, o.submitted_at, o.received_at, o.received_by, o.square_order_id, o.failed_reason, o.cancelled_reason,
  o.created_at, o.updated_at`;

/** Loads orders (with their lines and modifier choices) in the order given. Missing ids are skipped. */
export async function loadOrdersByIds(tx: Tx, ids: string[], opts: { forUpdate?: boolean } = {}): Promise<Order[]> {
  if (ids.length === 0) return [];
  const rows = await many<OrderRow>(tx, `select ${ORDER_COLUMNS} from orders o where o.id = any($1::uuid[]) ${opts.forUpdate ? "for update of o" : ""}`, [ids]);
  const items = await many<ItemRow>(
    tx,
    `select oi.id, oi.order_id, oi.line_no, oi.variation_id, v.item_id, oi.item_name, oi.variation_name, oi.quantity,
            oi.unit_price_minor, oi.special_instructions
       from order_items oi join menu_variations v on v.id = oi.variation_id
      where oi.order_id = any($1::uuid[]) order by oi.order_id, oi.line_no`,
    [ids],
  );
  const mods = items.length
    ? await many<ModRow>(
        tx,
        `select m.order_item_id, m.modifier_id, md.modifier_list_id as list_id, m.name, m.price_minor, m.quantity,
                p.modifier_id as parent_modifier_id
           from order_item_modifiers m
           join modifiers md on md.id = m.modifier_id
           left join order_item_modifiers p on p.id = m.parent_id
          where m.order_item_id = any($1::uuid[]) order by m.created_at, m.id`,
        [items.map((i) => i.id)],
      )
    : [];
  const modsByItem = new Map<string, ModifierChoice[]>();
  for (const m of mods) {
    const choice: ModifierChoice = {
      modifierId: m.modifier_id,
      listId: m.list_id,
      name: m.name,
      priceMinor: m.price_minor,
      quantity: m.quantity,
      ...(m.parent_modifier_id ? { parentModifierId: m.parent_modifier_id } : {}),
    };
    const list = modsByItem.get(m.order_item_id) ?? [];
    list.push(choice);
    modsByItem.set(m.order_item_id, list);
  }
  const linesByOrder = new Map<string, OrderLine[]>();
  for (const i of items) {
    const line: OrderLine = {
      lineNo: i.line_no,
      itemId: i.item_id,
      variationId: i.variation_id,
      itemName: i.item_name,
      variationName: i.variation_name,
      quantity: i.quantity,
      unitPriceMinor: i.unit_price_minor,
      modifiers: modsByItem.get(i.id) ?? [],
      ...(i.special_instructions ? { note: i.special_instructions } : {}),
    };
    const list = linesByOrder.get(i.order_id) ?? [];
    list.push(line);
    linesByOrder.set(i.order_id, list);
  }
  const byId = new Map(rows.map((r) => [r.id, toOrder(r, linesByOrder.get(r.id) ?? [])]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function loadOrder(tx: Tx, id: string, opts: { forUpdate?: boolean } = {}): Promise<Order | null> {
  return (await loadOrdersByIds(tx, [id], opts))[0] ?? null;
}

function toOrder(r: OrderRow, lines: OrderLine[]): Order {
  return {
    id: r.id,
    locationId: r.location_id,
    callId: r.call_id,
    isTest: r.is_test,
    posMode: r.pos_mode,
    status: r.local_status,
    version: r.version,
    confirmedVersion: r.confirmed_version,
    confirmedAt: r.confirmed_at,
    lines,
    customer: {
      ...(r.customer_name ? { name: r.customer_name } : {}),
      ...(r.customer_phone_e164 ? { phone: r.customer_phone_e164 } : {}),
      ...(r.customer_phone_source ? { phoneSource: r.customer_phone_source } : {}),
    },
    pickupAt: r.pickup_at,
    ...(r.special_instructions ? { note: r.special_instructions } : {}),
    currency: r.currency,
    totals:
      r.total_minor !== null && r.totals_version !== null && r.totals_calculated_at && r.totals_source
        ? {
            subtotalMinor: r.subtotal_minor ?? 0,
            taxMinor: r.tax_minor ?? 0,
            totalMinor: r.total_minor,
            version: r.totals_version,
            calculatedAt: r.totals_calculated_at,
            source: r.totals_source,
          }
        : null,
    idempotencyKey: r.idempotency_key,
    submissionAttempts: r.submission_attempts,
    submittedAt: r.submitted_at,
    receivedAt: r.received_at,
    receivedBy: r.received_by,
    posOrderId: r.square_order_id,
    failedReason: r.failed_reason,
    cancelledReason: r.cancelled_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function findOpenOrderForCall(tx: Tx, callId: string): Promise<string | null> {
  const r = await maybeOne<{ id: string }>(
    tx,
    `select id from orders where call_id = $1 and local_status in
       ('DRAFT','NEEDS_CLARIFICATION','READY_FOR_CONFIRMATION','CUSTOMER_CONFIRMED','SUBMISSION_PENDING','SUBMISSION_UNKNOWN')`,
    [callId],
  );
  return r?.id ?? null;
}
