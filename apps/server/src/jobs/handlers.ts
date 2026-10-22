// The map from job name to the function that does the work. The worker process registers these with
// pg-boss; tests run them through the in-process queue.
import type { Deps } from "../deps.ts";
import { reconcileOrder } from "../pos/reconcile.ts";
import { processSquareEvent } from "../webhooks/square-process.ts";
import { runCatalogSync } from "./catalog-sync.ts";
import type { JobHandlers } from "./queue.ts";

const notYet = async () => {};

export function buildHandlers(deps: Deps): JobHandlers {
  return {
    "catalog.sync": async (d) => void (await runCatalogSync(deps, d)),
    "catalog.reconcile": notYet,
    "catalog.staleness": notYet,
    "square.refresh_tokens": notYet,
    "order.reconcile": async (d) => void (await reconcileOrder(deps, d.orderId)),
    "webhook.process": (d) => processSquareEvent(deps, d.eventId),
    "call.finalize": notYet,
    "alerts.fanout": notYet,
    "retention.purge": notYet,
    "usage.rollup": notYet,
  };
}
