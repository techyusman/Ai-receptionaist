import { cancelOrderInput, listOrdersQuery, PAGE_SIZE, type OrderDetail, type OrderSummary, type Page, type SubmissionAttempt } from "@receptionist/contracts";
import { accept as acceptRule, cancel as cancelRule, type Order, type OrderEvent } from "@receptionist/domain";
import { many, maybeOne, one, type Tx } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { notFound, rule } from "../errors.ts";
import { idParam, lidParam, meta, parse, who } from "../http.ts";
import { signal } from "../live.ts";
import { loadOrder, loadOrdersByIds } from "../orders/repo.ts";
import { listAttempts, transition } from "../orders/service.ts";
import { tenant } from "./util.ts";

const RANGE_DAYS = { today: 0, "7d": 6, "30d": 29, all: null } as const;

// The same four views the dashboard tabs show; "attention" is anything where the order's fate is unclear.
const VIEW_SQL = {
  open: "o.local_status in ('SUBMITTED_TO_POS','DRAFT','NEEDS_CLARIFICATION','READY_FOR_CONFIRMATION','CUSTOMER_CONFIRMED','SUBMISSION_PENDING','SUBMISSION_UNKNOWN')",
  accepted: "o.local_status = 'RECEIVED_BY_RESTAURANT'",
  attention: "o.local_status in ('SUBMISSION_UNKNOWN','POS_VISIBILITY_UNVERIFIED','FAILED')",
  all: "true",
} as const;

export const toSummary = (o: Order): OrderSummary => ({
  id: o.id, status: o.status, posMode: o.posMode, isTest: o.isTest, createdAt: o.createdAt, pickupAt: o.pickupAt, currency: o.currency,
  totals: o.totals, customer: o.customer, lines: o.lines, posOrderId: o.posOrderId, callId: o.callId,
});

export async function orderDetail(tx: Tx, id: string): Promise<OrderDetail | null> {
  const order = await loadOrder(tx, id);
  if (!order) return null;
  const events = await many<{ from_status: OrderEvent["from"]; to_status: OrderEvent["to"]; order_version: number; actor_type: OrderEvent["actor"]; reason: string | null; occurred_at: string; actor_name: string | null }>(
    tx,
    `select e.from_status, e.to_status, e.order_version, e.actor_type, e.reason, e.occurred_at, coalesce(u.display_name, u.email) as actor_name
       from order_events e left join users u on u.id = e.actor_user_id where e.order_id = $1 order by e.occurred_at, e.created_at, e.id`,
    [id],
  );
  const attempts = await listAttempts(tx, id);
  return {
    ...order,
    events: events.map((e) => ({
      from: e.from_status, to: e.to_status, version: e.order_version, actor: e.actor_type, at: e.occurred_at,
      ...(e.reason ? { reason: e.reason } : {}), actorName: e.actor_name,
    })),
    attempts: attempts.map((t): SubmissionAttempt => ({
      attemptNo: t.attempt_no, startedAt: t.started_at, httpStatus: t.http_status, idempotencyKey: t.idempotency_key,
      outcome: t.outcome as SubmissionAttempt["outcome"],
    })),
  };
}

function rangeClause(range: keyof typeof RANGE_DAYS, now: Date): { sql: string; params: unknown[] } {
  const days = RANGE_DAYS[range];
  if (days === null) return { sql: "true", params: [] };
  return { sql: "(o.created_at at time zone l.timezone)::date >= ((($1::timestamptz) at time zone l.timezone)::date - $2::int)", params: [now.toISOString(), days] };
}

