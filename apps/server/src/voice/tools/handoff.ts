import { isOpenAt } from "@receptionist/domain";
import { many, one, withSystem } from "@receptionist/db";
import { z } from "zod";
import { addEvent } from "../../calls/service.ts";
import { signal } from "../../live.ts";
import { readHours, readSpecialHours } from "../../routes/hours.ts";
import { publicUrl } from "../../webhooks/twilio.ts";
import { currentOrder } from "./order-support.ts";
import { ok, refuse, type ToolDef } from "./types.ts";

// What the model says → the transfer reason on record and which kind of staff number suits it.
const REASONS = {
  caller_request: { reason: "CALLER_REQUEST", intent: "GENERAL" },
  allergen: { reason: "ALLERGEN", intent: "ALLERGEN" },
  complaint: { reason: "COMPLAINT", intent: "COMPLAINT" },
  large_party: { reason: "CALLER_REQUEST", intent: "LARGE_PARTY" },
  catering: { reason: "CALLER_REQUEST", intent: "CATERING" },
  cannot_help: { reason: "LOW_CONFIDENCE", intent: "GENERAL" },
  order_problem: { reason: "INTEGRATION_ERROR", intent: "GENERAL" },
} as const;

const transferSchema = z.object({ reason: z.enum(Object.keys(REASONS) as [keyof typeof REASONS, ...(keyof typeof REASONS)[]]) });
const LIVE_ORDER = ["SUBMITTED_TO_POS", "RECEIVED_BY_RESTAURANT", "POS_VISIBILITY_UNVERIFIED"];

export const requestHumanTransfer: ToolDef<typeof transferSchema> = {
  name: "request_human_transfer",
  description: "Pass the caller to a person at the restaurant. Use when they ask for one, for allergy questions, complaints, large parties and catering, or when you can't help. Tell them you are connecting them first. A draft order is not sent just because of a transfer.",
  parameters: { type: "object", properties: { reason: { type: "string", enum: Object.keys(REASONS) } }, required: ["reason"] },
  schema: transferSchema,
  async run(deps, ctx, a) {
    const want = REASONS[a.reason];
    return withSystem(deps.db, async (tx) => {
      const [hours, specials, tried] = await Promise.all([
        readHours(tx, ctx.locationId), readSpecialHours(tx, ctx.locationId),
        many<{ target_id: string | null }>(tx, "select target_id from transfers where call_id = $1", [ctx.callId]),
      ]);
      if (tried.length >= ctx.settings.maxTransferAttempts) {
        return refuse("MAX_ATTEMPTS", "I've tried to connect you a couple of times without luck. Offer to take a name and number for a call back.");
      }
      const storeOpen = !hours.store.length || isOpenAt(hours.store, specials, deps.now(), ctx.timezone);
      const triedIds = new Set(tried.map((t) => t.target_id));
      const targets = await many<{ id: string; label: string; e164: string; intent: string; active_hours: string }>(
        tx, "select id, label, e164, intent, active_hours from transfer_targets where location_id = $1 and enabled order by priority, created_at", [ctx.locationId]);
      const usable = targets.filter((t) => !triedIds.has(t.id) && (t.active_hours === "ALWAYS" || storeOpen));
      const target = usable.find((t) => t.intent === want.intent) ?? usable.find((t) => t.intent === "GENERAL");
      if (!target) return refuse("NO_TARGET", "Nobody is available to take the call right now. Offer to take a name and number so someone can call back.");
      const order = await currentOrder(tx, ctx);
      const draftId = order && !LIVE_ORDER.includes(order.status) ? order.id : null;
      const t = await one<{ id: string }>(
        tx,
        `insert into transfers (restaurant_id, call_id, order_id, target_id, destination_e164, reason, strategy, attempt_no)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [ctx.restaurantId, ctx.callId, draftId, target.id, target.e164, want.reason, ctx.settings.transferStrategy, tried.length + 1],
      );
      await tx.query("update calls set status = 'TRANSFERRING', transfer_status = 'ATTEMPTED' where id = $1", [ctx.callId]);
      await addEvent(tx, ctx.callId, ctx.restaurantId, "handoff.triggered", "AI", `Connecting the caller to ${target.label} (${a.reason.replace("_", " ")}).`);
      await signal(tx, ctx.locationId, { type: "call", id: ctx.callId });
      const q = `?call=${ctx.callId}&transfer=${t.id}`;
      return ok(
        { connecting_to: target.label, say: "Tell the caller you are connecting them now, in one short sentence." },
        { transfer: { transferId: t.id, number: target.e164, seconds: ctx.settings.transferTimeoutSeconds, whisperUrl: publicUrl(deps, `/webhooks/twilio/transfer-whisper${q}`), actionUrl: publicUrl(deps, `/webhooks/twilio/transfer-result${q}`) } },
      );
    });
  },
};
