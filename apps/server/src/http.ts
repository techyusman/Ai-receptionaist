// Small request helpers shared by the route files.
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { Identity } from "./auth/jwt.ts";
import type { RequestMeta } from "./audit.ts";
import { unauthenticated } from "./errors.ts";

declare module "fastify" {
  interface FastifyRequest {
    identity?: Identity;
  }
}

export function bearerToken(req: FastifyRequest): string {
  const h = req.headers.authorization;
  const m = typeof h === "string" ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  if (!m) throw unauthenticated();
  return m[1]!;
}

export function who(req: FastifyRequest): Identity {
  if (!req.identity) throw unauthenticated();
  return req.identity;
}

export function meta(req: FastifyRequest): RequestMeta {
  return { requestId: req.id, ip: req.ip || null, userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null };
}

/** Parses input with a contracts schema. A failure becomes a 400 whose message sits next to its field. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data ?? {});
}

export const idParam = z.object({ id: z.uuid("That isn't a valid id.") });
export const lidParam = z.object({ lid: z.uuid("That isn't a valid id.") });
export const ridParam = z.object({ rid: z.uuid("That isn't a valid id.") });
