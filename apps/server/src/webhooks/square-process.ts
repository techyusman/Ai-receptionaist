// Applies one stored Square event. Safe to run twice: every branch checks the current state first.
import { accept } from "@receptionist/domain";
import { many, maybeOne, withSystem } from "@receptionist/db";
import type { Deps } from "../deps.ts";
import { signal } from "../live.ts";
import { transition } from "../orders/service.ts";
import { markNeedsReauth, squareSession } from "../pos/integration.ts";

const SEEN = new Set(["RESERVED", "PREPARED", "COMPLETED"]);

export async function processSquareEvent(deps: Deps, eventId: string): Promise<void> {
  const ev = await withSystem(deps.db, (tx) =>
    maybeOne<{ id: string; event_type: string; payload_redacted: Record<string, any> }>(
      tx, "update webhook_events set attempt_count = attempt_count + 1 where id = $1 and processing_status in ('RECEIVED','FAILED') returning id, event_type, payload_redacted", [eventId]),
  );
  if (!ev) return; // already processed, or not ours
  const p = ev.payload_redacted;
  try {
    let status: "PROCESSED" | "IGNORED" = "PROCESSED";
    if (ev.event_type === "catalog.version.updated") {
      const locations = await withSystem(deps.db, (tx) => many<{ location_id: string }>(tx, "select location_id from pos_integrations where merchant_id = $1 and status = 'CONNECTED' and pos_location_id is not null", [p.merchant_id]));
      for (const l of locations) {
        // A burst of edits in Square becomes one sync, twenty seconds after the first.
        await deps.jobs.enqueue("catalog.sync", { locationId: l.location_id, kind: "INCREMENTAL", trigger: "WEBHOOK" }, { delaySeconds: 20, singletonKey: `sync:${l.location_id}` });
      }
      if (!locations.length) status = "IGNORED";
    } else if (ev.event_type === "order.updated" || ev.event_type === "order.fulfillment.updated") {
      status = (await acknowledgeFromSquare(deps, p.order_id)) ? "PROCESSED" : "IGNORED";
    } else if (ev.event_type === "oauth.authorization.revoked") {
      await withSystem(deps.db, async (tx) => {
        const rows = await many<{ id: string; restaurant_id: string; location_id: string }>(tx, "select id, restaurant_id, location_id from pos_integrations where merchant_id = $1 and status = 'CONNECTED'", [p.merchant_id]);
        for (const r of rows) {
          await markNeedsReauth(deps, tx, r, "REVOKED", true);
          await signal(tx, r.location_id, { type: "settings" });
        }
      });
    } else {
      status = "IGNORED";
    }
    await withSystem(deps.db, (tx) => tx.query("update webhook_events set processing_status = $2, processed_at = now(), last_error = null where id = $1", [eventId, status]));
  } catch (e) {
    await withSystem(deps.db, (tx) => tx.query("update webhook_events set processing_status = 'FAILED', last_error = $2 where id = $1", [eventId, String((e as Error).message).slice(0, 400)]));
    throw e;
  }
}

/** Square's payload only names the order, so ask Square what state it is in now. */
async function acknowledgeFromSquare(deps: Deps, squareOrderId: string | undefined): Promise<boolean> {
  if (!squareOrderId) return false;
  const mine = await withSystem(deps.db, (tx) => maybeOne<{ id: string; location_id: string; local_status: string }>(tx, "select id, location_id, local_status from orders where square_order_id = $1", [squareOrderId]));
  if (!mine) return false;
  if (!["SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED"].includes(mine.local_status)) return true;
  const session = await squareSession(deps, mine.location_id);
  if (!session) return false;
  const remote = await session.api.retrieveOrder(session.token, squareOrderId);
  const seen = remote && (remote.state === "COMPLETED" || (remote.fulfillments ?? []).some((f) => f.state && SEEN.has(f.state)));
  if (!seen) return true;
  await withSystem(deps.db, async (tx) => {
    const done = await transition(tx, mine.id, (o) => accept(o, null, { actor: "WEBHOOK", at: deps.now().toISOString(), reason: "Square shows the order in progress" }), { actor: "WEBHOOK" });
    await signal(tx, mine.location_id, { type: "order", id: mine.id, status: done.status, isTest: done.isTest });
  });
  return true;
}
