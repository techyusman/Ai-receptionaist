// The call record: created when Twilio first rings us, appended to as things happen, closed when it
// ends. Events are append-only and carry redacted detail (never raw speech), and the outcome of a call
// is decided by the server from what actually happened, never by what the model says.
import { maybeOne, one, pgError, PG, type Tx } from "@receptionist/db";

export type CallTarget = {
  phoneNumberId: string; restaurantId: string; locationId: string; purpose: "AI_INBOUND" | "TEST"; timezone: string; currency: string;
  publicPhone: string | null; fallbackE164: string | null; orderingMode: "DISABLED" | "DASHBOARD_TICKET" | "SQUARE";
  ringStaffFirst: boolean; ringStaffSeconds: number; maxCallSeconds: number; locationName: string;
};

/** Which restaurant owns the number that was dialled. A system lookup: this is how a call finds its tenant. */
export async function resolveCallTarget(tx: Tx, toE164: string): Promise<CallTarget | null> {
  const r = await maybeOne<{
    phone_number_id: string; restaurant_id: string; location_id: string; purpose: "AI_INBOUND" | "TEST"; timezone: string; currency: string;
    public_phone_e164: string | null; fallback_e164: string | null; ordering_mode: CallTarget["orderingMode"]; ring_staff_first: boolean;
    ring_staff_seconds: number; max_call_seconds: number; location_name: string;
  }>(
    tx,
    `select p.id as phone_number_id, p.restaurant_id, p.location_id, p.purpose, l.timezone, l.currency, l.public_phone_e164, p.fallback_e164,
            l.ordering_mode, s.ring_staff_first, s.ring_staff_seconds, s.max_call_seconds, l.name as location_name
       from phone_numbers p join locations l on l.id = p.location_id join location_settings s on s.location_id = p.location_id
      where p.e164 = $1 and p.enabled and p.released_at is null`,
    [toE164],
  );
  if (!r) return null;
  return {
    phoneNumberId: r.phone_number_id, restaurantId: r.restaurant_id, locationId: r.location_id, purpose: r.purpose, timezone: r.timezone, currency: r.currency,
    publicPhone: r.public_phone_e164, fallbackE164: r.fallback_e164, orderingMode: r.ordering_mode, ringStaffFirst: r.ring_staff_first,
    ringStaffSeconds: r.ring_staff_seconds, maxCallSeconds: r.max_call_seconds, locationName: r.location_name,
  };
}

export type CallRow = { id: string; restaurant_id: string; location_id: string; status: string; outcome: string | null; is_test: boolean; from_e164: string | null; to_e164: string; started_at: string };

/** Creates the call, or returns the existing one if Twilio is retrying the same webhook. */
export async function createCall(
  tx: Tx,
  t: CallTarget,
  input: { callSid: string; from: string | null; to: string; isTest: boolean; status: "RINGING_STAFF" | "IN_PROGRESS"; at: Date },
): Promise<{ call: CallRow; created: boolean }> {
  const r = await tx.query<CallRow>(
    `insert into calls (restaurant_id, location_id, phone_number_id, provider_call_sid, is_test, from_e164, to_e164, started_at, answered_at, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9) on conflict (provider_call_sid) do nothing
     returning id, restaurant_id, location_id, status, outcome, is_test, from_e164, to_e164, started_at`,
    [t.restaurantId, t.locationId, t.phoneNumberId, input.callSid, input.isTest, input.from, input.to, input.at.toISOString(), input.status],
  );
  if (r.rows[0]) {
    await addEvent(tx, r.rows[0].id, t.restaurantId, "call.started", "SYSTEM", input.isTest ? "Test call started." : "Call answered by the AI line.");
    return { call: r.rows[0], created: true };
  }
  const existing = await one<CallRow>(tx, "select id, restaurant_id, location_id, status, outcome, is_test, from_e164, to_e164, started_at from calls where provider_call_sid = $1", [input.callSid]);
  return { call: existing, created: false };
}

/** Appends to the call's timeline. detail is a short sentence a person reads, with no raw transcript text. */
export async function addEvent(tx: Tx, callId: string, restaurantId: string, type: string, actor: "SYSTEM" | "AI" | "CALLER" | "STAFF", detail: string, extra: Record<string, unknown> = {}): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await tx.query("savepoint ev");
      await tx.query(
        `insert into call_events (restaurant_id, call_id, seq, event_type, actor_type, payload_redacted)
         select $1, $2, coalesce(max(seq) + 1, 0), $3, $4, $5 from call_events where call_id = $2`,
        [restaurantId, callId, type, actor, JSON.stringify({ detail, ...extra })],
      );
      await tx.query("release savepoint ev");
      return;
    } catch (e) {
      await tx.query("rollback to savepoint ev");
      if (pgError(e)?.code !== PG.uniqueViolation || attempt === 3) throw e;
    }
  }
}
