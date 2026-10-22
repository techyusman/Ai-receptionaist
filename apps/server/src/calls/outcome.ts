// How a call ended is decided from what happened, not from anything the model said. The order of the
// checks matters: an order that may exist always wins, because staff must hear about it.
import { maybeOne, type Tx } from "@receptionist/db";

export type Outcome = "INFO_RESOLVED" | "ORDER_SUBMITTED" | "TRANSFERRED" | "CALLER_HUNG_UP" | "FAILED" | "CALLBACK_REQUESTED" | "STAFF_ANSWERED";

export async function decideOutcome(tx: Tx, callId: string, endStatus: string): Promise<Outcome> {
  const call = await maybeOne<{ outcome: Outcome | null; error_code: string | null; transfer_status: string }>(tx, "select outcome, error_code, transfer_status from calls where id = $1", [callId]);
  if (call?.outcome) return call.outcome;
  const sent = await maybeOne(tx, "select 1 as x from orders where call_id = $1 and local_status in ('SUBMITTED_TO_POS','POS_VISIBILITY_UNVERIFIED','RECEIVED_BY_RESTAURANT','SUBMISSION_UNKNOWN','SUBMISSION_PENDING')", [callId]);
  if (sent) return "ORDER_SUBMITTED";
  if (call?.transfer_status === "CONNECTED") return "TRANSFERRED";
  if (await maybeOne(tx, "select 1 as x from callback_requests where call_id = $1", [callId])) return "CALLBACK_REQUESTED";
  if (call?.error_code || ["failed", "busy", "no-answer"].includes(endStatus)) return "FAILED";
  const answered = await maybeOne(tx, "select 1 as x from call_events where call_id = $1 and event_type in ('tool.get_restaurant_info','tool.search_menu') limit 1", [callId]);
  return answered ? "INFO_RESOLVED" : "CALLER_HUNG_UP";
}

/** Marks a call ended with its outcome in one statement (the database refuses an ended call without one). */
export async function endCall(tx: Tx, callId: string, endStatus: string, durationSeconds: number | null): Promise<{ ended: boolean; outcome: Outcome }> {
  const outcome = await decideOutcome(tx, callId, endStatus);
  const r = await tx.query(
    `update calls set status = 'ENDED', outcome = $2, ended_at = coalesce(ended_at, now()),
            duration_seconds = coalesce(duration_seconds, $3::int, greatest(0, extract(epoch from (now() - started_at))::int))
      where id = $1 and status <> 'ENDED'`,
    [callId, outcome, durationSeconds],
  );
  return { ended: (r.rowCount ?? 0) > 0, outcome };
}
