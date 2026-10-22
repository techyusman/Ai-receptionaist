// Tidy-up once a call has ended: make sure nothing the caller agreed to is lost, give the call a
// one-line summary a person can scan, work out when its details expire, and note who it was.
import { abandon, formatMoney } from "@receptionist/domain";
import { many, maybeOne, withSystem } from "@receptionist/db";
import type { Deps } from "../deps.ts";
import { signal } from "../live.ts";
import { loadOrdersByIds } from "../orders/repo.ts";
import { transition } from "../orders/service.ts";
import { submitConfirmedOrder } from "../pos/submit.ts";

const OPEN = ["DRAFT", "NEEDS_CLARIFICATION", "READY_FOR_CONFIRMATION"];

export async function finalizeCall(deps: Deps, callId: string): Promise<void> {
  // A yes that never got sent (the line dropped first) is sent now, before anything is abandoned.
  const confirmed = await withSystem(deps.db, (tx) => many<{ id: string }>(tx, "select id from orders where call_id = $1 and local_status = 'CUSTOMER_CONFIRMED'", [callId]));
  for (const o of confirmed) await submitConfirmedOrder(deps, o.id).catch((e) => console.error(JSON.stringify({ level: "error", msg: "late submit failed", callId, err: (e as Error).message })));

  await withSystem(deps.db, async (tx) => {
    const call = await maybeOne<{ id: string; location_id: string; outcome: string | null; summary: string | null; caller_name: string | null; ended_at: string | null; duration_seconds: number | null; is_test: boolean }>(
      tx, "select id, location_id, outcome, summary, caller_name, ended_at, duration_seconds, is_test from calls where id = $1 and status = 'ENDED'", [callId]);
    if (!call) return;
    const rows = await many<{ id: string; local_status: string }>(tx, "select id, local_status from orders where call_id = $1", [callId]);
    for (const r of rows.filter((x) => OPEN.includes(x.local_status))) {
      await transition(tx, r.id, (o) => abandon(o, { actor: "SYSTEM", at: deps.now().toISOString(), reason: "Caller hung up" }), { actor: "SYSTEM" });
    }
    const orders = await loadOrdersByIds(tx, rows.map((r) => r.id));
    // The outcome was decided when the line closed. If this job is what finally sent the order, the call was an order call.
    if (orders.some((o) => ["SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED", "RECEIVED_BY_RESTAURANT", "SUBMISSION_UNKNOWN"].includes(o.status))) {
      await tx.query("update calls set outcome = 'ORDER_SUBMITTED' where id = $1 and outcome in ('CALLER_HUNG_UP','INFO_RESOLVED','FAILED')", [callId]);
      call.outcome = "ORDER_SUBMITTED";
    }
    const placed = orders.find((o) => ["SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED", "RECEIVED_BY_RESTAURANT", "SUBMISSION_UNKNOWN", "FAILED"].includes(o.status));
    const callback = await maybeOne<{ customer_name: string }>(tx, "select customer_name from callback_requests where call_id = $1 order by created_at limit 1", [callId]);
    const topics = await many<{ event_type: string }>(tx, "select distinct event_type from call_events where call_id = $1 and event_type like 'tool.%'", [callId]);

    const summary =
      call.summary ??
      ({
        ORDER_SUBMITTED: placed ? `Phone order: ${placed.lines.map((l) => `${l.quantity} × ${l.itemName}`).join(", ")}${placed.totals ? ` (${formatMoney(placed.totals.totalMinor, placed.currency)})` : ""}.` : "Phone order placed.",
        TRANSFERRED: "Passed to staff.",
        CALLBACK_REQUESTED: "Took a callback request.",
        STAFF_ANSWERED: "Staff answered before the AI.",
        FAILED: "The call did not connect or the assistant could not continue.",
        INFO_RESOLVED: topics.some((t) => t.event_type === "tool.get_restaurant_info") ? "Answered questions about the restaurant." : "Answered questions about the menu.",
        CALLER_HUNG_UP: orders.length ? "Caller hung up before finishing an order." : "Caller hung up.",
      } as Record<string, string>)[call.outcome ?? ""] ?? null;
    const name = call.caller_name ?? placed?.customer.name ?? callback?.customer_name ?? orders.find((o) => o.customer.name)?.customer.name ?? null;

    await tx.query(
      `update calls c set summary = coalesce(c.summary, $2), caller_name = coalesce(c.caller_name, $3),
              purge_after = c.ended_at + make_interval(days => s.retention_days)
         from location_settings s where c.id = $1 and s.location_id = c.location_id`,
      [callId, summary, name],
    );
    await signal(tx, call.location_id, { type: "call", id: callId });
  });
}
