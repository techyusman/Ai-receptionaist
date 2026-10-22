// The scheduled housekeeping: keep the menu fresh, renew Square tokens, warn when the menu goes stale,
// expire old data on schedule, and estimate what calls cost.
import { many, one, withSystem } from "@receptionist/db";
import { raiseAlert } from "../alerts.ts";
import type { Deps } from "../deps.ts";
import { refreshTokens } from "../pos/integration.ts";

/** Safety net for missed webhooks: ask every connected location for anything that changed. */
export async function reconcileCatalogs(deps: Deps): Promise<number> {
  const rows = await withSystem(deps.db, (tx) => many<{ location_id: string }>(tx, "select location_id from pos_integrations where status = 'CONNECTED' and pos_location_id is not null"));
  for (const r of rows) await deps.jobs.enqueue("catalog.sync", { locationId: r.location_id, kind: "INCREMENTAL", trigger: "RECONCILE" }, { singletonKey: `sync:${r.location_id}` });
  return rows.length;
}

/** A menu that hasn't synced in too long stops the AI taking orders; this tells the restaurant why. */
export async function flagStaleMenus(deps: Deps): Promise<number> {
  return withSystem(deps.db, async (tx) => {
    const stale = await many<{ restaurant_id: string; location_id: string }>(
      tx,
      `select s.restaurant_id, s.location_id from location_menu_status s
         join pos_integrations i on i.location_id = s.location_id and i.status = 'CONNECTED' and i.pos_location_id is not null
         join locations l on l.id = s.location_id and l.ordering_mode <> 'DISABLED' where s.is_stale`,
    );
    for (const s of stale) {
      await raiseAlert(deps, tx, {
        restaurantId: s.restaurant_id, locationId: s.location_id, kind: "CATALOG_STALE", severity: "WARNING", dedupeKey: "catalog-stale",
        message: "The menu hasn't updated from Square recently, so the AI has stopped taking orders until it does.",
      });
    }
    return stale.length;
  });
}

/** Renew tokens a week before they expire so a quiet restaurant never wakes to a broken connection. */
export async function renewTokens(deps: Deps): Promise<number> {
  const rows = await withSystem(deps.db, (tx) =>
    many<{ location_id: string }>(tx, "select location_id from pos_integrations where status = 'CONNECTED' and token_expires_at < $1::timestamptz + interval '7 days'", [deps.now().toISOString()]),
  );
  let renewed = 0;
  for (const r of rows) if ((await refreshTokens(deps, r.location_id, 7 * 86_400_000)) === "ok") renewed++;
  return renewed;
}

export type PurgeResult = { transcripts: number; events: number; calls_anonymised: number; oauth_states: number; webhooks: number; invitations: number };

export async function purgeExpired(deps: Deps): Promise<PurgeResult> {
  return withSystem(deps.db, (tx) => one<PurgeResult>(tx, "select * from app.purge_expired($1::timestamptz)", [deps.now().toISOString()]));
}

/** A rough per-call cost from its length, for the usage page. Real invoices come from Twilio and OpenAI. */
export async function estimateCosts(deps: Deps): Promise<number> {
  const perMinute = deps.config.ESTIMATED_COST_PER_MINUTE_MINOR;
  if (!perMinute) return 0;
  return withSystem(deps.db, async (tx) => {
    const r = await tx.query(
      "update calls set cost_estimate_minor = ceil(duration_seconds / 60.0 * $1) where status = 'ENDED' and not is_test and cost_estimate_minor is null and duration_seconds is not null",
      [perMinute],
    );
    return r.rowCount ?? 0;
  });
}
