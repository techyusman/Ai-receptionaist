// Alerts are the things a person must see: a stuck order, a menu that went stale, a lost Square
// connection. An open alert of the same kind is never duplicated (dedupe key), and each new one is
// pushed to open dashboards at once and queued for email and SMS.
import type { AlertKind } from "@receptionist/contracts";
import type { Tx } from "@receptionist/db";
import type { Deps } from "./deps.ts";
import { signal } from "./live.ts";

export type NewAlert = {
  restaurantId: string;
  locationId: string;
  kind: AlertKind;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  orderId?: string | null;
  callId?: string | null;
  /** While an alert with this key is unacknowledged, raising it again does nothing. */
  dedupeKey?: string | null;
};

export async function raiseAlert(deps: Pick<Deps, "jobs">, tx: Tx, a: NewAlert): Promise<string | null> {
  const r = await tx.query<{ id: string }>(
    `insert into alerts (restaurant_id, location_id, kind, severity, order_id, call_id, message, dedupe_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing returning id`,
    [a.restaurantId, a.locationId, a.kind, a.severity, a.orderId ?? null, a.callId ?? null, a.message, a.dedupeKey ?? null],
  );
  const id = r.rows[0]?.id ?? null;
  if (id) {
    await signal(tx, a.locationId, { type: "alert", id });
    await deps.jobs.enqueue("alerts.fanout", { alertId: id }, { tx });
  }
  return id;
}
