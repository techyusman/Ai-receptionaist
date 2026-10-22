// Sending a confirmed order to the restaurant. Three phases, so a slow Square never holds a database
// transaction open and a crash in the middle is always recoverable:
//   1. lock the order, check it is still sendable, mark it SUBMISSION_PENDING and record the attempt
//   2. talk to Square (or put the ticket on the dashboard)
//   3. record what actually happened, and say nothing more than that
import { callerClaim, startSubmission, submissionSucceeded, submissionUncertain, submissionRejected, fail, needsClarification, rotateIdempotencyKey, type CallerClaim, type Order, type Problem } from "@receptionist/domain";
import { maybeOne, withSystem, type Tx } from "@receptionist/db";
import { raiseAlert } from "../alerts.ts";
import type { Deps } from "../deps.ts";
import { signal } from "../live.ts";
import { loadMenu } from "../menu/read.ts";
import { revalidate } from "../orders/revalidate.ts";
import { loadOrder } from "../orders/repo.ts";
import { recordAttemptResult, recordAttemptStart, transition } from "../orders/service.ts";
import { markNeedsReauth, squareSession, type SquareSession } from "./integration.ts";
import { SquareApiError, type SquareOrder } from "../providers/square.ts";
import { requestHash, buildSquareOrder } from "./square-order.ts";
import { whatToSay } from "./speech.ts";
import { randomUUID } from "node:crypto";

export type SubmitResult = { order: Order; claim: CallerClaim; say: string; problems?: Problem[] };

const SYSTEM = { actor: "SYSTEM" as const };
const result = (order: Order, problems?: Problem[]): SubmitResult => {
  const claim = callerClaim(order);
  return { order, claim, say: whatToSay(claim, order), ...(problems ? { problems } : {}) };
};

export type Go = { kind: "go"; order: Order; session: SquareSession | null; body: Record<string, unknown> | null };
export type Stop = { kind: "stop"; result: SubmitResult };

export async function begin(deps: Deps, orderId: string): Promise<Go | Stop> {
  return withSystem(deps.db, async (tx) => {
    const order = await loadOrder(tx, orderId, { forUpdate: true });
    if (!order) throw new Error("order not found");
    // A repeated call after a dropped line is answered with what already happened, never sent twice.
    if (["SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED", "RECEIVED_BY_RESTAURANT", "SUBMISSION_PENDING", "FAILED", "CANCELLED", "ABANDONED", "TRANSFERRED_TO_STAFF"].includes(order.status)) {
      return { kind: "stop", result: result(order) };
    }
    const retry = order.status === "SUBMISSION_UNKNOWN";
    if (!retry) {
      const settings = await maybeOne<{ menu_stale_max_age_seconds: number }>(tx, "select menu_stale_max_age_seconds from location_settings where location_id = $1", [order.locationId]);
      const menu = await loadMenu(tx, order.locationId);
      const check = revalidate(order, menu, settings?.menu_stale_max_age_seconds ?? 3600, deps.now());
      if (!check.ok) {
        const back = await transition(tx, orderId, (o) => needsClarification(o, { actor: "SYSTEM", at: deps.now().toISOString(), reason: check.reason }), SYSTEM);
        return { kind: "stop", result: { ...result(back), problems: check.problems } };
      }
    }
    const session = order.posMode === "SQUARE" ? await squareSession(deps, order.locationId).catch(() => null) : null;
    if (order.posMode === "SQUARE" && !session?.posLocationId) {
      const failed = await transition(tx, orderId, (o) => (retry ? fail(o, "Square isn't connected", { actor: "SYSTEM", at: deps.now().toISOString() }) : needsClarification(o, { actor: "SYSTEM", at: deps.now().toISOString(), reason: "Square is not connected" })), SYSTEM);
      return { kind: "stop", result: result(failed) };
    }
    const pending = await transition(tx, orderId, (o) => startSubmission(o, { actor: "SYSTEM", at: deps.now().toISOString() }), SYSTEM);
    const body = session ? await buildSquareOrder(tx, orderId, session.posLocationId!) : null;
    await recordAttemptStart(tx, pending, body ? requestHash(body) : Buffer.from(`ticket:${pending.id}:${pending.version}`));
    await signal(tx, (await locationOf(tx, orderId)), { type: "order", id: orderId, status: pending.status, isTest: pending.isTest });
    return { kind: "go", order: pending, session, body };
  });
}

