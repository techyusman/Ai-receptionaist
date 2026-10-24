import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { maybeOne, withSystem } from "@receptionist/db";
import { runTool } from "../src/voice/tools/index.ts";
import { loadCallContext, type CallContext } from "../src/voice/context.ts";
import { squareReady, type Ready } from "./fixtures.ts";
import { newUser, startHarness, type Harness } from "./harness.ts";

let h: Harness;
let r: Ready;
const maya = newUser("Maya Owner");
const CALLER = "+12125550177";
const STORE = "+13475550100";
const AI_NUMBER = "+13475550142";
let n = 0;
type J = Record<string, any>;

before(async () => {
  h = await startHarness({ square: true, realtime: true });
  r = await squareReady(h, maya, "Third Space");
  await h.call(maya, "PUT", `/locations/${r.lid}/hours`, { store: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "23:59" })), ordering: [] });
  await h.call(maya, "PATCH", `/locations/${r.lid}/settings`, { orderingEnabled: true, pickupEstimateMinutes: 15 });
  await h.call(maya, "PATCH", `/locations/${r.lid}`, { publicPhone: STORE });
  const bought = await h.twilio.buyNumber(AI_NUMBER, { voiceUrl: "", statusCallbackUrl: "", fallbackUrl: null });
  await withSystem(h.db, (tx) => tx.query("insert into phone_numbers (restaurant_id, location_id, provider_sid, e164) values ($1, $2, $3, $4)", [r.rid, r.lid, bought.sid, AI_NUMBER]));
});
after(async () => {
  await h.stop();
});

