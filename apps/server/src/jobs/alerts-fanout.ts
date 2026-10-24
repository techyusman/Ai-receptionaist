// Gets a new alert to people who are not looking at the dashboard. Warnings and worse go by email to the
// owner and managers; critical ones (an order that may be lost) also go by text to the staff numbers
// that opted in. Each alert is sent once.
import { many, maybeOne, withSystem } from "@receptionist/db";
import type { Deps } from "../deps.ts";

type AlertRow = { id: string; restaurant_id: string; location_id: string; kind: string; severity: "INFO" | "WARNING" | "CRITICAL"; message: string; order_id: string | null; location_name: string };

export async function fanOutAlert(deps: Deps, alertId: string): Promise<void> {
  const a = await withSystem(deps.db, (tx) =>
    maybeOne<AlertRow>(
      tx,
      `select a.id, a.restaurant_id, a.location_id, a.kind, a.severity, a.message, a.order_id, l.name as location_name
         from alerts a join locations l on l.id = a.location_id where a.id = $1 and a.notified_at is null and a.acknowledged_at is null`,
      [alertId],
    ),
  );
  const markSent = () => withSystem(deps.db, (tx) => tx.query("update alerts set notified_at = now() where id = $1", [alertId]));
  if (!a) return;
  if (a.severity === "INFO") return void (await markSent());
  const { emails, phones } = await withSystem(deps.db, async (tx) => ({
    emails: (
      await many<{ email: string }>(
        tx,
        `select distinct u.email from memberships m join users u on u.id = m.user_id
          where m.restaurant_id = $1 and m.status = 'ACTIVE' and m.role in ('OWNER','MANAGER') and (m.location_id is null or m.location_id = $2)`,
        [a.restaurant_id, a.location_id],
      )
    ).map((r) => r.email),
    phones: a.severity === "CRITICAL" ? (await many<{ e164: string }>(tx, "select distinct e164 from transfer_targets where location_id = $1 and enabled and sms_alert_on_miss", [a.location_id])).map((r) => r.e164) : [],
  }));
  const link = `${deps.config.DASHBOARD_ORIGIN.replace(/\/$/, "")}${a.order_id ? `/orders?order=${a.order_id}` : "/live"}`;
  const subject = `${a.severity === "CRITICAL" ? "Needs you now" : "Heads up"}: ${a.location_name}`;
  // Sending is best-effort per recipient; one bad address must not stop the rest.
  for (const to of emails) await deps.providers.email?.send({ to, subject, text: `${a.message}\n\nOpen the dashboard: ${link}` }).catch(() => undefined);
  for (const to of phones) await deps.providers.twilio?.sendSms(to, `${a.location_name}: ${a.message}`.slice(0, 300)).catch(() => undefined);
  await markSent();
}