async function locationOf(tx: Tx, orderId: string): Promise<string> {
  return (await maybeOne<{ location_id: string }>(tx, "select location_id from orders where id = $1", [orderId]))!.location_id;
}

type Outcome = "CREATED" | "TIMEOUT" | "UNKNOWN" | "AUTH_ERROR" | "VALIDATION_ERROR" | "RATE_LIMITED";

/** What a Square failure means for the order: did it definitely not happen, or might it have? */
export function classify(e: unknown): { outcome: Outcome; kind: "ambiguous" | "rejected" | "auth"; code: string; status: number | null } {
  if (e instanceof SquareApiError) {
    if (e.status === 401 || e.status === 403) return { outcome: "AUTH_ERROR", kind: "auth", code: e.code, status: e.status };
    if (e.status === 429) return { outcome: "RATE_LIMITED", kind: "ambiguous", code: e.code, status: 429 };
    if (e.ambiguous) return { outcome: e.status === 0 ? "TIMEOUT" : "UNKNOWN", kind: "ambiguous", code: e.code, status: e.status || null };
    return { outcome: "VALIDATION_ERROR", kind: "rejected", code: e.code, status: e.status };
  }
  return { outcome: "UNKNOWN", kind: "ambiguous", code: "UNEXPECTED", status: null };
}

export async function sendToSquare(go: { order: Order; session: SquareSession; body: Record<string, unknown> }): Promise<{ ok: true; squareOrder: SquareOrder } | { ok: false; failure: ReturnType<typeof classify> }> {
  try {
    const squareOrder = await go.session.api.createOrder(go.session.token, go.body, go.order.idempotencyKey);
    if (!squareOrder?.id) return { ok: false, failure: { outcome: "UNKNOWN", kind: "ambiguous", code: "NO_ORDER_ID", status: 200 } };
    return { ok: true, squareOrder };
  } catch (e) {
    return { ok: false, failure: classify(e) };
  }
}

/** The order reached Square (or the dashboard queue). Say so, and arrange for someone to confirm it was seen. */
export async function recordSuccess(deps: Deps, order: Order, squareOrderId: string | null, httpStatus = 200, recordAttempt = true): Promise<Order> {
  return withSystem(deps.db, async (tx) => {
    if (recordAttempt) await recordAttemptResult(tx, order.id, order.submissionAttempts, { outcome: "CREATED", httpStatus, squareOrderId });
    const sent = await transition(tx, order.id, (o) => submissionSucceeded(o, { actor: "SYSTEM", at: deps.now().toISOString() }, squareOrderId ?? undefined), SYSTEM);
    const loc = await maybeOne<{ restaurant_id: string; location_id: string }>(tx, "select restaurant_id, location_id from orders where id = $1", [order.id]);
    if (squareOrderId) {
      await tx.query("update orders set square_order_id = $2 where id = $1 and square_order_id is distinct from $2", [order.id, squareOrderId]);
      await deps.jobs.enqueue("order.reconcile", { orderId: order.id }, { tx, delaySeconds: 300, singletonKey: `visible:${order.id}` });
    } else if (!sent.isTest) {
      await raiseAlert(deps, tx, { restaurantId: loc!.restaurant_id, locationId: loc!.location_id, kind: "NEW_TICKET", severity: "INFO", message: `New phone order from ${sent.customer.name ?? "a caller"}.`, orderId: order.id, dedupeKey: `ticket:${order.id}` });
    }
    await signal(tx, loc!.location_id, { type: "order", id: order.id, status: sent.status, isTest: sent.isTest });
    return sent;
  });
}

