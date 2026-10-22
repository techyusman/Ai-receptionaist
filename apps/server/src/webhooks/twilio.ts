// Twilio's call webhooks. Every request is checked against its X-Twilio-Signature (an HMAC over the
// full public URL plus the form fields) before anything is read, so nobody can create calls, end calls
// or trigger transfers by posting to these URLs. The restaurant for a call always comes from the number
// that was dialled, never from anything the caller or the request says.
import { randomUUID } from "node:crypto";
import { maybeOne, withSystem } from "@receptionist/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import parsePhone from "libphonenumber-js";
import type { Deps } from "../deps.ts";
import { addEvent, createCall, resolveCallTarget } from "../calls/service.ts";
import { connectStream, dialFallback, hangUp, ringStaffFirst, sayAndHangUp } from "../voice/twiml.ts";
import { signStreamToken } from "../voice/token.ts";

const TWIML = "text/xml";
const STREAM_PASS_SECONDS = 60;

export const publicUrl = (deps: Deps, path: string) => `${deps.config.PUBLIC_API_BASE_URL.replace(/\/$/, "")}${path}`;
export const streamUrl = (deps: Deps) => publicUrl(deps, "/voice/media").replace(/^http/, "ws");

/** Twilio's signature covers the exact URL it called, query string included. */
function verified(deps: Deps, req: FastifyRequest): Record<string, string> | null {
  const twilio = deps.providers.twilio;
  const sig = req.headers["x-twilio-signature"];
  if (!twilio || typeof sig !== "string") return null;
  const params = (req.body ?? {}) as Record<string, string>;
  return twilio.validateSignature(sig, publicUrl(deps, req.url), params) ? params : null;
}

export function streamPass(deps: Deps, callId: string, resume = false): string {
  return signStreamToken(deps.config.VOICE_STREAM_SECRET, { callId, exp: Date.now() + STREAM_PASS_SECONDS * 1000, resume, nonce: randomUUID() });
}

const normalise = (raw: string | undefined): string | null => {
  if (!raw || raw.startsWith("client:")) return null;
  const p = parsePhone(raw, "US");
  return p?.isValid() ? p.number : null;
};

export function registerTwilioWebhooks(app: FastifyInstance, deps: Deps) {
  const limit = { rateLimit: { max: 300, timeWindow: "1 minute" } };

  app.post("/webhooks/twilio/voice", { config: limit }, async (req, reply) => {
    reply.type(TWIML);
    const p = verified(deps, req);
    if (!p) return reply.status(403).send("Forbidden");
    const callSid = p.CallSid;
    const to = normalise(p.To) ?? normalise(p.Called);
    if (!callSid || !to) return sayAndHangUp("Sorry, this number can't take your call.");

    const outcome = await withSystem(deps.db, async (tx) => {
      const target = await resolveCallTarget(tx, to);
      if (!target) return null;
      // A browser test call is a Voice SDK client whose name encodes the location it was minted for.
      const isTest = (p.From ?? "").startsWith("client:");
      if (isTest && !(p.From ?? "").endsWith(target.locationId)) return null;
      const ringStaff = !isTest && target.ringStaffFirst && !!target.publicPhone;
      const { call, created } = await createCall(tx, target, {
        callSid, from: normalise(p.From), to, isTest, status: ringStaff ? "RINGING_STAFF" : "IN_PROGRESS", at: deps.now(),
      });
      if (created && ringStaff) await addEvent(tx, call.id, target.restaurantId, "ring_staff.started", "SYSTEM", `Ringing the store line first (${target.ringStaffSeconds}s).`);
      return { target, call, ringStaff };
    });
    if (!outcome) return sayAndHangUp("Sorry, this number isn't in service.");

    const { target, call, ringStaff } = outcome;
    if (ringStaff && call.status === "RINGING_STAFF") {
      return ringStaffFirst({ number: target.publicPhone!, seconds: target.ringStaffSeconds, actionUrl: publicUrl(deps, `/webhooks/twilio/ring-staff-result?call=${call.id}`) });
    }
    // The AI line. If the model isn't available, a person still gets the call.
    if (!deps.providers.realtime) {
      return dialFallback(target.fallbackE164 ?? target.publicPhone, "Thanks for calling. Our assistant is unavailable right now, so I'm connecting you to the restaurant.");
    }
    return connectStream(streamUrl(deps), streamPass(deps, call.id));
  });

  app.post("/webhooks/twilio/ring-staff-result", { config: limit }, async (req, reply) => {
    reply.type(TWIML);
    const p = verified(deps, req);
    if (!p) return reply.status(403).send("Forbidden");
    const callId = (req.query as { call?: string }).call;
    if (!callId) return hangUp();
    const handled = p.DialCallStatus === "completed";
    const call = await withSystem(deps.db, async (tx) => {
      const c = await maybeOne<{ id: string; restaurant_id: string; location_id: string }>(tx, "select id, restaurant_id, location_id from calls where id = $1 and provider_call_sid = $2", [callId, p.CallSid]);
      if (!c) return null;
      if (handled) {
        await tx.query("update calls set status = 'ENDED', outcome = 'STAFF_ANSWERED', ended_at = now(), duration_seconds = $2 where id = $1 and status <> 'ENDED'", [c.id, Number(p.DialCallDuration ?? 0)]);
        await addEvent(tx, c.id, c.restaurant_id, "ring_staff.answered", "STAFF", "Staff answered before the AI.");
      } else {
        await tx.query("update calls set status = 'IN_PROGRESS' where id = $1 and status = 'RINGING_STAFF'", [c.id]);
        await addEvent(tx, c.id, c.restaurant_id, "ring_staff.unanswered", "SYSTEM", `Nobody answered (${p.DialCallStatus ?? "no answer"}); the AI took the call.`);
      }
      return c;
    });
    if (!call || handled) return hangUp();
    return deps.providers.realtime ? connectStream(streamUrl(deps), streamPass(deps, call.id)) : dialFallback(null, "Sorry, nobody is available to take your call right now. Please try again shortly.");
  });
}
