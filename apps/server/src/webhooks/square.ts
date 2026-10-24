// Square calls this whenever something changes on its side. The request is trusted only if its
// HMAC-SHA256 signature matches: Square signs the notification URL we registered plus the raw body,
// so we use the configured URL (the proxy in front of us changes the one the request arrives on) and the
// bytes exactly as received. Only verified deliveries are stored, and each event id is handled once.
import { createHmac, timingSafeEqual } from "node:crypto";
import { withSystem } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.ts";

export function squareSignature(key: string, url: string, rawBody: string): string {
  return createHmac("sha256", key).update(url + rawBody).digest("base64");
}

export function signatureMatches(key: string, url: string, rawBody: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(squareSignature(key, url, rawBody));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type SquareEvent = { merchant_id?: string; type?: string; event_id?: string; data?: { type?: string; id?: string; object?: Record<string, any> } };

/** Keeps only identifiers: the full payload can carry customer details we have no reason to store. */
export function redact(e: SquareEvent): Record<string, unknown> {
  const o = e.data?.object ?? {};
  const inner = o.order_updated ?? o.order_fulfillment_updated ?? o.catalog_version ?? o.order_created ?? {};
  return { type: e.type, merchant_id: e.merchant_id, object_id: e.data?.id, order_id: inner.order_id, location_id: inner.location_id, state: inner.state, version: inner.version, updated_at: inner.updated_at };
}

export function registerSquareWebhook(app: FastifyInstance, deps: Deps) {
  // Its own plugin scope, so the raw-body JSON parser applies to this route only.
  void app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

    scope.post("/webhooks/square", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      const key = deps.config.SQUARE_WEBHOOK_SIGNATURE_KEY;
      const url = deps.config.SQUARE_WEBHOOK_NOTIFICATION_URL;
      if (!key || !url) return reply.status(503).send({ error: { code: "UPSTREAM", message: "Square webhooks aren't configured." } });
      if (!signatureMatches(key, url, raw, req.headers["x-square-hmacsha256-signature"] as string | undefined)) {
        req.log.warn("square webhook signature mismatch");
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "Bad signature." } });
      }
      let event: SquareEvent;
      try {
        event = JSON.parse(raw) as SquareEvent;
      } catch {
        return reply.status(400).send({ error: { code: "VALIDATION", message: "Not JSON." } });
      }
      if (!event.event_id || !event.type) return reply.status(400).send({ error: { code: "VALIDATION", message: "Missing event id or type." } });
      const stored = await withSystem(deps.db, async (tx) => {
        const r = await tx.query<{ id: string }>(
          `insert into webhook_events (provider, provider_event_id, event_type, payload_redacted)
           values ('SQUARE', $1, $2, $3) on conflict (provider, provider_event_id) do nothing returning id`,
          [event.event_id, event.type, JSON.stringify(redact(event))],
        );
        const id = r.rows[0]?.id;
        if (id) await deps.jobs.enqueue("webhook.process", { eventId: id }, { tx });
        return id;
      });
      // Square retries anything that isn't a 2xx; a repeat of an event we already hold is still a success.
      return reply.status(200).send({ ok: true, duplicate: !stored });
    });
  });
}
