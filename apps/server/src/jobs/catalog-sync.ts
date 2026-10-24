// Pulls the menu from Square into Postgres. The AI reads only Postgres during a call, so this job is
// what keeps the menu honest. One sync per location at a time (a unique index backs that up), and a
// failed or half-finished sync never leaves a half-written menu: the whole apply is one transaction.
import { maybeOne, one, withSystem } from "@receptionist/db";
import { raiseAlert } from "../alerts.ts";
import { auditSystem } from "../audit.ts";
import type { Deps } from "../deps.ts";
import type { JobData } from "./queue.ts";
import { signal } from "../live.ts";
import { applyCatalog } from "../menu/apply.ts";
import { parseCatalog } from "../menu/parse.ts";
import { markNeedsReauth, squareSession } from "../pos/integration.ts";
import { SquareApiError } from "../providers/square.ts";

const CATALOG_TYPES = ["ITEM", "ITEM_VARIATION", "CATEGORY", "MODIFIER_LIST", "MODIFIER"] as const;
const STALE_RUNNING_MINUTES = 15;
const FAILURES_BEFORE_ALERT = 3;

export type SyncOutcome = "succeeded" | "failed" | "skipped";

export async function runCatalogSync(deps: Deps, job: JobData["catalog.sync"]): Promise<SyncOutcome> {
  const session = await squareSession(deps, job.locationId);
  if (!session || !session.posLocationId) return "skipped";

  // Claim the location's one sync slot. A run that died long ago is written off so it can't block forever.
  const claim = await withSystem(deps.db, async (tx) => {
    await tx.query(
      `update catalog_syncs set status = 'FAILED', finished_at = now(), error_code = 'ABANDONED'
        where location_id = $1 and status = 'RUNNING' and started_at < now() - make_interval(mins => $2)`,
      [job.locationId, STALE_RUNNING_MINUTES],
    );
    const last = await maybeOne<{ catalog_high_water: string | null }>(
      tx, "select catalog_high_water from catalog_syncs where location_id = $1 and status = 'SUCCEEDED' and catalog_high_water is not null order by finished_at desc limit 1", [job.locationId]);
    const kind = job.kind === "INCREMENTAL" && last?.catalog_high_water ? "INCREMENTAL" : "FULL";
    const r = await tx.query<{ id: string }>(
      `insert into catalog_syncs (restaurant_id, location_id, kind, trigger, since) values ($1, $2, $3, $4, $5)
       on conflict do nothing returning id`,
      [session.restaurantId, job.locationId, kind, job.trigger, kind === "INCREMENTAL" ? last!.catalog_high_water : null],
    );
    if (!r.rows[0]) return null;
    const loc = await one<{ currency: string }>(tx, "select currency from locations where id = $1", [job.locationId]);
    await signal(tx, job.locationId, { type: "menu" });
    return { syncId: r.rows[0].id, kind, since: last?.catalog_high_water ?? null, currency: loc.currency };
  });
  if (!claim) return "skipped";

  try {
    const fetched = claim.kind === "FULL" ? await session.api.listCatalog(session.token, CATALOG_TYPES) : await session.api.searchCatalogChanges(session.token, claim.since!);
    const parsed = parseCatalog(fetched.objects, session.posLocationId, claim.currency);
    await withSystem(deps.db, async (tx) => {
      const r = await applyCatalog(tx, { restaurantId: session.restaurantId, locationId: job.locationId, parsed, full: claim.kind === "FULL", at: deps.now() });
      await tx.query(
        `update catalog_syncs set status = 'SUCCEEDED', finished_at = now(), objects_upserted = $2, objects_deleted = $3, catalog_high_water = coalesce($4::timestamptz, $5::timestamptz)
          where id = $1`,
        [claim.syncId, r.upserted, r.deleted, fetched.latestTime ?? parsed.latestUpdatedAt, claim.since],
      );
      await tx.query("update pos_integrations set last_success_at = now(), last_error_code = null, last_error_at = null where id = $1", [session.integrationId]);
      // The menu is fresh again: any open "menu is stale" or "sync failed" alert has done its job.
      await tx.query("update alerts set acknowledged_at = now() where location_id = $1 and kind in ('CATALOG_STALE','CATALOG_SYNC_FAILED') and acknowledged_at is null", [job.locationId]);
      await auditSystem(tx, session.restaurantId, { action: "menu.sync", targetType: "location", targetId: job.locationId, target: "Menu", summary: `Synced ${r.upserted} menu entries from Square${parsed.skipped ? ` (${parsed.skipped} skipped)` : ""}.` });
      await signal(tx, job.locationId, { type: "menu" });
    });
    return "succeeded";
  } catch (e) {
    const code = e instanceof SquareApiError ? e.code : "SYNC_FAILED";
    await withSystem(deps.db, async (tx) => {
      await tx.query("update catalog_syncs set status = 'FAILED', finished_at = now(), error_code = $2, error_message = $3 where id = $1", [claim.syncId, code, String((e as Error).message).slice(0, 500)]);
      await tx.query("update pos_integrations set last_error_code = $2, last_error_at = now() where id = $1", [session.integrationId, code]);
      if (e instanceof SquareApiError && e.status === 401) {
        await markNeedsReauth(deps, tx, { id: session.integrationId, restaurant_id: session.restaurantId, location_id: job.locationId }, code);
      } else {
        const recent = await tx.query<{ status: string }>("select status from catalog_syncs where location_id = $1 order by started_at desc limit $2", [job.locationId, FAILURES_BEFORE_ALERT]);
        if (recent.rows.length >= FAILURES_BEFORE_ALERT && recent.rows.every((s) => s.status === "FAILED")) {
          await raiseAlert(deps, tx, { restaurantId: session.restaurantId, locationId: job.locationId, kind: "CATALOG_SYNC_FAILED", severity: "WARNING", message: "The menu hasn't updated from Square for a while. The AI is using the last good copy.", dedupeKey: "catalog-sync-failed" });
        }
      }
      await signal(tx, job.locationId, { type: "menu" });
    });
    return "failed";
  }
}
