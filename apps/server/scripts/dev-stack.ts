// npm run dev:stack -w apps/server
// Runs the whole backend on this machine with no accounts or keys: a real Postgres (embedded), a stand-in
// for Supabase sign-in (every code is 246810), a stand-in for Square's sandbox, the API and the worker, and
// the sample café. Emails and texts are printed here instead of being sent. Data persists in .dev-data/.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pgClient from "pg";
import { createPool, migrate } from "@receptionist/db";
import { buildApp } from "../src/app.ts";
import { AccessService } from "../src/auth/access.ts";
import { createJwtVerifier, remoteJwks } from "../src/auth/jwt.ts";
import { loadConfig } from "../src/config.ts";
import { keyringFrom, TokenCipher } from "../src/crypto.ts";
import type { Deps } from "../src/deps.ts";
import { AuthStub, newAuthKeys, type AuthStubKeys } from "../src/dev/auth-stub.ts";
import { seedThirdSpace, SEED_PEOPLE } from "../src/dev/seed.ts";
import { SquareStub } from "../src/dev/square-stub.ts";
import { thirdSpaceCatalog } from "../src/dev/third-space-catalog.ts";
import { buildHandlers } from "../src/jobs/handlers.ts";
import { grantQueueAccess, PgBossQueue } from "../src/jobs/pgboss.ts";
import { LiveBus } from "../src/live.ts";
import { FakeTwilio } from "../src/providers/fakes.ts";
import { createOpenAiRealtime } from "../src/providers/realtime-openai.ts";
import { createSquareFactory } from "../src/providers/square-http.ts";

// DEV_DATA_DIR lets the end-to-end tests run a separate copy; DEV_FRESH=1 starts it from the seed every time.
const DATA = process.env.DEV_DATA_DIR ?? join(import.meta.dirname, "..", ".dev-data");
if (process.env.DEV_FRESH === "1") rmSync(DATA, { recursive: true, force: true });
const PORTS = { pg: Number(process.env.DEV_PG_PORT ?? 54329), auth: Number(process.env.DEV_AUTH_PORT ?? 54321), square: Number(process.env.DEV_SQUARE_PORT ?? 54330), api: Number(process.env.PORT ?? 4000) };
const DASHBOARD = process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000";
const SQUARE_TOKENS = { access: "dev-square-access-token", refresh: "dev-square-refresh-token" };

mkdirSync(DATA, { recursive: true });
const secretsFile = join(DATA, "secrets.json");
type Secrets = { tokenKey: string; voiceSecret: string; auth: AuthStubKeys };
const secrets: Secrets = existsSync(secretsFile)
  ? (JSON.parse(readFileSync(secretsFile, "utf8")) as Secrets)
  : { tokenKey: randomBytes(32).toString("base64"), voiceSecret: randomBytes(32).toString("base64url"), auth: await newAuthKeys() };
writeFileSync(secretsFile, JSON.stringify(secrets, null, 2));

