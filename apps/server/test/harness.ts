// Starts a real Postgres, the real app, and signs tokens with a throw-away key, so a test goes
// through exactly the code a request does in production (auth, tenancy, row level security).
import { randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { FastifyInstance } from "fastify";
import { createPool, type Db } from "@receptionist/db";
import { startTestDatabase, type TestDatabase } from "@receptionist/db/testing";
import { buildApp } from "../src/app.ts";
import { AccessService } from "../src/auth/access.ts";
import { createJwtVerifier } from "../src/auth/jwt.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { TokenCipher, keyFromBase64 } from "../src/crypto.ts";
import type { Deps } from "../src/deps.ts";
import { InlineQueue } from "../src/jobs/queue.ts";
import { LiveBus } from "../src/live.ts";
import { FakeEmail, FakeRealtime, FakeTwilio } from "../src/providers/fakes.ts";
import { createSquareFactory } from "../src/providers/square-http.ts";
import type { ChatModel } from "../src/providers/chat.ts";
import type { SpeechToText } from "../src/providers/speech.ts";
import { SquareStub } from "../src/dev/square-stub.ts";

export const SUPABASE_URL = "https://project.supabase.test";
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

export type TestUser = { id: string; email: string; name: string };
export const newUser = (name: string): TestUser => ({ id: randomUUID(), email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`, name });

export type Harness = {
  td: TestDatabase;
  db: Db;
  app: FastifyInstance;
  deps: Deps;
  config: Config;
  twilio: FakeTwilio;
  email: FakeEmail;
  jobs: InlineQueue;
  square: SquareStub | null;
  realtime: FakeRealtime | null;
  /** Starts the server on a free port so a real WebSocket can connect. Returns its base URL. */
  listen(): Promise<string>;
  token(user: TestUser, overrides?: { aud?: string; iss?: string; expiresIn?: string }): Promise<string>;
  call(user: TestUser | null, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }>;
  setNow(d: Date | null): void;
  stop(): Promise<void>;
};

export async function startHarness(options: { configure?: (env: Record<string, string>) => void; square?: boolean; realtime?: boolean; chat?: ChatModel; stt?: SpeechToText } = {}): Promise<Harness> {
  const td = await startTestDatabase();
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" };
  const env: Record<string, string> = {
    NODE_ENV: "test", LOG_LEVEL: "silent", PORT: "8080",
    PUBLIC_API_BASE_URL: "https://api.example.test", DASHBOARD_ORIGIN: "https://app.example.test",
    DATABASE_URL: td.url, SUPABASE_URL, TOKEN_ENCRYPTION_KEY: KEY_B64, VOICE_STREAM_SECRET: "v".repeat(40),
    SQUARE_WEBHOOK_SIGNATURE_KEY: "square-signature-key", SQUARE_WEBHOOK_NOTIFICATION_URL: "https://api.example.test/webhooks/square",
    TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32), TWILIO_AUTH_TOKEN: "test-auth-token",
  };
  options.configure?.(env);
  const config = loadConfig(env);
  const db = createPool(td.url, { max: 8, applicationName: "test-app" });
  const bus = new LiveBus(td.url);
  await bus.start();
  const twilio = new FakeTwilio(config.TWILIO_AUTH_TOKEN);
  const email = new FakeEmail();
  const jobs = new InlineQueue();
  const realtime = options.realtime ? new FakeRealtime() : null;
  let square: SquareStub | null = null;
  if (options.square) {
    square = new SquareStub();
    await square.start();
  }
  let frozen: Date | null = null;
  const deps: Deps = {
    config, db, bus,
    access: new AccessService(db),
    verify: createJwtVerifier({ keys: createLocalJWKSet({ keys: [jwk] }), issuer: `${SUPABASE_URL}/auth/v1`, audience: "authenticated" }),
    cipher: new TokenCipher({ current: 1, keys: new Map([[1, keyFromBase64(KEY_B64)]]) }),
    providers: {
      email, twilio,
      realtime,
      chat: options.chat ?? null,
      stt: options.stt ?? null,
      square: square
        ? createSquareFactory({ apiVersion: config.SQUARE_API_VERSION, credentials: { SANDBOX: { applicationId: "sq0idp-test", applicationSecret: "sq0csp-test" } }, baseUrls: { SANDBOX: square.url, PRODUCTION: square.url }, timeoutMs: 3000, orderTimeoutMs: 1500 })
        : null,
    },
    jobs,
    now: () => frozen ?? new Date(),
  };
  const app = await buildApp(deps);
  await app.ready();

  const token: Harness["token"] = (user, o = {}) =>
    new SignJWT({ email: user.email, user_metadata: { name: user.name } })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(user.id)
      .setIssuer(o.iss ?? `${SUPABASE_URL}/auth/v1`)
      .setAudience(o.aud ?? "authenticated")
      .setIssuedAt()
      .setExpirationTime(o.expiresIn ?? "1h")
      .sign(privateKey);

  return {
    td, db, app, deps, config, twilio, email, jobs, square, realtime, token,
    async listen() {
      await app.listen({ port: 0, host: "127.0.0.1" });
      const addr = app.server.address() as { port: number };
      return `127.0.0.1:${addr.port}`;
    },
    async call(user, method, url, body) {
      const headers: Record<string, string> = {};
      if (user) headers.authorization = `Bearer ${await token(user)}`;
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await app.inject({ method: method as "GET", url: `/api/v1${url}`, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
      let parsed: any = null;
      try {
        parsed = res.body ? JSON.parse(res.body) : null;
      } catch {
        parsed = res.body;
      }
      return { status: res.statusCode, body: parsed };
    },
    setNow(d) {
      frozen = d;
    },
    async stop() {
      await app.close();
      await square?.stop();
      await bus.close();
      await db.end().catch(() => {});
      await td.stop();
    },
  };
}

/** Signs a person up with a restaurant and returns the ids the rest of a test needs. */
export async function signUp(h: Harness, user: TestUser, restaurantName: string, timezone = "America/New_York") {
  const r = await h.call(user, "POST", "/restaurants", {
    name: restaurantName,
    location: { name: "Main Street", timezone, address: { line1: "12 Main St", city: "Brooklyn", region: "NY", postalCode: "11201", country: "US" } },
  });
  if (r.status !== 201) throw new Error(`sign-up failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { restaurantId: string; locationId: string; slug: string };
}