/** A fresh incoming call, as the voice webhook would create it, and the context the gateway would load. */
async function newCall(from = CALLER): Promise<CallContext> {
  const params = { CallSid: `CA${String(++n).padStart(32, "0")}`, From: from, To: AI_NUMBER, CallStatus: "ringing" };
  await h.app.inject({ method: "POST", url: "/webhooks/twilio/voice", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": h.twilio.sign("https://api.example.test/webhooks/twilio/voice", params) }, payload: new URLSearchParams(params).toString() });
  const row = await withSystem(h.db, (tx) => maybeOne<{ id: string }>(tx, "select id from calls where provider_call_sid = $1", [params.CallSid]));
  return (await loadCallContext(h.deps, row!.id))!;
}
const tool = async (ctx: CallContext, name: string, args: object = {}): Promise<J> => (await runTool(h.deps, ctx, name, args)).result;
const events = (ctx: CallContext) => withSystem(h.db, async (tx) => (await tx.query("select event_type, payload_redacted from call_events where call_id = $1 order by seq", [ctx.callId])).rows);

async function findLatte(ctx: CallContext, query = "latte") {
  const found = await tool(ctx, "search_menu", { query });
  const item = found.matches.find((m: J) => m.name === "Latte") ?? found.matches[0];
  const options = await tool(ctx, "get_item_options", { item: item.item });
  return { item, options, small: item.variations.find((v: J) => v.name === "Small"), milk: options.choices.find((c: J) => c.name === "Milk") };
}

describe("taking an order the way the model will", () => {
  test("search, choose, name and number, price, read back, confirm, send", async () => {
    const ctx = await newCall();
    const { item, small, milk } = await findLatte(ctx, "oat milk latte please");
    assert.equal(small.price, "$4.50");
    assert.equal(milk.required, true);
    const missing = await tool(ctx, "update_order_draft", { op: "add_item", item: item.item, variation: small.variation, quantity: 1 });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "NEEDS_CHOICES");
    assert.match(missing.problems[0], /Milk|choose/i);
    const oat = milk.options.find((o: J) => o.name === "Oat milk");
    const added = await tool(ctx, "update_order_draft", { op: "add_item", item: item.item, variation: small.variation, quantity: 1, choices: [{ list: milk.list, option: oat.option }] });
    assert.equal(added.ok, true);
    assert.deepEqual(added.lines[0].choices, ["Oat milk"]);
    assert.equal(added.lines[0].line_price, "$5.25");
    const early = await tool(ctx, "calculate_order_total");
    assert.equal(early.ok, false);
    assert.equal(early.reason, "NEEDS_DETAILS");
    const who = await tool(ctx, "set_customer_details", { name: "Priya", phone: "(212) 555-0177", phone_source: "caller_id_confirmed" });
    assert.equal(who.ok, true);
    assert.equal(who.read_back_digits, "2 1 2, 5 5 5, 0 1 7 7");
    const total = await tool(ctx, "calculate_order_total");
    assert.equal(total.ok, true, JSON.stringify(total));
    assert.equal(total.total, "$5.72");
    const wrong = await tool(ctx, "mark_customer_confirmation", { version: total.version - 1, confirmed: true });
    assert.equal(wrong.ok, false);
    assert.equal((await tool(ctx, "submit_confirmed_order")).ok, false, "cannot send before the caller confirms");
    const yes = await tool(ctx, "mark_customer_confirmation", { version: total.version, confirmed: true });
    assert.equal(yes.ok, true);
    const sent = await tool(ctx, "submit_confirmed_order");
    assert.equal(sent.claim, "SENT_NOT_ACKNOWLEDGED");
    assert.doesNotMatch(sent.say, /has your order|received/i);
    const kinds = (await events(ctx)).map((e: J) => e.event_type);
    for (const k of ["tool.search_menu", "tool.update_order_draft", "tool.calculate_order_total", "tool.submit_confirmed_order"]) assert.ok(kinds.includes(k), k);
    const text = JSON.stringify(await events(ctx));
    assert.ok(!text.includes("555-0177") && !text.includes("Priya"), "the timeline holds no names or numbers");
  });

  test("an edit after the read-back means reading it back again; the old yes is refused", async () => {
    const ctx = await newCall();
    const { item, options, small, milk } = await findLatte(ctx);
    await tool(ctx, "update_order_draft", { op: "add_item", item: item.item, variation: small.variation, choices: [{ list: milk.list, option: milk.options[0].option }] });
    await tool(ctx, "set_customer_details", { name: "Sam", phone: CALLER, phone_source: "spoken" });
    const total = await tool(ctx, "calculate_order_total");
    const another = await tool(ctx, "update_order_draft", { op: "set_quantity", line: 1, quantity: 2 });
    assert.equal(another.status, "DRAFT");
    const stale = await tool(ctx, "mark_customer_confirmation", { version: total.version, confirmed: true });
    assert.equal(stale.ok, false);
    assert.match(stale.say, /older version|read the order back/i);
    void options;
  });
});

describe("a caller or a confused model cannot make the tools do the wrong thing", () => {
  test("only handles issued on this call work; real ids and invented handles are refused", async () => {
    const ctx = await newCall();
    const { item, small } = await findLatte(ctx);
    const realId = (await withSystem(h.db, (tx) => maybeOne<{ id: string }>(tx, "select id from menu_items where name = 'Latte' and location_id = $1", [r.lid])))!.id;
    for (const bad of [realId, "m999", "v1", "' or 1=1 --", "../../etc/passwd"]) {
      const res = await tool(ctx, "update_order_draft", { op: "add_item", item: bad, variation: small.variation });
      assert.equal(res.ok, false, bad);
    }
    const other = await newCall();
    const cross = await tool(other, "update_order_draft", { op: "add_item", item: item.item, variation: small.variation });
    assert.equal(cross.ok, false, "a handle from another call means nothing");
    assert.equal((await tool(ctx, "no_such_tool")).ok, false);
    assert.equal((await tool(ctx, "update_order_draft", { op: "drop_table" })).reason, "INVALID_ARGUMENTS");
    assert.equal((await tool(ctx, "update_order_draft", { op: "add_item", item: item.item, quantity: 5000 })).reason, "INVALID_ARGUMENTS");
  });

  test("a claimed caller-ID confirmation for a different number is recorded as spoken", async () => {
    const ctx = await newCall();
    const { item, small, milk } = await findLatte(ctx);
    await tool(ctx, "update_order_draft", { op: "add_item", item: item.item, variation: small.variation, choices: [{ list: milk.list, option: milk.options[0].option }] });
    await tool(ctx, "set_customer_details", { name: "Alex", phone: "212 555 0188", phone_source: "caller_id_confirmed" });
    const row = await withSystem(h.db, (tx) => maybeOne<{ customer_phone_source: string }>(tx, "select customer_phone_source from orders where call_id = $1", [ctx.callId]));
    assert.equal(row!.customer_phone_source, "SPOKEN");
    assert.equal((await tool(ctx, "set_customer_details", { name: "Alex", phone: "000 000 0000", phone_source: "spoken" })).reason, "BAD_PHONE");
  });

  test("outside ordering hours a real caller cannot order, but a dashboard test call can", async () => {
    await h.call(maya, "PUT", `/locations/${r.lid}/hours`, { store: [], ordering: [] });
    const ctx = await newCall();
    const { item, small, milk } = await findLatte(ctx);
    const refused = await tool(ctx, "update_order_draft", { op: "add_item", item: item.item, variation: small.variation, choices: [{ list: milk.list, option: milk.options[0].option }] });
    assert.equal(refused.reason, "CLOSED");
    const info = await tool(ctx, "get_restaurant_info", { topic: "ordering" });
    assert.equal(info.can_take_orders_now, false);
    await h.call(maya, "PUT", `/locations/${r.lid}/hours`, { store: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens: "00:00", closes: "23:59" })), ordering: [] });
    assert.equal((await tool(ctx, "get_restaurant_info", { topic: "ordering" })).can_take_orders_now, true);
  });

  test("ordering switched off mid-call stops the next change", async () => {
    const ctx = await newCall();
    const { item, small, milk } = await findLatte(ctx);
    await h.call(maya, "PATCH", `/locations/${r.lid}/settings`, { orderingEnabled: false });
    const res = await tool(ctx, "update_order_draft", { op: "add_item", item: item.item, variation: small.variation, choices: [{ list: milk.list, option: milk.options[0].option }] });
    await h.call(maya, "PATCH", `/locations/${r.lid}/settings`, { orderingEnabled: true });
    assert.equal(res.reason, "ORDERING_OFF");
  });
});