/** Square may or may not have the order. Hold it as unknown, tell staff, and retry with the same key. */
export async function recordUncertain(deps: Deps, order: Order, f: ReturnType<typeof classify>, retryInSeconds = 30): Promise<Order> {
  return withSystem(deps.db, async (tx) => {
    await recordAttemptResult(tx, order.id, order.submissionAttempts, { outcome: f.outcome as never, httpStatus: f.status, errorCode: f.code });
    const unknown = await transition(tx, order.id, (o) => (o.status === "SUBMISSION_UNKNOWN" ? { order: o, events: [] } : submissionUncertain(o, { actor: "SYSTEM", at: deps.now().toISOString(), reason: f.code })), SYSTEM);
    const loc = (await maybeOne<{ restaurant_id: string; location_id: string }>(tx, "select restaurant_id, location_id from orders where id = $1", [order.id]))!;
    await raiseAlert(deps, tx, {
      restaurantId: loc.restaurant_id, locationId: loc.location_id, kind: "ORDER_SUBMISSION_UNKNOWN", severity: "CRITICAL", orderId: order.id,
      message: `An order for ${unknown.customer.name ?? "a caller"} may not have reached Square. We're retrying. Call them if it isn't resolved.`, dedupeKey: `unknown:${order.id}`,
    });
    await deps.jobs.enqueue("order.reconcile", { orderId: order.id }, { tx, delaySeconds: retryInSeconds, singletonKey: `reconcile:${order.id}` });
    await signal(tx, loc.location_id, { type: "order", id: order.id, status: unknown.status, isTest: unknown.isTest });
    return unknown;
  });
}

/** Square definitely refused it. Nothing was created; send the order back to be fixed with a fresh key. */
export async function recordRejected(deps: Deps, order: Order, f: ReturnType<typeof classify>): Promise<Order> {
  return withSystem(deps.db, async (tx) => {
    await recordAttemptResult(tx, order.id, order.submissionAttempts, { outcome: f.outcome as never, httpStatus: f.status, errorCode: f.code });
    await transition(tx, order.id, (o) => submissionRejected(o, { actor: "SYSTEM", at: deps.now().toISOString(), reason: f.code }), SYSTEM);
    // The key may only change once the order is back in a pre-submission state; the database enforces that too.
    const fixed = await transition(tx, order.id, (o) => ({ order: rotateIdempotencyKey(o, randomUUID()), events: [] }), SYSTEM);
    const loc = (await maybeOne<{ location_id: string }>(tx, "select location_id from orders where id = $1", [order.id]))!;
    await signal(tx, loc.location_id, { type: "order", id: order.id, status: fixed.status, isTest: fixed.isTest });
    return fixed;
  });
}

/** Square refused our credentials. The order did not go; the connection needs attention. */
export async function recordAuthFailure(deps: Deps, order: Order, f: ReturnType<typeof classify>): Promise<Order> {
  return withSystem(deps.db, async (tx) => {
    await recordAttemptResult(tx, order.id, order.submissionAttempts, { outcome: "AUTH_ERROR", httpStatus: f.status, errorCode: f.code });
    const failed = await transition(tx, order.id, (o) => fail(o, "Square refused our credentials", { actor: "SYSTEM", at: deps.now().toISOString() }), SYSTEM);
    const loc = (await maybeOne<{ restaurant_id: string; location_id: string }>(tx, "select restaurant_id, location_id from orders where id = $1", [order.id]))!;
    const integration = await maybeOne<{ id: string }>(tx, "select id from pos_integrations where location_id = $1 and status = 'CONNECTED'", [loc.location_id]);
    if (integration) await markNeedsReauth(deps, tx, { id: integration.id, restaurant_id: loc.restaurant_id, location_id: loc.location_id }, f.code);
    await raiseAlert(deps, tx, { restaurantId: loc.restaurant_id, locationId: loc.location_id, kind: "ORDER_FAILED", severity: "CRITICAL", orderId: order.id, message: `An order for ${failed.customer.name ?? "a caller"} could not be sent to Square. Call them to take it.`, dedupeKey: `failed:${order.id}` });
    await signal(tx, loc.location_id, { type: "order", id: order.id, status: failed.status, isTest: failed.isTest });
    return failed;
  });
}

export async function submitConfirmedOrder(deps: Deps, orderId: string): Promise<SubmitResult> {
  const go = await begin(deps, orderId);
  if (go.kind === "stop") return go.result;
  if (!go.session || !go.body) return result(await recordSuccess(deps, go.order, null)); // dashboard ticket: nothing leaves the building
  const sent = await sendToSquare({ order: go.order, session: go.session, body: go.body });
  if (sent.ok) return result(await recordSuccess(deps, go.order, sent.squareOrder.id!));
  if (sent.failure.kind === "ambiguous") return result(await recordUncertain(deps, go.order, sent.failure));
  if (sent.failure.kind === "auth") return result(await recordAuthFailure(deps, go.order, sent.failure));
  return result(await recordRejected(deps, go.order, sent.failure));
}
