// The map from job name to the function that does the work. The worker process registers these with
// pg-boss; tests run them through the in-process queue.
import type { Deps } from "../deps.ts";
import { reconcileOrder } from "../pos/reconcile.ts";
import { processSquareEvent } from "../webhooks/square-process.ts";
import { fanOutAlert } from "./alerts-fanout.ts";
import { finalizeCall } from "./call-finalize.ts";
import { runCatalogSync } from "./catalog-sync.ts";
import { estimateCosts, flagStaleMenus, purgeExpired, reconcileCatalogs, renewTokens } from "./maintenance.ts";
import type { JobHandlers } from "./queue.ts";

export function buildHandlers(deps: Deps): JobHandlers {
  return {
    "catalog.sync": async (d) => void (await runCatalogSync(deps, d)),
    "catalog.reconcile": async (d) => void (await reconcileCatalogs(deps, d.full === true)),
    "catalog.staleness": async () => void (await flagStaleMenus(deps)),
    "square.refresh_tokens": async () => void (await renewTokens(deps)),
    "order.reconcile": async (d) => void (await reconcileOrder(deps, d.orderId)),
    "webhook.process": (d) => processSquareEvent(deps, d.eventId),
    "call.finalize": (d) => finalizeCall(deps, d.callId),
    "alerts.fanout": (d) => fanOutAlert(deps, d.alertId),
    "retention.purge": async () => void (await purgeExpired(deps)),
    "usage.rollup": async () => void (await estimateCosts(deps)),
  };
}
