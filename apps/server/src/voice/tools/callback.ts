import { maybeOne, one, withSystem } from "@receptionist/db";
import { z } from "zod";
import { raiseAlert } from "../../alerts.ts";
import { addEvent } from "../../calls/service.ts";
import { signal } from "../../live.ts";
import { parseLocalPhone } from "../../phone.ts";
import { digitsForReadBack } from "./order-support.ts";
import { ok, refuse, type ToolDef } from "./types.ts";

const callbackSchema = z.object({
  name: z.string().trim().min(1).max(80), phone: z.string().trim().min(7).max(25), consent: z.boolean(),
  preferred_window: z.string().trim().max(100).optional(), reason: z.string().trim().max(300).optional(),
});

export const requestCallback: ToolDef<typeof callbackSchema> = {
  name: "request_callback",
  description: "Take the caller's name and number so a person can call them back. Only after the caller agrees to be called (consent true).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      phone: { type: "string" },
      consent: { type: "boolean", description: "True only if the caller said it is fine to call this number." },
      preferred_window: { type: "string", description: "When they'd like the call, in their words." },
      reason: { type: "string", description: "A short note on what it's about." },
    },
    required: ["name", "phone", "consent"],
  },
  schema: callbackSchema,
  async run(deps, ctx, a) {
    if (!a.consent) return refuse("NO_CONSENT", "Ask the caller if it's all right for someone to call them back on that number.");
    const number = parseLocalPhone(a.phone, ctx.country);
    if (!number) return refuse("BAD_PHONE", "That doesn't sound like a full phone number. Ask them to say it again, digit by digit.");
    return withSystem(deps.db, async (tx) => {
      const dup = await maybeOne(tx, "select 1 as x from callback_requests where call_id = $1 and phone_e164 = $2 and status = 'OPEN'", [ctx.callId, number]);
      if (!dup) {
        const r = await one<{ id: string }>(
          tx,
          `insert into callback_requests (restaurant_id, location_id, call_id, customer_name, phone_e164, preferred_window, reason)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [ctx.restaurantId, ctx.locationId, ctx.callId, a.name, number, a.preferred_window ?? null, a.reason ?? null],
        );
        await tx.query("update calls set caller_name = coalesce(caller_name, $2) where id = $1", [ctx.callId, a.name]);
        await raiseAlert(deps, tx, { restaurantId: ctx.restaurantId, locationId: ctx.locationId, kind: "CALLBACK_REQUESTED", severity: "INFO", callId: ctx.callId, message: `${a.name} asked for a call back.`, dedupeKey: `callback:${r.id}` });
        await signal(tx, ctx.locationId, { type: "callback", id: r.id });
      }
      await addEvent(tx, ctx.callId, ctx.restaurantId, "callback.requested", "AI", "Took a callback request.");
      return ok({ say: `Read the number back (${digitsForReadBack(number)}) and tell them someone will call.` });
    });
  },
};

const endSchema = z.object({ reason: z.string().max(100).optional() });

export const endCallTool: ToolDef<typeof endSchema> = {
  name: "end_call",
  description: "Say goodbye and hang up politely, once the caller has what they need. The system records how the call ended.",
  parameters: { type: "object", properties: { reason: { type: "string" } } },
  schema: endSchema,
  async run() {
    return ok({ say: "Say a brief goodbye." }, { endCall: true });
  },
};
