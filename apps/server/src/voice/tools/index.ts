// The twelve things the model can do. Each call is validated, run inside the trusted call context,
// timed, and written to the call's timeline as a short sentence (never the caller's raw words).
import { withSystem } from "@receptionist/db";
import { addEvent } from "../../calls/service.ts";
import type { Deps } from "../../deps.ts";
import type { CallContext } from "../context.ts";
import { requestCallback, endCallTool } from "./callback.ts";
import { requestHumanTransfer } from "./handoff.ts";
import { getRestaurantInfo } from "./info.ts";
import { getItemOptions, searchMenuTool } from "./menu.ts";
import { setCustomerDetails, updateOrderDraft, validateOrderDraft } from "./order-edit.ts";
import { calculateOrderTotal, markCustomerConfirmation, submitConfirmedOrderTool } from "./order-finish.ts";
import { refuse, type ToolDef, type ToolRun } from "./types.ts";

export const TOOLS: ToolDef<never>[] = [
  getRestaurantInfo, searchMenuTool, getItemOptions, updateOrderDraft, setCustomerDetails, validateOrderDraft,
  calculateOrderTotal, markCustomerConfirmation, submitConfirmedOrderTool, requestHumanTransfer, requestCallback, endCallTool,
] as unknown as ToolDef<never>[];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** In the shape the Realtime API takes in session.update. */
export function toolDefinitions() {
  return TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }));
}

// One plain sentence per tool for the call timeline. No names, numbers or order contents.
const LOG: Record<string, (a: Record<string, any>, r: Record<string, any>) => string> = {
  get_restaurant_info: (a) => `Looked up ${a.topic === "other" ? "an answer" : a.topic}.`,
  search_menu: (a, r) => `Searched the menu for “${String(a.query).slice(0, 60)}” (${(r.matches as unknown[] | undefined)?.length ?? 0} found).`,
  get_item_options: () => "Looked up an item's choices.",
  update_order_draft: (a, r) => (r.ok ? `Order draft: ${String(a.op).replace("_", " ")}.` : `Order draft change refused (${r.reason}).`),
  set_customer_details: (_a, r) => (r.ok ? "Took the caller's name and number." : `Customer details refused (${r.reason}).`),
  validate_order_draft: () => "Checked the order.",
  calculate_order_total: (_a, r) => (r.ok ? "Priced the order and read it back." : `Could not price the order (${r.reason}).`),
  mark_customer_confirmation: (a, r) => (r.ok ? (a.confirmed ? "The caller confirmed the order." : "The caller wants a change.") : `Confirmation refused (${r.reason}).`),
  submit_confirmed_order: (_a, r) => (r.ok ? `Sent the order (${String(r.claim ?? "").toLowerCase().replace(/_/g, " ")}).` : `Order not sent (${r.reason}).`),
  request_human_transfer: (a, r) => (r.ok ? `Asked for a person (${a.reason}).` : `No one to transfer to (${r.reason}).`),
  request_callback: (_a, r) => (r.ok ? "Took a callback request." : `Callback refused (${r.reason}).`),
  end_call: () => "The AI said goodbye.",
};

export async function runTool(deps: Deps, ctx: CallContext, name: string, raw: unknown): Promise<ToolRun> {
  const tool = byName.get(name);
  if (!tool) return refuse("UNKNOWN_TOOL", "That isn't something I can do.");
  let args: unknown = raw;
  if (typeof raw === "string") {
    try {
      args = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      return refuse("INVALID_ARGUMENTS", "I couldn't read that request. Try again.");
    }
  }
  const parsed = (tool.schema as import("zod").ZodType).safeParse(args ?? {});
  if (!parsed.success) return refuse("INVALID_ARGUMENTS", parsed.error.issues[0]?.message ?? "Those details aren't valid.", { field: String(parsed.error.issues[0]?.path[0] ?? "") });
  const started = Date.now();
  let run: ToolRun;
  try {
    run = await (tool as ToolDef<import("zod").ZodType>).run(deps, ctx, parsed.data);
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "tool failed", tool: name, callId: ctx.callId, err: (e as Error).message }));
    run = refuse("TOOL_ERROR", "Something went wrong on my side. Offer to pass the caller to a person, or take a number for a call back.");
  }
  const ms = Date.now() - started;
  const describe = LOG[name];
  const note = describe ? describe(parsed.data as Record<string, any>, run.result) : name;
  await withSystem(deps.db, (tx) => addEvent(tx, ctx.callId, ctx.restaurantId, `tool.${name}`, "AI", note, { ms })).catch(() => undefined);
  return { ...run, note };
}
