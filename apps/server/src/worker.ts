// The worker process: background jobs (menu syncs, order reconciliation, call wrap-up, alerts,
// retention) and the recurring schedules. Runs separately so a slow job never delays a phone call.
import { loadConfig } from "./config.ts";
import { buildHandlers } from "./jobs/handlers.ts";
import { PgBossQueue } from "./jobs/pgboss.ts";
import { LiveBus } from "./live.ts";
import { buildDeps } from "./runtime.ts";

const config = loadConfig();
const queue = new PgBossQueue(config.DATABASE_URL, "worker");
await queue.connect();
// Jobs only send live updates through Postgres NOTIFY, so the bus here never needs to listen.
const bus = new LiveBus(config.DATABASE_URL);
const deps = buildDeps(config, queue, bus, { poolSize: 6, name: "receptionist-worker" });
const log = (msg: string, extra: object = {}) => console.log(JSON.stringify({ level: "info", msg, ...extra }));
await queue.work(buildHandlers(deps), log);
log("worker started");

async function shutdown() {
  await queue.stop();
  await deps.db.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