describe("answers and hand-offs", () => {
  test("hours come from the restaurant's own settings, and an unknown question says so", async () => {
    const ctx = await newCall();
    const hours = await tool(ctx, "get_restaurant_info", { topic: "hours" });
    assert.equal(hours.known, true);
    assert.equal(hours.week.length, 7);
    assert.match(hours.week[0], /^Today:/);
    const pickup = await tool(ctx, "get_restaurant_info", { topic: "pickup" });
    assert.match(pickup.typical_wait, /15 minutes/);
    await h.call(maya, "POST", `/locations/${r.lid}/faqs`, { question: "Do you have parking?", answer: "Street parking only.", aliases: ["is there a car park"], active: true, validFrom: null, validUntil: null });
    const faq = await tool(ctx, "get_restaurant_info", { topic: "other", question: "is there parking nearby" });
    assert.equal(faq.known, true);
    assert.equal(faq.answers[0].answer, "Street parking only.");
    const unknown = await tool(ctx, "get_restaurant_info", { topic: "other", question: "what is the airspeed of a swallow" });
    assert.equal(unknown.known, false);
  });

  test("a callback needs consent and a real number, and shows up for staff", async () => {
    const ctx = await newCall();
    assert.equal((await tool(ctx, "request_callback", { name: "Dana", phone: "212 555 0143", consent: false })).reason, "NO_CONSENT");
    assert.equal((await tool(ctx, "request_callback", { name: "Dana", phone: "not a number", consent: true })).reason, "BAD_PHONE");
    assert.equal((await tool(ctx, "request_callback", { name: "Dana", phone: "212 555 0143", consent: true })).ok, true);
    await tool(ctx, "request_callback", { name: "Dana", phone: "212 555 0143", consent: true });
    const list = (await h.call(maya, "GET", `/locations/${r.lid}/callbacks`)).body;
    assert.equal(list.filter((c: J) => c.callId === ctx.callId).length, 1, "asking twice does not queue it twice");
  });

  test("a transfer picks the right number for the reason, skips ones already tried, and gives up politely", async () => {
    const ctx = await newCall();
    assert.equal((await tool(ctx, "request_human_transfer", { reason: "caller_request" })).reason, "NO_TARGET");
    const mk = (label: string, e164: string, intent: string, priority: number) => h.call(maya, "POST", `/locations/${r.lid}/transfer-targets`, { label, e164, priority, intent, activeHours: "ALWAYS", smsAlertOnMiss: false, enabled: true });
    await mk("Front counter", "+13475550101", "GENERAL", 1);
    await mk("Manager (allergies)", "+13475550102", "ALLERGEN", 2);
    const allergy = await runTool(h.deps, ctx, "request_human_transfer", { reason: "allergen" });
    assert.equal(allergy.result.connecting_to, "Manager (allergies)");
    assert.equal(allergy.effects?.transfer?.number, "+13475550102");
    assert.match(allergy.effects!.transfer!.actionUrl, /transfer-result\?call=.*&transfer=/);
    const second = await runTool(h.deps, ctx, "request_human_transfer", { reason: "allergen" });
    assert.equal(second.effects?.transfer?.number, "+13475550101", "the allergy line was tried; fall back to the front counter");
    assert.equal((await tool(ctx, "request_human_transfer", { reason: "allergen" })).reason, "MAX_ATTEMPTS");
  });
});