const pgDir = join(DATA, "pg");
// UTF-8 always: on Windows the default is WIN1252, which can't store an emoji in a restaurant's name.
// io_method=sync: no I/O worker processes, which on Windows outlive a force-killed server and keep its port.
const pg = new EmbeddedPostgres({
  databaseDir: pgDir,
  user: "postgres",
  password: "postgres",
  port: PORTS.pg,
  persistent: true,
  onLog: () => {},
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", "io_method=sync"],
});
const dbUrl = `postgres://postgres:postgres@127.0.0.1:${PORTS.pg}/postgres`;
// If a previous run was killed, its Postgres may still be up on the same port: use it rather than fail.
const alreadyUp = await (async () => {
  // A short timeout: a half-dead server from a killed run can accept the socket and never answer.
  const probe = new pgClient.Client({ connectionString: dbUrl, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  try {
    await probe.connect();
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
})();
if (!alreadyUp) {
  if (!existsSync(join(pgDir, "PG_VERSION"))) await pg.initialise();
  // Nothing answered on the port, so a lock file left by a window that was closed (not Ctrl+C) is stale.
  // On Windows its process id may already belong to something else, and Postgres would refuse to start.
  rmSync(join(pgDir, "postmaster.pid"), { force: true });
  await pg.start();
}
const admin = createPool(dbUrl, { max: 4, applicationName: "dev-admin" });
const applied = await migrate(admin);
if (applied.applied.length) console.log(`migrations applied: ${applied.applied.join(", ")}`);
const install = new PgBossQueue(dbUrl, "install");
await install.install();
await install.stop();
await grantQueueAccess(admin);

const auth = new AuthStub(secrets.auth, Object.fromEntries(SEED_PEOPLE.map((p) => [p.email, p.name])));
await auth.start(PORTS.auth);
const square = new SquareStub();
square.catalog = thirdSpaceCatalog().map((o) => ({ ...o, updated_at: "2026-10-01T00:00:00Z" }));
square.acceptAnyToken = true;
// A second location, so a newly signed-up restaurant has one to claim (the sample café holds the first).
square.locations.push({ id: "LSAMPLE0000002", name: "Third Space - Second Avenue", status: "ACTIVE", address: { address_line_1: "88 Second Avenue", locality: "New York", administrative_district_level_1: "NY" } });
square.validAccess.add(SQUARE_TOKENS.access);
square.refreshTokens.set(SQUARE_TOKENS.refresh, SQUARE_TOKENS.access);
await square.start(PORTS.square);

const config = loadConfig({
  ...process.env,
  NODE_ENV: "development",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
  PORT: String(PORTS.api),
  PUBLIC_API_BASE_URL: `http://localhost:${PORTS.api}`,
  DASHBOARD_ORIGIN: DASHBOARD,
  DATABASE_URL: dbUrl,
  SUPABASE_URL: auth.url,
  // The sign-in stand-in accepts any service key; without one, "Delete my account" can't work locally.
  SUPABASE_SERVICE_ROLE_KEY: "dev-service-role-key",
  TOKEN_ENCRYPTION_KEY: secrets.tokenKey,
  VOICE_STREAM_SECRET: secrets.voiceSecret,
  SQUARE_WEBHOOK_SIGNATURE_KEY: "dev-square-signature-key",
  SQUARE_WEBHOOK_NOTIFICATION_URL: `http://localhost:${PORTS.api}/webhooks/square`,
});

const cipher = new TokenCipher(keyringFrom(config));
const seeded = await seedThirdSpace(admin, { cipher, squareTokens: SQUARE_TOKENS });

/** Texts and emails are printed, so invite links and alerts can be followed by hand. */
class PrintingTwilio extends FakeTwilio {
  override async sendSms(to: string, body: string) {
    await super.sendSms(to, body);
    auth.mailbox.push({ to, subject: "SMS", text: body, at: new Date().toISOString() });
    console.log(`[sms to ${to}] ${body}`);
  }
}
const queue = new PgBossQueue(dbUrl, "worker");
await queue.connect();
const bus = new LiveBus(dbUrl);
await bus.start();
const db = createPool(dbUrl, { max: 12, applicationName: "dev-api" });
const deps: Deps = {
  config, db, bus, jobs: queue, cipher,
  access: new AccessService(db),
  verify: createJwtVerifier({ keys: remoteJwks(`${auth.url}/auth/v1/.well-known/jwks.json`), issuer: `${auth.url}/auth/v1`, audience: "authenticated" }),
  providers: {
    email: {
      send: async (m) => {
        auth.mailbox.push({ to: m.to, subject: m.subject, text: m.text, at: new Date().toISOString() });
        console.log(`[email to ${m.to}] ${m.subject}`);
      },
    },
    twilio: new PrintingTwilio(),
    square: createSquareFactory({ apiVersion: config.SQUARE_API_VERSION, credentials: { SANDBOX: { applicationId: "sq0idp-dev", applicationSecret: "sq0csp-dev" } }, baseUrls: { SANDBOX: square.url, PRODUCTION: square.url } }),
    realtime: config.OPENAI_API_KEY ? createOpenAiRealtime({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_REALTIME_MODEL }) : null,
  },
  now: () => new Date(),
};
await queue.work(buildHandlers(deps), (msg, extra) => console.log(`[jobs] ${msg}`, extra ?? ""));
const app = await buildApp(deps);
await app.listen({ port: PORTS.api, host: "127.0.0.1" });

console.log(`
Backend running (development).
  API          http://localhost:${PORTS.api}   (health: /healthz)
  Sign-in      ${auth.url}   every code is 246810
  Square       ${square.url}   (a stand-in for the sandbox; "connect" goes straight through)
  Postgres     ${dbUrl}
  Sample café  ${seeded.created ? "created" : "already there"} (restaurant ${seeded.restaurantId})

Run the dashboard against it (in another terminal):
  npm run dev:dashboard          then open http://localhost:3000
  (its settings for this stack are in apps/dashboard/.env.development)
Then sign in as ${SEED_PEOPLE.map((p) => `${p.email} (${p.role.toLowerCase()})`).join(", ")}.
`);

async function stop() {
  await app.close();
  await Promise.allSettled([queue.stop(), bus.close(), db.end(), admin.end(), auth.stop(), square.stop()]);
  if (!alreadyUp) await pg.stop();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
