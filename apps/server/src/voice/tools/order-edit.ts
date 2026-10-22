import { OrderRuleError, toOrderLine, validateSelection, type DraftChange } from "@receptionist/domain";
import { withSystem } from "@receptionist/db";
import parsePhone from "libphonenumber-js";
import { z } from "zod";
import { loadMenu } from "../../menu/read.ts";
import { revalidate } from "../../orders/revalidate.ts";
import { updateDraft } from "../../orders/service.ts";
import { orderingAvailability } from "../availability.ts";
import { currentOrder, describeOrder, digitsForReadBack, selectionFrom, startOrder } from "./order-support.ts";
import { ok, refuse, type ToolDef } from "./types.ts";

const choice = z.object({ list: z.string().max(20), option: z.string().max(20), quantity: z.number().int().min(1).max(20).optional(), parent_option: z.string().max(20).optional() });
const editSchema = z.object({
  op: z.enum(["add_item", "remove_line", "set_quantity", "set_choices", "set_line_note", "set_order_note"]),
  item: z.string().max(20).optional(), variation: z.string().max(20).optional(), choices: z.array(choice).max(30).optional(),
  quantity: z.number().int().min(1).max(99).optional(), line: z.number().int().min(1).max(100).optional(), note: z.string().trim().max(200).optional(),
  expected_version: z.number().int().min(1).optional(),
});

const choicesJson = {
  type: "array", description: "The caller's choices for this item (milk, bread, add-ons...). One entry per option picked.",
  items: { type: "object", properties: { list: { type: "string", description: "List handle from get_item_options." }, option: { type: "string", description: "Option handle." }, quantity: { type: "integer" }, parent_option: { type: "string", description: "For a nested choice, the handle of the option that opened it." } }, required: ["list", "option"] },
};

export const updateOrderDraft: ToolDef<typeof editSchema> = {
  name: "update_order_draft",
  description: "Add, change or remove things on the caller's order. Pass expected_version (from the last result) so a repeated call can't apply twice. This only edits the draft; nothing is sent to the kitchen.",
  parameters: {
    type: "object",
    properties: {
      op: { type: "string", enum: ["add_item", "remove_line", "set_quantity", "set_choices", "set_line_note", "set_order_note"] },
      item: { type: "string", description: "Item handle from search_menu (add_item)." },
      variation: { type: "string", description: "Size/variation handle (add_item), required when the item has several." },
      choices: choicesJson,
      quantity: { type: "integer", description: "How many (add_item, set_quantity)." },
      line: { type: "integer", description: "Line number on the order (remove_line, set_quantity, set_choices, set_line_note)." },
      note: { type: "string", description: "A short note, for set_line_note or set_order_note." },
      expected_version: { type: "integer", description: "The order version from the last tool result." },
    },
    required: ["op"],
  },
  schema: editSchema,
  async run(deps, ctx, a) {
    try {
      return await withSystem(deps.db, async (tx) => {
        const menu = await loadMenu(tx, ctx.locationId);
        if (a.op !== "remove_line") {
          const avail = await orderingAvailability(deps, tx, ctx, menu);
          if (!avail.available) return refuse(avail.reason, avail.say);
        }
        const order = (await currentOrder(tx, ctx)) ?? (a.op === "add_item" ? await startOrder(tx, ctx) : null);
        if (!order) return refuse("NO_ORDER", "There's no order yet. Add an item first.");
        const who = { actor: "AI" as const };
        let change: DraftChange;
        if (a.op === "add_item" || a.op === "set_choices") {
          const line = a.op === "set_choices" ? order.lines.find((l) => l.lineNo === a.line) : null;
          if (a.op === "set_choices" && !line) return refuse("NO_SUCH_LINE", "There's no such line on the order.");
          const itemId = line ? line.itemId : ctx.handles.resolve("m", a.item);
          const variationId = line ? line.variationId : a.variation ? ctx.handles.resolve("v", a.variation) : null;
          if (!itemId || (a.variation && !variationId)) return refuse("UNKNOWN_ITEM", "I don't recognise that item or size. Search the menu again.");
          const sel = selectionFrom(ctx, { itemId, ...(variationId ? { variationId } : {}), quantity: line ? line.quantity : (a.quantity ?? 1) }, a.choices);
          if ("error" in sel) return refuse("UNKNOWN_CHOICE", sel.error);
          const problems = validateSelection(menu, sel, deps.now());
          if (problems.length) return { result: { ok: false, reason: "NEEDS_CHOICES", problems: problems.map((p) => p.message), say: "Ask the caller about the missing or invalid choice, then try again." } };
          const built = toOrderLine(menu, sel);
          change = line ? { op: "modifiers", lineNo: line.lineNo, modifiers: built.modifiers, unitPriceMinor: built.unitPriceMinor } : { op: "add", line: built };
        } else if (a.op === "remove_line") {
          if (!a.line) return refuse("NO_SUCH_LINE", "Which line should I remove?");
          change = { op: "remove", lineNo: a.line };
        } else if (a.op === "set_quantity") {
          if (!a.line || !a.quantity) return refuse("NEEDS_ARGS", "I need the line and the new quantity.");
          change = { op: "quantity", lineNo: a.line, quantity: a.quantity };
        } else if (a.op === "set_line_note") {
          if (!a.line) return refuse("NO_SUCH_LINE", "Which line is the note for?");
          change = { op: "line-note", lineNo: a.line, note: a.note || undefined };
        } else {
          if (!ctx.settings.pickupNotesEnabled) return refuse("NOTES_OFF", "I can't add notes to orders.");
          change = { op: "note", note: a.note || undefined };
        }
        const updated = await updateDraft(tx, order.id, change, who, a.expected_version);
        return ok({ ...describeOrder(ctx, updated), remind: "Do not quote a total until calculate_order_total has run." });
      });
    } catch (e) {
      if (e instanceof OrderRuleError) return refuse(e.code, e.code === "VERSION_CONFLICT" ? "That change was already made or the order moved on. Check the order again with validate_order_draft." : e.message);
      throw e;
    }
  },
};

const customerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(25),
  phone_source: z.enum(["caller_id_confirmed", "spoken"]),
  expected_version: z.number().int().min(1).optional(),
});

export const setCustomerDetails: ToolDef<typeof customerSchema> = {
  name: "set_customer_details",
  description: "Save the caller's name and the phone number for the order. If the caller confirmed the number they are calling from, use phone_source 'caller_id_confirmed' and pass that number; otherwise 'spoken'. Read the returned digits back and ask them to confirm.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name for the order." },
      phone: { type: "string", description: "The phone number, any format." },
      phone_source: { type: "string", enum: ["caller_id_confirmed", "spoken"] },
      expected_version: { type: "integer" },
    },
    required: ["name", "phone", "phone_source"],
  },
  schema: customerSchema,
  async run(deps, ctx, a) {
    const parsed = parsePhone(a.phone, "US");
    if (!parsed?.isValid()) return refuse("BAD_PHONE", "That doesn't sound like a full phone number. Ask the caller to say it again, digit by digit.");
    // "Confirmed caller ID" is only believed if it really is the number they called from.
    const source = a.phone_source === "caller_id_confirmed" && ctx.fromE164 && parsed.number === ctx.fromE164 ? "CALLER_ID_CONFIRMED" : "SPOKEN";
    try {
      return await withSystem(deps.db, async (tx) => {
        const order = await currentOrder(tx, ctx);
        if (!order) return refuse("NO_ORDER", "Start the order first, then take their details.");
        const updated = await updateDraft(tx, order.id, { op: "customer", customer: { name: a.name, phone: parsed.number, phoneSource: source } }, { actor: "AI" }, a.expected_version);
        return ok({ ...describeOrder(ctx, updated), read_back_digits: digitsForReadBack(parsed.number), instruction: "Read the number back digit by digit and wait for a yes." });
      });
    } catch (e) {
      if (e instanceof OrderRuleError) return refuse(e.code, e.message);
      throw e;
    }
  },
};

const emptySchema = z.object({}).strict();

export const validateOrderDraft: ToolDef<typeof emptySchema> = {
  name: "validate_order_draft",
  description: "Check the order against the live menu and say what is missing before it can be read back: required choices, unavailable items, the caller's name and number.",
  parameters: { type: "object", properties: {} },
  schema: emptySchema,
  async run(deps, ctx) {
    return withSystem(deps.db, async (tx) => {
      const order = await currentOrder(tx, ctx);
      if (!order) return ok({ has_order: false, say: "There is no order yet." });
      const menu = await loadMenu(tx, ctx.locationId);
      const check = revalidate(order, menu, ctx.settings.menuStaleMaxAgeSeconds, deps.now());
      const missing = [...(order.customer.name ? [] : ["name"]), ...(order.customer.phone ? [] : ["phone number"])];
      return ok({
        ...describeOrder(ctx, order), can_read_back: check.ok && missing.length === 0 && order.lines.length > 0,
        problems: check.ok ? [] : check.problems.map((p) => p.message), still_needed: missing, ...(order.lines.length === 0 ? { empty: true } : {}),
      });
    });
  },
};
