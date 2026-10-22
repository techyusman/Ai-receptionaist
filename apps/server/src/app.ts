import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { bearerToken } from "./http.ts";
import type { Deps } from "./deps.ts";
import { toProblem } from "./problems.ts";
import { registerPublicRoutes } from "./routes/public.ts";
import { registerRoutes } from "./routes/index.ts";

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Phone numbers, names and tokens never reach the logs: no query strings, no auth headers.
      redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-twilio-signature']"], censor: "[redacted]" },
      serializers: {
        req: (req) => ({ method: req.method, url: String(req.url).split("?")[0], id: req.id }),
      },
    },
    genReqId: (req) => (typeof req.headers["x-request-id"] === "string" && /^[\w-]{8,64}$/.test(req.headers["x-request-id"]) ? req.headers["x-request-id"] : randomUUID()),
    trustProxy: config.NODE_ENV === "production",
    bodyLimit: 256 * 1024,
    routerOptions: { maxParamLength: 200 },
  });

  await app.register(cors, {
    origin: config.DASHBOARD_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-request-id"],
    maxAge: 600,
  });
  await app.register(formbody);
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    // One person at one desk should never hit this; a script hammering the API does.
    keyGenerator: (req) => req.identity?.userId ?? req.ip,
  });

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    return payload;
  });

  app.setErrorHandler((error, req, reply) => {
    const problem = toProblem(error);
    if (problem.status >= 500) req.log.error({ err: error }, "request failed");
    else req.log.info({ code: problem.body.error.code, status: problem.status }, "request rejected");
    return reply.status(problem.status).send(problem.body);
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: "Not found." } }));

  app.get("/healthz", { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await deps.db.query("select 1");
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  registerPublicRoutes(app, deps);

  // Everything under /api/v1 needs a valid Supabase token. The user row is created on first sight.
  const knownUsers = new Map<string, number>();
  await app.register(
    async (api) => {
      api.addHook("onRequest", async (req) => {
        req.identity = await deps.verify(bearerToken(req));
        const seen = knownUsers.get(req.identity.userId);
        if (!seen || seen < Date.now() - 60_000) {
          await deps.access.ensureUser(req.identity);
          knownUsers.set(req.identity.userId, Date.now());
          if (knownUsers.size > 5000) knownUsers.clear();
        }
      });
      await registerRoutes(api, deps);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
