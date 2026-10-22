import { OrderRuleError, confirm, formatMoney, needsClarification, readyForConfirmation, type Order } from "@receptionist/domain";
import { withSystem } from "@receptionist/db";
import { z } from "zod";
import { loadMenu } from "../../menu/read.ts";
import { revalidate } from "../../orders/revalidate.ts";
import { transition } from "../../orders/service.ts";
import { priceOrder } from "../../pos/pricing.ts";
import { submitConfirmedOrder } from "../../pos/submit.ts";
import { orderingAvailability } from "../availability.ts";
import { currentOrder, describeOrder, digitsForReadBack } from "./order-support.ts";
import { ok, refuse, type ToolDef, type ToolRun } from "./types.ts";

const emptySchema = z.object({}).strict();
const AI = { actor: "AI" as const };

export const calculateOrderTotal: ToolDef<typeof emptySchema> = {
  name: "calculate_order_total",
  description: "Get the exact total for the order from the restaurant's system. Call it once the order, the name and the phone number are complete. You may only quote the total this returns, and then you must read the whole order back.",
  parameters: { type: "object", properties: {} },
  schema: emptySchema,
  async run(deps, ctx) {
    try {
      // Checks first, in a short transaction; pricing then talks to Square without holding any lock.
      const pre = await withSystem(deps.db, async (tx): Promise<{ stop: ToolRun } | { order: Order }> => {
        const order = await currentOrder(tx, ctx);
        if (!order || order.lines.length === 0) return { stop: refuse("EMPTY", "There's nothing on the order yet.") };
        const menu = await loadMenu(tx, ctx.locationId);
        const avail = await orderingAvailability(deps, tx, ctx, menu);
        if (!avail.available) return { stop: refuse(avail.reason, avail.say) };
        const missing = [...(order.customer.name ? [] : ["name"]), ...(order.customer.phone ? [] : ["phone number"])];
        if (missing.length) return { stop: refuse("NEEDS_DETAILS", `I still need the caller's ${missing.join(" and ")} before I can read the order back.`) };
        const check = revalidate(order, menu, ctx.settings.menuStaleMaxAgeSeconds, deps.now());
        if (!check.ok) return { stop: { result: { ok: false, reason: check.reason, problems: check.problems.map((p) => p.message), say: "Tell the caller what's wrong and fix the order." } } };
        return { order };
      });
      if ("stop" in pre) return pre.stop;
      const priced = await priceOrder(deps, pre.order);
      if (!priced.ok) {
        return { result: { ok: false, can_quote_total: false, reason: priced.reason, say: "I can't confirm the total right now. Offer to pass the caller to someone, or take their number for a call back. Do not guess a price." } };
      }
      return await withSystem(deps.db, async (tx) => {
        const ready = await transition(tx, pre.order.id, (o) => readyForConfirmation(o, { ...priced.totals, version: o.version }, 0, { actor: "AI", at: deps.now().toISOString() }), AI);
        return ok({
          ...describeOrder(ctx, ready), total: formatMoney(priced.totals.totalMinor, ctx.currency), subtotal: formatMoney(priced.totals.subtotalMinor, ctx.currency),
          tax: formatMoney(priced.totals.taxMinor, ctx.currency), phone_digits: ready.customer.phone ? digitsForReadBack(ready.customer.phone) : null,
          instruction: "Read every item, the name, the pickup number and the total, then ask if it's all correct. Call mark_customer_confirmation with this version only after a clear yes.",
        });
      });
    } catch (e) {
      if (e instanceof OrderRuleError) return refuse(e.code, e.message);
      throw e;
    }
  },
};

const confirmSchema = z.object({ version: z.number().int().min(1), confirmed: z.boolean() });

export const markCustomerConfirmation: ToolDef<typeof confirmSchema> = {
  name: "mark_customer_confirmation",
  description: "Record the caller's answer to the read-back. Pass the order version you read back. confirmed=true only after a clear yes to the whole order; if they want a change or say no, pass false.",
  parameters: { type: "object", properties: { version: { type: "integer", description: "The version from calculate_order_total." }, confirmed: { type: "boolean" } }, required: ["version", "confirmed"] },
  schema: confirmSchema,
  async run(deps, ctx, a) {
    try {
      return await withSystem(deps.db, async (tx) => {
        const order = await currentOrder(tx, ctx);
        if (!order) return refuse("NO_ORDER", "There's no order to confirm.");
        const at = deps.now().toISOString();
        if (!a.confirmed) {
          const back = await transition(tx, order.id, (o) => needsClarification(o, { actor: "AI", at, reason: "Caller wants a change" }), AI);
          return ok({ status: back.status, say: "Ask what they would like to change, make the change, then calculate the total and read it back again." });
        }
        const done = await transition(tx, order.id, (o) => confirm(o, a.version, { actor: "AI", at }), AI);
        return ok({ status: done.status, version: done.version, say: "Now call submit_confirmed_order." });
      });
    } catch (e) {
      if (e instanceof OrderRuleError) {
        const say = e.code === "STALE_CONFIRMATION" || e.code === "NOT_READ_BACK" ? "That yes was for an older version of the order. Calculate the total and read the order back again." : e.message;
        return refuse(e.code, say);
      }
      throw e;
    }
  },
};

export const submitConfirmedOrderTool: ToolDef<typeof emptySchema> = {
  name: "submit_confirmed_order",
  description: "Send the confirmed order to the restaurant. Only after mark_customer_confirmation succeeded. Tell the caller exactly what 'say' in the result says, and nothing more optimistic.",
  parameters: { type: "object", properties: {} },
  schema: emptySchema,
  async run(deps, ctx) {
    const order = await withSystem(deps.db, (tx) => currentOrder(tx, ctx));
    if (!order) return refuse("NO_ORDER", "There's no order to send.");
    if (order.status !== "CUSTOMER_CONFIRMED" && order.status !== "SUBMISSION_UNKNOWN" && order.status !== "SUBMITTED_TO_POS" && order.status !== "RECEIVED_BY_RESTAURANT" && order.status !== "POS_VISIBILITY_UNVERIFIED") {
      return refuse("NOT_CONFIRMED", "The caller hasn't confirmed this order yet. Read it back and get a clear yes first.");
    }
    const res = await submitConfirmedOrder(deps, order.id);
    return ok({ status: res.order.status, claim: res.claim, say: res.say, ...(res.problems ? { problems: res.problems.map((p) => p.message) } : {}) });
  },
};
