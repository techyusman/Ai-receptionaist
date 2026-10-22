// Endpoints that other services call directly, so they carry no bearer token: the Square OAuth
// redirect here, and the Twilio and Square webhooks (registered from webhooks/).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import { completeSquareOAuth } from "./square.ts";

export function registerPublicRoutes(app: FastifyInstance, deps: Deps) {
  app.get("/oauth/square/callback", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const q = z.object({ code: z.string().max(500).optional(), state: z.string().max(200).optional(), error: z.string().max(100).optional() }).safeParse(req.query);
    const dest = await completeSquareOAuth(deps, q.success ? q.data : {});
    return reply.redirect(dest, 302);
  });
}
