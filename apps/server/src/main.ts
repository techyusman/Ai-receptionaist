// The web process: the API, the Twilio and Square webhooks, and the media WebSocket for live calls.
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { PgBossQueue } from "./jobs/pgboss.ts";
import { lifecycle } from "./lifecycle.ts";
import { LiveBus } from "./live.ts";
import { buildDeps } from "./runtime.ts";
import { activeCalls } from "./voice/active.ts";

const config = loadConfig();
const queue = new PgBossQueue(config.DATABASE_URL, "web");
await queue.connect();
const bus = new LiveBus(config.DATABASE_URL);
await bus.start();
const deps = buildDeps(config, queue, bus, { poolSize: 20, name: "receptionist-web" });
const app = await buildApp(deps);
await app.listen({ port: config.PORT, host: "0.0.0.0" });
app.log.info({ twilio: !!deps.providers.twilio, square: !!deps.providers.square, model: !!deps.providers.realtime, email: !!deps.providers.email }, "listening");

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  lifecycle.draining = true;
  app.log.info({ signal, calls: activeCalls.count }, "draining: no new calls, waiting for calls in progress");
  const deadline = Date.now() + config.DRAIN_SECONDS * 1000;
  while (activeCalls.count > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
  await app.close();
  await Promise.allSettled([bus.close(), queue.stop(), deps.db.end()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
