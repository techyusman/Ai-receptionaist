// Twilio's call-progress webhooks: the call ending, and the result of a transfer to a person.
import { maybeOne, one, withSystem } from "@receptionist/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { raiseAlert } from "../alerts.ts";
import { endCall } from "../calls/outcome.ts";
import { addEvent } from "../calls/service.ts";
import type { Deps } from "../deps.ts";
import { signal } from "../live.ts";
import { connectStream, hangUp, whisper } from "../voice/twiml.ts";
import { publicUrl, streamPass, streamUrl } from "./twilio.ts";

const TWIML = "text/xml";
const DIAL_RESULT = { completed: "CONNECTED", busy: "BUSY", "no-answer": "NO_ANSWER", failed: "FAILED", canceled: "CANCELED" } as const;
const TRANSFER_STATUS = { CONNECTED: "CONNECTED", BUSY: "BUSY", NO_ANSWER: "NO_ANSWER", FAILED: "FAILED", CANCELED: "FAILED" } as const;

function verifiedParams(deps: Deps, req: FastifyRequest): Record<string, string> | null {
  const sig = req.headers["x-twilio-signature"];
  if (!deps.providers.twilio || typeof sig !== "string") return null;
  const params = (req.body ?? {}) as Record<string, string>;
  return deps.providers.twilio.validateSignature(sig, publicUrl(deps, req.url), params) ? params : null;
}

export function registerTwilioCallWebhooks(app: FastifyInstance, deps: Deps) {
  const limit = { rateLimit: { max: 300, timeWindow: "1 minute" } };

  // Called by Twilio as the call ends (or fails to connect). Closing the record here, with its outcome,
  // means a dropped media stream can never leave a call hanging as "in progress".
  app.post("/webhooks/twilio/status", { config: limit }, async (req, reply) => {
    const p = verifiedParams(deps, req);
    if (!p) return reply.status(403).send("Forbidden");
    if (["completed", "busy", "failed", "no-answer", "canceled"].includes(p.CallStatus ?? "")) {
      await withSystem(deps.db, async (tx) => {
        const call = await maybeOne<{ id: string; restaurant_id: string; location_id: string }>(tx, "select id, restaurant_id, location_id from calls where provider_call_sid = $1", [p.CallSid]);
        if (!call) return;
        const done = await endCall(tx, call.id, p.CallStatus!, p.CallDuration ? Number(p.CallDuration) : null);
        if (!done.ended) return;
        await addEvent(tx, call.id, call.restaurant_id, "call.ended", "SYSTEM", `Call ended (${p.CallStatus}).`);
        await deps.jobs.enqueue("call.finalize", { callId: call.id }, { tx });
        await signal(tx, call.location_id, { type: "call", id: call.id });
      });
    }
    return reply.status(204).send();
  });

  // After the AI tried to put the caller through to a person. If no one picked up, the caller comes
  // back to the AI, who offers a callback instead of leaving them on a dead line.
  app.post("/webhooks/twilio/transfer-result", { config: limit }, async (req, reply) => {
    reply.type(TWIML);
    const p = verifiedParams(deps, req);
    if (!p) return reply.status(403).send("Forbidden");
    const q = req.query as { call?: string; transfer?: string };
    if (!q.call || !q.transfer) return hangUp();
    const result = DIAL_RESULT[(p.DialCallStatus ?? "failed") as keyof typeof DIAL_RESULT] ?? "FAILED";
    const resumed = await withSystem(deps.db, async (tx) => {
      const t = await maybeOne<{ id: string; restaurant_id: string; target_id: string | null; call_id: string }>(
        tx, "select t.id, t.restaurant_id, t.target_id, t.call_id from transfers t join calls c on c.id = t.call_id where t.id = $1 and t.call_id = $2 and c.provider_call_sid = $3", [q.transfer, q.call, p.CallSid]);
      if (!t) return null;
      await tx.query("update transfers set result = $2, ended_at = now(), answered_at = case when $2 = 'CONNECTED' then now() else answered_at end where id = $1", [t.id, result]);
      await tx.query("update calls set transfer_status = $2, status = case when $2 = 'CONNECTED' then status else 'IN_PROGRESS' end where id = $1", [t.call_id, TRANSFER_STATUS[result]]);
      const loc = await one<{ location_id: string }>(tx, "select location_id from calls where id = $1", [t.call_id]);
      if (result === "CONNECTED") {
        await addEvent(tx, t.call_id, t.restaurant_id, "transfer.connected", "STAFF", "A person took the call.");
        await signal(tx, loc.location_id, { type: "call", id: t.call_id });
        return false;
      }
      await addEvent(tx, t.call_id, t.restaurant_id, "transfer.missed", "SYSTEM", `Nobody picked up (${result.toLowerCase().replace("_", " ")}). The AI offered a callback.`);
      await raiseAlert(deps, tx, { restaurantId: t.restaurant_id, locationId: loc.location_id, kind: "TRANSFER_MISSED", severity: "WARNING", callId: t.call_id, message: "A caller asked for a person but nobody answered. The AI is offering to take a callback.", dedupeKey: `transfer-missed:${t.call_id}` });
      return true;
    });
    if (resumed === null) return hangUp();
    if (!resumed) return hangUp();
    return deps.providers.realtime ? connectStream(streamUrl(deps), streamPass(deps, q.call, true), { resume: "1" }) : hangUp();
  });

  // Read to the person who answers a transfer, before they are connected: who is calling and why, so
  // the caller doesn't have to repeat themselves. This request comes from the staff leg of the call.
  app.post("/webhooks/twilio/transfer-whisper", { config: limit }, async (req, reply) => {
    reply.type(TWIML);
    const p = verifiedParams(deps, req);
    if (!p) return reply.status(403).send("Forbidden");
    const q = req.query as { call?: string; transfer?: string };
    const text = await withSystem(deps.db, async (tx) => {
      const t = await maybeOne<{ reason: string; customer_name: string | null; lines: string | null; total: number | null }>(
        tx,
        `select t.reason, o.customer_name,
                (select string_agg(oi.quantity || ' ' || oi.item_name, ', ' order by oi.line_no) from order_items oi where oi.order_id = o.id) as lines, o.total_minor as total
           from transfers t join calls c on c.id = t.call_id left join orders o on o.id = t.order_id
          where t.id = $1 and t.call_id = $2 and c.provider_call_sid = $3`,
        [q.transfer, q.call, p.ParentCallSid ?? p.CallSid],
      );
      if (!t) return null;
      const why: Record<string, string> = {
        CALLER_REQUEST: "asked to speak to a person", LOW_CONFIDENCE: "needs help the assistant could not give", POLICY_BOUNDARY: "asked about something the assistant cannot decide",
        RECOGNITION_FAILURES: "could not be understood", SUBMISSION_UNCERTAIN: "has an order that may not have gone through", INTEGRATION_ERROR: "has an order the system could not place",
        ALLERGEN: "has an allergy question", COMPLAINT: "has a complaint", RING_STAFF_FIRST: "is calling",
      };
      const who = t.customer_name ? `${t.customer_name} ` : "A caller ";
      const order = t.lines ? ` Their draft order: ${t.lines}.` : "";
      return `Call from the restaurant assistant. ${who}${why[t.reason] ?? "needs a person"}.${order} Connecting you now.`;
    });
    return text ? whisper(text) : hangUp();
  });
}