export function registerOrderRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/orders", async (req): Promise<Page<OrderSummary>> => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "orders.view");
    const q = parse(listOrdersQuery, req.query);
    const offset = Math.max(0, Number(q.cursor) || 0);
    return tenant(deps, a, async (tx) => {
      const range = rangeClause(q.range, deps.now());
      const base = `from orders o join locations l on l.id = o.location_id where o.location_id = $${range.params.length + 1} and ${VIEW_SQL[q.view]} and ${range.sql}`;
      const params = [...range.params, lid];
      const total = await one<{ n: number }>(tx, `select count(*)::int as n ${base}`, params);
      const ids = await many<{ id: string }>(tx, `select o.id ${base} order by o.created_at desc, o.id limit ${PAGE_SIZE} offset ${offset}`, params);
      const orders = await loadOrdersByIds(tx, ids.map((r) => r.id));
      return { items: orders.map(toSummary), total: total.n, nextCursor: offset + PAGE_SIZE < total.n ? String(offset + PAGE_SIZE) : null };
    });
  });

  api.get("/locations/:lid/orders/counts", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "orders.view");
    return tenant(deps, a, async (tx) => {
      const r = await one<Record<"open" | "accepted" | "attention" | "all", number>>(
        tx,
        `select count(*) filter (where ${VIEW_SQL.open})::int as open, count(*) filter (where ${VIEW_SQL.accepted})::int as accepted,
                count(*) filter (where ${VIEW_SQL.attention})::int as attention, count(*)::int as "all"
           from orders o where o.location_id = $1`,
        [lid],
      );
      return r;
    });
  });

  // The Live orders board: tickets waiting for staff, anything uncertain, and the last half hour of accepted ones.
  api.get("/locations/:lid/live-tickets", async (req): Promise<OrderSummary[]> => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "orders.view");
    return tenant(deps, a, async (tx) => {
      const ids = await many<{ id: string }>(
        tx,
        `select id from orders where location_id = $1 and (
           local_status in ('SUBMITTED_TO_POS','SUBMISSION_UNKNOWN','POS_VISIBILITY_UNVERIFIED','SUBMISSION_PENDING')
           or (local_status = 'RECEIVED_BY_RESTAURANT' and received_at > $2::timestamptz - interval '30 minutes'))
         order by created_at, id`,
        [lid, deps.now().toISOString()],
      );
      return (await loadOrdersByIds(tx, ids.map((r) => r.id))).map(toSummary);
    });
  });

  api.get("/orders/:id", async (req): Promise<OrderDetail> => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "order", id, "orders.view");
    const detail = await tenant(deps, a, (tx) => orderDetail(tx, id));
    if (!detail) throw notFound();
    return detail;
  });

  api.post("/orders/:id/accept", async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "order", id, "orders.accept");
    return tenant(deps, a, async (tx) => {
      const current = await maybeOne<{ local_status: string }>(tx, "select local_status from orders where id = $1 for update", [id]);
      if (!current) throw notFound();
      if (current.local_status === "RECEIVED_BY_RESTAURANT") return { ok: true }; // a double tap is harmless
      const order = await transition(tx, id, (o) => acceptRule(o, a.userId, { actor: "STAFF", at: deps.now().toISOString() }), { actor: "STAFF", userId: a.userId });
      await signal(tx, a.locationId, { type: "order", id, status: order.status, isTest: order.isTest });
      return { ok: true };
    });
  });

  // "Check again" for an order whose fate is unclear: runs the same reconciliation as the scheduled job,
  // with the same idempotency key, so pressing it can never create a second order.
  api.post("/orders/:id/reconcile", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "order", id, "orders.manage");
    await tenant(deps, a, async (tx) => {
      const o = await maybeOne<{ local_status: string }>(tx, "select local_status from orders where id = $1", [id]);
      if (!o) throw notFound();
      if (!["SUBMISSION_UNKNOWN", "SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED"].includes(o.local_status)) throw rule("Only an order whose fate is unclear can be checked again.");
      await deps.jobs.enqueue("order.reconcile", { orderId: id }, { tx, singletonKey: `reconcile:${id}` });
      await audit(tx, a, meta(req), { action: "orders.reconcile", targetType: "order", targetId: id, target: "Order", summary: "Asked the system to check an order with Square again." });
    });
    return reply.status(202).send({ ok: true });
  });

  api.post("/orders/:id/cancel", async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "order", id, "orders.manage");
    const { reason } = parse(cancelOrderInput, req.body);
    return tenant(deps, a, async (tx) => {
      const order = await transition(tx, id, (o) => cancelRule(o, reason, { actor: "STAFF", at: deps.now().toISOString() }), { actor: "STAFF", userId: a.userId, reason });
      await audit(tx, a, meta(req), { action: "orders.cancel", targetType: "order", targetId: id, target: order.customer.name ?? id, summary: `Cancelled: ${reason}` });
      await signal(tx, a.locationId, { type: "order", id, status: order.status, isTest: order.isTest });
      return { ok: true };
    });
  });
}
