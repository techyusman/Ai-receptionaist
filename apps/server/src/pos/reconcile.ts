// Following up on orders whose fate isn't certain. Two cases:
//  * SUBMISSION_UNKNOWN: Square never answered. Retry with the SAME idempotency key and body, so Square
//    returns the order it already made instead of making a second one. After the last retry, look the
//    order up by our reference id. Only if it truly isn't there is it marked failed (and staff called in).
//  * SUBMITTED_TO_POS in Square mode: nobody has confirmed anyone saw it. Check Square, and if it still
//    looks unseen after a few minutes, say so (POS_VISIBILITY_UNVERIFIED) rather than assume.
import { accept, fail, type Order } from "@receptionist/domain";
import { maybeOne, withSystem } from "@receptionist/db";
import { raiseAlert } from "../alerts.ts";
import type { Deps } from "../deps.ts";
import { signal } from "../live.ts";
import { loadOrder } from "../orders/repo.ts";
import { transition } from "../orders/service.ts";
import { squareSession } from "./integration.ts";
import { begin, recordAuthFailure, recordRejected, recordSuccess, recordUncertain, sendToSquare, classify } from "./submit.ts";

/** Seconds to wait after attempt 1, 2, 3, 4 before trying again. */
export const RETRY_DELAYS = [30, 120, 300, 900] as const;
const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;
const VISIBILITY_MINUTES = 5;
const SYSTEM = { actor: "SYSTEM" as const };

export type ReconcileOutcome = "resolved" | "retrying" | "failed" | "unverified" | "nothing";

export async function reconcileOrder(deps: Deps, orderId: string): Promise<ReconcileOutcome> {
  const order = await withSystem(deps.db, (tx) => loadOrder(tx, orderId));
  if (!order) return "nothing";
  if (order.status === "SUBMISSION_UNKNOWN") return retryUnknown(deps, order);
  if (order.status === "SUBMITTED_TO_POS" && order.posMode === "SQUARE") return checkVisibility(deps, order);
  return "nothing";
}

async function retryUnknown(deps: Deps, order: Order): Promise<ReconcileOutcome> {
  if (order.submissionAttempts >= MAX_ATTEMPTS) return finalLookup(deps, order);
  const go = await begin(deps, order.id);
  if (go.kind === "stop") return "nothing";
  if (!go.session || !go.body) return "nothing";
  const sent = await sendToSquare({ order: go.order, session: go.session, body: go.body });
  if (sent.ok) {
    await recordSuccess(deps, go.order, sent.squareOrder.id!);
    return "resolved";
  }
  if (sent.failure.kind === "ambiguous") {
    await recordUncertain(deps, go.order, sent.failure, RETRY_DELAYS[Math.min(go.order.submissionAttempts, RETRY_DELAYS.length) - 1] ?? 900);
    return "retrying";
  }
  if (sent.failure.kind === "auth") {
    await recordAuthFailure(deps, go.order, sent.failure);
    return "failed";
  }
  await recordRejected(deps, go.order, sent.failure);
  return "failed";
}

async function finalLookup(deps: Deps, order: Order): Promise<ReconcileOutcome> {
  const session = await squareSession(deps, order.locationId).catch(() => null);
  let found: string | null = null;
  if (session?.posLocationId) {
    try {
      const since = new Date(new Date(order.createdAt).getTime() - 3_600_000).toISOString();
      found = (await session.api.searchOrders(session.token, session.posLocationId, since)).find((o) => o.reference_id === order.id)?.id ?? null;
    } catch (e) {
      // Can't look it up right now: try again later rather than declare the order lost.
      await recordUncertain(deps, order, classify(e), 900);
      return "retrying";
    }
  }
  if (found) {
    await recordSuccess(deps, order, found, 200, false);
    return "resolved";
  }
  await withSystem(deps.db, async (tx) => {
    const failed = await transition(tx, order.id, (o) => fail(o, "Square never confirmed this order", { ...SYSTEM, at: deps.now().toISOString() }), SYSTEM);
    const loc = (await maybeOne<{ restaurant_id: string; location_id: string }>(tx, "select restaurant_id, location_id from orders where id = $1", [order.id]))!;
    await tx.query("update alerts set acknowledged_at = now() where order_id = $1 and kind = 'ORDER_SUBMISSION_UNKNOWN' and acknowledged_at is null", [order.id]);
    await raiseAlert(deps, tx, {
      restaurantId: loc.restaurant_id, locationId: loc.location_id, kind: "ORDER_FAILED", severity: "CRITICAL", orderId: order.id, dedupeKey: `failed:${order.id}`,
      message: `An order for ${failed.customer.name ?? "a caller"} (${failed.customer.phone ?? "no number"}) never reached Square. Call them to take it again.`,
    });
    await signal(tx, loc.location_id, { type: "order", id: order.id, status: failed.status, isTest: failed.isTest });
  });
  return "failed";
}

const ACKNOWLEDGED = new Set(["RESERVED", "PREPARED", "COMPLETED"]);

async function checkVisibility(deps: Deps, order: Order): Promise<ReconcileOutcome> {
  const session = await squareSession(deps, order.locationId).catch(() => null);
  if (!session || !order.posOrderId) return "nothing";
  const remote = await session.api.retrieveOrder(session.token, order.posOrderId).catch(() => null);
  const seen = remote && (remote.state === "COMPLETED" || (remote.fulfillments ?? []).some((f) => f.state && ACKNOWLEDGED.has(f.state)));
  if (seen) {
    await withSystem(deps.db, async (tx) => {
      const done = await transition(tx, order.id, (o) => accept(o, null, { actor: "WEBHOOK", at: deps.now().toISOString(), reason: "Square shows the order in progress" }), { actor: "WEBHOOK" });
      const loc = (await maybeOne<{ location_id: string }>(tx, "select location_id from orders where id = $1", [order.id]))!;
      await signal(tx, loc.location_id, { type: "order", id: order.id, status: done.status, isTest: done.isTest });
    });
    return "resolved";
  }
  const ageMinutes = (deps.now().getTime() - new Date(order.submittedAt ?? order.createdAt).getTime()) / 60_000;
  if (ageMinutes < VISIBILITY_MINUTES) return "retrying";
  await withSystem(deps.db, async (tx) => {
    await tx.query("select set_config('app.actor_type', 'SYSTEM', true), set_config('app.reason', 'Square has not shown the order as seen', true)");
    await tx.query("update orders set local_status = 'POS_VISIBILITY_UNVERIFIED' where id = $1 and local_status = 'SUBMITTED_TO_POS'", [order.id]);
    const loc = (await maybeOne<{ restaurant_id: string; location_id: string }>(tx, "select restaurant_id, location_id from orders where id = $1", [order.id]))!;
    await raiseAlert(deps, tx, {
      restaurantId: loc.restaurant_id, locationId: loc.location_id, kind: "ORDER_SUBMISSION_UNKNOWN", severity: "WARNING", orderId: order.id, dedupeKey: `unseen:${order.id}`,
      message: `An order for ${order.customer.name ?? "a caller"} was sent to Square, but nobody has marked it as seen. Check the kitchen screen.`,
    });
    await signal(tx, loc.location_id, { type: "order", id: order.id, status: "POS_VISIBILITY_UNVERIFIED", isTest: order.isTest });
  });
  return "unverified";
}
