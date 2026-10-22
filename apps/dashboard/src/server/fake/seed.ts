import "server-only";
import {
  accept,
  abandon,
  applyChange,
  confirm,
  createDraft,
  localClock,
  readyForConfirmation,
  startSubmission,
  submissionSucceeded,
  subtotal,
  taxOn,
  toOrderLine,
  transferToStaff,
  formatMoney,
  type Menu,
  type ModifierList,
  type Order,
  type Result,
  type Selection,
} from "@receptionist/domain";
import type { CallDetail, CallEvent, CallOutcome, Faq } from "@/data/types";
import type { State, StoredEvent } from "./store";

// Sample data for the fake data layer. Every name, number and address is invented; 555-01xx
// numbers are reserved for fiction.

const REST = "rest_third_space";
const LOC = "loc_main";
const TZ = "America/New_York";
const TAX = 8.875;

export const SEED_IDS = { restaurant: REST, location: LOC, owner: "user_maya", manager: "user_jordan", staff: "user_sam" };

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let counter = 0;
const id = (prefix: string) => `${prefix}_${(++counter).toString(36).padStart(4, "0")}`;

/* Menu --------------------------------------------------------------------- */

const opt = (id: string, name: string, priceMinor = 0, extra: Partial<ModifierList["options"][number]> = {}) => ({
  id, name, priceMinor, soldOut: false, deleted: false, onByDefault: false, childListIds: [] as string[], ...extra,
});

function buildMenu(syncedAt: string): Menu {
  const lists: Record<string, ModifierList> = {
    list_milk: {
      id: "list_milk", name: "Milk", selectionType: "SINGLE", min: 1, max: 1, deleted: false,
      options: [opt("opt_whole", "Whole milk"), opt("opt_oat", "Oat milk", 75), opt("opt_almond", "Almond milk", 75), opt("opt_skim", "Skim milk")],
    },
    list_extras: {
      id: "list_extras", name: "Extras", selectionType: "MULTIPLE", min: 0, max: 3, deleted: false,
      options: [opt("opt_shot", "Extra shot", 100), opt("opt_vanilla", "Vanilla syrup", 60), opt("opt_caramel", "Caramel syrup", 60)],
    },
    list_temp: {
      id: "list_temp", name: "Temperature", selectionType: "SINGLE", min: 0, max: 1, deleted: false,
      options: [opt("opt_hot", "Hot"), opt("opt_iced", "Iced")],
    },
    list_bread: {
      id: "list_bread", name: "Bread", selectionType: "SINGLE", min: 1, max: 1, deleted: false,
      options: [opt("opt_sourdough", "Sourdough"), opt("opt_croissant", "Croissant", 150), opt("opt_gf", "Gluten-free bread", 200)],
    },
    list_egg: {
      id: "list_egg", name: "Egg", selectionType: "SINGLE", min: 0, max: 1, deleted: false,
      options: [opt("opt_fried", "Fried egg"), opt("opt_scrambled", "Scrambled egg"), opt("opt_noegg", "No egg")],
    },
    list_addons: {
      id: "list_addons", name: "Add-ons", selectionType: "MULTIPLE", min: 0, max: 3, deleted: false,
      options: [
        opt("opt_bacon", "Bacon", 200),
        opt("opt_avocado", "Avocado", 150, { childListIds: ["list_avocado_style"] }),
        opt("opt_cheddar", "Cheddar"),
      ],
    },
    list_avocado_style: {
      id: "list_avocado_style", name: "Avocado style", selectionType: "SINGLE", min: 1, max: 1, deleted: false,
      options: [opt("opt_sliced", "Sliced"), opt("opt_smashed", "Smashed")],
    },
  };
  const link = (listId: string, enabled = true) => ({ listId, enabled, minOverride: null, maxOverride: null });
  const v = (id: string, name: string, priceMinor: number, soldOut = false) => ({
    id, name, priceMinor, pricingType: "FIXED_PRICING" as const, soldOut, deleted: false,
  });
  const item = (
    id: string, name: string, categoryId: string, variations: ReturnType<typeof v>[], lists: string[],
    extra: Partial<Menu["items"][number]> = {},
  ) => ({
    id, name, categoryId, description: null, variations, lists: lists.map((l) => link(l)),
    aiHidden: false, aiUnavailableUntil: null, deleted: false, aliases: [] as string[], ...extra,
  });
  return {
    currency: "USD",
    syncedAt,
    categories: [
      { id: "cat_coffee", name: "Coffee", ordinal: 0 },
      { id: "cat_tea", name: "Tea", ordinal: 1 },
      { id: "cat_food", name: "Breakfast & lunch", ordinal: 2 },
      { id: "cat_bakery", name: "Bakery", ordinal: 3 },
    ],
    lists,
    items: [
      item("item_latte", "Latte", "cat_coffee", [v("var_latte_s", "Small", 450), v("var_latte_l", "Large", 550)], ["list_milk", "list_extras", "list_temp"],
        { description: "Double espresso with steamed milk.", aliases: ["cafe latte"] }),
      item("item_cappuccino", "Cappuccino", "cat_coffee", [v("var_capp", "Regular", 475)], ["list_milk", "list_extras"],
        { description: "Equal parts espresso, milk and foam." }),
      item("item_coldbrew", "Cold Brew", "cat_coffee", [v("var_cb_r", "Regular", 500), v("var_cb_l", "Large", 600)], ["list_extras"],
        { description: "Steeped for 18 hours, served over ice.", aliases: ["iced coffee"] }),
      item("item_drip", "Drip Coffee", "cat_coffee", [v("var_drip_s", "Small", 300), v("var_drip_l", "Large", 375)], [],
        { description: "House blend, refilled all morning.", aliases: ["coffee", "regular coffee", "house coffee"] }),
      item("item_matcha", "Matcha Latte", "cat_tea", [v("var_matcha", "Regular", 575)], ["list_milk", "list_temp"],
        { description: "Ceremonial-grade matcha with milk.", aliases: ["green tea latte"] }),
      item("item_chai", "Chai Latte", "cat_tea", [v("var_chai", "Regular", 525)], ["list_milk", "list_temp"],
        { description: "House-spiced chai concentrate." }),
      item("item_sandwich", "Breakfast Sandwich", "cat_food", [v("var_sand", "Regular", 900)], ["list_bread", "list_egg", "list_addons"],
        { description: "Egg and cheddar on your choice of bread.", aliases: ["egg sandwich", "breakfast sando"] }),
      item("item_toast", "Avocado Toast", "cat_food", [v("var_toast", "Regular", 1100)], ["list_bread"],
        { description: "Smashed avocado, chili flakes and lemon on toast." }),
      item("item_croissant", "Almond Croissant", "cat_bakery", [v("var_almond", "Each", 450)], [],
        { description: "Twice-baked with almond cream. Contains nuts." }),
      item("item_pumpkin", "Pumpkin Loaf", "cat_bakery", [v("var_pumpkin", "Slice", 400, true)], [],
        { description: "Seasonal. Sold out today." }),
      item("item_cider", "Spiced Cider", "cat_tea", [v("var_cider", "Regular", 450)], [],
        { description: "Seasonal hot cider.", aiUnavailableUntil: null }),
      item("item_staff", "Staff Special", "cat_food", [v("var_staff", "Regular", 300)], [],
        { description: "Not for sale to the public.", aiHidden: true }),
      item("item_bagel", "Everything Bagel", "cat_bakery", [v("var_bagel", "Each", 350)], [],
        { description: "Discontinued in Square.", deleted: true }),
    ],
  };
}

/* Orders built with the real state machine ---------------------------------- */

type Built = { order: Order; events: StoredEvent[] };

function buildOrder(
  menu: Menu,
  sels: Selection[],
  at: Date,
  opts: { callId: string | null; customer: { name: string; phone: string }; end: "received" | "submitted" | "abandoned" | "transferred"; staffId: string },
): Built {
  const t = (sec: number) => new Date(at.getTime() + sec * 1000).toISOString();
  const events: StoredEvent[] = [];
  const take = (r: Result, actorUserId: string | null = null) => {
    events.push(...r.events.map((e) => ({ ...e, actorUserId })));
    return r.order;
  };
  let o = take(createDraft({
    id: id("ord"), locationId: LOC, callId: opts.callId, isTest: false, posMode: "DASHBOARD_TICKET",
    currency: "USD", idempotencyKey: crypto.randomUUID(), ctx: { actor: "AI", at: t(0) },
  }));
  sels.forEach((sel, i) => {
    o = take(applyChange(o, { op: "add", line: toOrderLine(menu, sel) }, { actor: "AI", at: t(15 + i * 20) }));
  });
  if (opts.end === "abandoned") return { order: take(abandon(o, { actor: "SYSTEM", at: t(80), reason: "Caller hung up" })), events };
  if (opts.end === "transferred") return { order: take(transferToStaff(o, { actor: "AI", at: t(80), reason: "Caller asked for a person" })), events };
  o = take(applyChange(o, { op: "customer", customer: { name: opts.customer.name, phone: opts.customer.phone, phoneSource: "CALLER_ID_CONFIRMED" } }, { actor: "AI", at: t(60) }));
  const sub = subtotal(o);
  const tax = taxOn(sub, TAX);
  o = take(readyForConfirmation(o, { subtotalMinor: sub, taxMinor: tax, totalMinor: sub + tax, version: o.version, calculatedAt: t(70), source: "SQUARE" }, 0, { actor: "AI", at: t(70) }));
  o = take(confirm(o, o.version, { actor: "AI", at: t(85) }));
  o = take(startSubmission(o, { actor: "SYSTEM", at: t(86) }));
  o = take(submissionSucceeded(o, { actor: "SYSTEM", at: t(87) }));
  if (opts.end === "received") o = take(accept(o, opts.staffId, { actor: "STAFF", at: t(150) }), opts.staffId);
  return { order: o, events };
}

/* Calls -------------------------------------------------------------------- */

const firstNames = ["Ana", "Ben", "Chloe", "Dev", "Elena", "Femi", "Grace", "Hiro", "Isla", "Jon", "Kemi", "Leo", "Mina", "Noah", "Omar", "Pia"];
const lastInitials = "ABCDEFGHJKLMNPRSTW";

const infoSummaries = [
  "Asked about today's hours. Answered from the store hours.",
  "Asked whether there's outdoor seating. Answered from the knowledge base.",
  "Asked if oat milk costs extra. Quoted the menu price.",
  "Asked for the address and where to park. Answered from location details.",
  "Asked whether breakfast is served all day. Answered from the knowledge base.",
  "Asked if dogs are allowed on the patio. Answered from the knowledge base.",
  "Asked whether the Pumpkin Loaf is back. Said it's sold out today.",
];
const transferSummaries = [
  { text: "Asked about catering for 40 people. Transferred to the manager line.", reason: "CATERING" },
  { text: "Asked whether the Almond Croissant is safe with a nut allergy. Transferred to staff.", reason: "ALLERGEN" },
  { text: "Wanted to talk to someone about an earlier order. Transferred to staff.", reason: "CALLER_REQUEST" },
];

const orderMixes: Selection[][] = [
  [{ itemId: "item_latte", variationId: "var_latte_l", quantity: 1, modifiers: [{ listId: "list_milk", optionId: "opt_oat" }] }],
  [
    { itemId: "item_coldbrew", variationId: "var_cb_r", quantity: 2, modifiers: [] },
    { itemId: "item_croissant", quantity: 1, modifiers: [] },
  ],
  [{ itemId: "item_sandwich", quantity: 1, modifiers: [{ listId: "list_bread", optionId: "opt_sourdough" }, { listId: "list_egg", optionId: "opt_fried" }, { listId: "list_addons", optionId: "opt_bacon" }] }],
  [
    { itemId: "item_matcha", quantity: 1, modifiers: [{ listId: "list_milk", optionId: "opt_almond" }, { listId: "list_temp", optionId: "opt_iced" }] },
    { itemId: "item_toast", quantity: 1, modifiers: [{ listId: "list_bread", optionId: "opt_sourdough" }] },
  ],
  [
    { itemId: "item_drip", variationId: "var_drip_l", quantity: 3, modifiers: [] },
    { itemId: "item_sandwich", quantity: 2, modifiers: [
      { listId: "list_bread", optionId: "opt_croissant" },
      { listId: "list_addons", optionId: "opt_avocado" },
      { listId: "list_avocado_style", optionId: "opt_smashed", parentOptionId: "opt_avocado" },
    ] },
  ],
];

function describeLines(o: Order) {
  return o.lines.map((l) => `${l.quantity} × ${l.itemName}`).join(", ");
}

/* Seed ----------------------------------------------------------------------- */

export function seed(now: Date): State {
  counter = 0;
  const rand = rng(42);
  const iso = (d: Date) => d.toISOString();
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const syncedAt = iso(ago(6));
  const menu = buildMenu(syncedAt);
  // 86'd overlay on Spiced Cider until local midnight-ish (12 hours from now is close enough for a seed).
  const cider = menu.items.find((i) => i.id === "item_cider");
  if (cider) cider.aiUnavailableUntil = iso(new Date(now.getTime() + 12 * 3600_000));

  const local = localClock(now, TZ);
  /** A UTC instant for local `hh:mm` on the local date `daysAgo` days back. Ignores a DST change inside the week. */
  const atLocal = (daysAgo: number, hh: number, mm: number) =>
    new Date(now.getTime() - (local.minutes - (hh * 60 + mm)) * 60_000 - daysAgo * 86_400_000);

  const calls: State["calls"] = [];
  const orders: Order[] = [];
  const orderEvents: State["orderEvents"] = {};
  const attempts: State["attempts"] = {};

  const pushOrder = (b: Built) => {
    orders.push(b.order);
    orderEvents[b.order.id] = b.events;
    if (b.order.submissionAttempts > 0) {
      attempts[b.order.id] = [{ attemptNo: 1, startedAt: b.order.submittedAt ?? b.order.updatedAt, outcome: "CREATED", httpStatus: 201, idempotencyKey: b.order.idempotencyKey }];
    }
  };

  const callerPhone = () => `+1212555${String(100 + Math.floor(rand() * 99)).padStart(4, "0")}`;
  const callerName = () => `${firstNames[Math.floor(rand() * firstNames.length)]} ${lastInitials[Math.floor(rand() * lastInitials.length)]}.`;

  const makeCall = (start: Date, outcome: CallOutcome, extra: Partial<CallDetail> = {}): CallDetail & { locationId: string } => {
    const duration = outcome === "CALLER_HUNG_UP" ? 8 + Math.floor(rand() * 30) : 45 + Math.floor(rand() * 180);
    const phone = callerPhone();
    const events: CallEvent[] = [{ at: iso(start), type: "call.started", actor: "SYSTEM", detail: "Call answered by the AI" }];
    return {
      id: id("call"),
      locationId: LOC,
      startedAt: iso(start),
      durationSeconds: duration,
      callerPhone: phone,
      callerName: null,
      outcome,
      status: "ENDED",
      summary: null,
      orderId: null,
      transferred: false,
      isTest: false,
      events,
      transfers: [],
      transcript: null,
      transcriptsEnabled: false,
      ...extra,
    };
  };

  for (let day = 6; day >= 0; day--) {
    const count = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < count; i++) {
      const start = atLocal(day, 7 + Math.floor(rand() * 8), Math.floor(rand() * 60));
      if (start > ago(15)) continue;
      const r = rand();
      const outcome: CallOutcome =
        r < 0.42 ? "INFO_RESOLVED" : r < 0.7 ? "ORDER_SUBMITTED" : r < 0.8 ? "TRANSFERRED" : r < 0.88 ? "CALLER_HUNG_UP" : r < 0.94 ? "CALLBACK_REQUESTED" : "STAFF_ANSWERED";
      const call = makeCall(start, outcome);
      const ev = (sec: number, type: string, actor: CallEvent["actor"], detail: string) =>
        call.events.push({ at: iso(new Date(start.getTime() + sec * 1000)), type, actor, detail });

      if (outcome === "INFO_RESOLVED") {
        const s = infoSummaries[Math.floor(rand() * infoSummaries.length)]!;
        call.summary = s;
        ev(6, "tool.get_restaurant_info", "AI", "Looked up restaurant information");
      } else if (outcome === "ORDER_SUBMITTED") {
        const mix = orderMixes[Math.floor(rand() * orderMixes.length)]!;
        const name = callerName();
        const b = buildOrder(menu, mix, new Date(start.getTime() + 10_000), { callId: call.id, customer: { name, phone: call.callerPhone! }, end: "received", staffId: SEED_IDS.staff });
        pushOrder(b);
        call.orderId = b.order.id;
        call.callerName = name;
        call.summary = `Placed a pickup order: ${describeLines(b.order)}. Read back and confirmed.`;
        ev(10, "tool.search_menu", "AI", `Searched the menu for “${b.order.lines[0]?.itemName.toLowerCase()}”`);
        ev(25, "tool.update_order_draft", "AI", `Added ${describeLines(b.order)}`);
        ev(80, "tool.calculate_order_total", "AI", `Priced the order at ${formatMoney(b.order.totals?.totalMinor ?? 0, "USD")}`);
        ev(95, "tool.mark_customer_confirmation", "AI", `Caller confirmed version ${b.order.confirmedVersion}`);
        ev(97, "tool.submit_confirmed_order", "AI", "Sent to Live orders");
      } else if (outcome === "TRANSFERRED") {
        const s = transferSummaries[Math.floor(rand() * transferSummaries.length)]!;
        call.summary = s.text;
        call.transferred = true;
        ev(20, "handoff.triggered", "AI", `Transfer requested (${s.reason.toLowerCase().replace("_", " ")})`);
        call.transfers.push({ id: id("xfer"), destination: s.reason === "CATERING" ? "+12125550188" : "+12125550142", label: s.reason === "CATERING" ? "Manager" : "Front counter", reason: s.reason, startedAt: iso(new Date(start.getTime() + 22_000)), result: "CONNECTED" });
        ev(30, "transfer.connected", "STAFF", "Staff answered the transfer");
      } else if (outcome === "CALLER_HUNG_UP") {
        if (rand() < 0.5) {
          const b = buildOrder(menu, [orderMixes[0]![0]!], new Date(start.getTime() + 5_000), { callId: call.id, customer: { name: "", phone: "" }, end: "abandoned", staffId: SEED_IDS.staff });
          pushOrder(b);
          call.orderId = b.order.id;
          call.summary = "Hung up while ordering. The draft order was dropped.";
        } else {
          call.summary = "Hung up during the greeting.";
        }
      } else if (outcome === "CALLBACK_REQUESTED") {
        call.summary = "Asked about a large office order. No one picked up the transfer, so the AI took a callback request.";
        call.transferred = true;
        call.transfers.push({ id: id("xfer"), destination: "+12125550188", label: "Manager", reason: "CALLER_REQUEST", startedAt: iso(new Date(start.getTime() + 20_000)), result: "NO_ANSWER" });
        ev(45, "transfer.no_answer", "SYSTEM", "No answer after 25 seconds; back to the AI");
        ev(70, "tool.request_callback", "AI", "Saved a callback request");
      } else {
        call.summary = "Staff picked up before the AI answered.";
        call.events = [{ at: iso(start), type: "call.staff_answered", actor: "STAFF", detail: "Answered by staff (Ring Staff First)" }];
      }
      ev(Math.max(1, (call.durationSeconds ?? 60) - 1), "call.ended", outcome === "CALLER_HUNG_UP" ? "CALLER" : "AI", "Call ended");
      calls.push(call);
    }
  }

  // Two fresh tickets waiting on the Live screen: one just in, one waiting 7 minutes.
  for (const [minutes, mix, name] of [[2, orderMixes[4]!, "Sam Rivera"], [7, orderMixes[3]!, "Priya N."]] as const) {
    const start = ago(minutes + 3);
    const call = makeCall(start, "ORDER_SUBMITTED", { callerName: name });
    const b = buildOrder(menu, [...mix], ago(minutes + 2), { callId: call.id, customer: { name, phone: call.callerPhone! }, end: "submitted", staffId: SEED_IDS.staff });
    pushOrder(b);
    call.orderId = b.order.id;
    call.summary = `Placed a pickup order: ${describeLines(b.order)}. Read back and confirmed.`;
    calls.push(call);
  }

  // One transferred mid-order (catering question), for the "Passed to staff" state.
  {
    const start = ago(95);
    const call = makeCall(start, "TRANSFERRED", { transferred: true, summary: "Started an order, then asked about catering for an event. Transferred to the manager line." });
    const b = buildOrder(menu, [orderMixes[1]![0]!], new Date(start.getTime() + 8_000), { callId: call.id, customer: { name: "", phone: "" }, end: "transferred", staffId: SEED_IDS.staff });
    pushOrder(b);
    call.orderId = b.order.id;
    call.transfers.push({ id: id("xfer"), destination: "+12125550188", label: "Manager", reason: "CATERING", startedAt: iso(new Date(start.getTime() + 60_000)), result: "CONNECTED" });
    calls.push(call);
  }

  calls.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const callbackCall = calls.find((c) => c.outcome === "CALLBACK_REQUESTED");
  const missedTransfer = calls.find((c) => c.transfers.some((t) => t.result === "NO_ANSWER"));

  const faq = (question: string, answer: string, extra: Partial<Faq> = {}): Faq => ({
    id: id("faq"), question, answer, aliases: [], active: true, validFrom: null, validUntil: null,
    source: "MANUAL", reviewed: true, updatedAt: iso(ago(60 * 24 * 3)), ...extra,
  });

  return {
    users: [
      { id: SEED_IDS.owner, email: "owner@thirdspace.test", name: "Maya Chen", lastSeenAt: iso(ago(30)) },
      { id: SEED_IDS.manager, email: "jordan@thirdspace.test", name: "Jordan Ellis", lastSeenAt: iso(ago(60 * 26)) },
      { id: SEED_IDS.staff, email: "sam@thirdspace.test", name: "Sam Ortiz", lastSeenAt: iso(ago(12)) },
    ],
    restaurant: { id: REST, name: "Third Space", slug: "third-space" },
    memberships: [
      { id: "mem_maya", userId: SEED_IDS.owner, restaurantId: REST, locationId: null, role: "OWNER", status: "ACTIVE" },
      { id: "mem_jordan", userId: SEED_IDS.manager, restaurantId: REST, locationId: null, role: "MANAGER", status: "ACTIVE" },
      { id: "mem_sam", userId: SEED_IDS.staff, restaurantId: REST, locationId: LOC, role: "STAFF", status: "ACTIVE" },
    ],
    invitations: [
      { id: id("inv"), email: "riley@thirdspace.test", role: "STAFF", invitedBy: "Maya Chen", expiresAt: iso(new Date(now.getTime() + 5 * 86_400_000)), createdAt: iso(ago(60 * 24 * 2)), locationId: LOC },
    ],
    locations: [
      {
        id: LOC, restaurantId: REST, name: "Main Street", timezone: TZ, currency: "USD", taxRatePercent: TAX,
        address: { line1: "100 Sample Street", city: "Brooklyn", region: "NY", postalCode: "11201", country: "US" },
        directions: "Corner of Sample and Example, across from the park. Pickup shelf is just inside the door on the left.",
        publicPhone: "+12125550142", website: "https://thirdspace.example",
        status: "LIVE", orderingMode: "DASHBOARD_TICKET", feasibility: "FALLBACK_APPROVED",
        feasibilityNote: "Seed data: stands in for Third Space's written approval of the Live orders workflow.",
        feasibilitySignedOffBy: "Maya Chen", feasibilitySignedOffAt: iso(ago(60 * 24 * 5)),
      },
    ],
    settings: {
      [LOC]: {
        greeting: "Thanks for calling Third Space. I'm the café's AI receptionist. How can I help?",
        voice: "warm", primaryLanguage: "en", extraLanguages: [], orderingEnabled: true, pickupNotesEnabled: true,
        scheduledPickupEnabled: false, pickupPolicy: "Pickup orders are usually ready in 10 to 15 minutes. Pay at the counter when you collect.",
        pickupEstimateMinutes: null, afterHoursMode: "TAKE_CALLBACK", ringStaffFirst: false, ringStaffSeconds: 20,
        transferStrategy: "DIRECT", transferTimeoutSeconds: 25, maxTransferAttempts: 2, maxCallSeconds: 900,
        silenceTimeoutSeconds: 12, maxClarificationRetries: 2, menuStaleMaxAgeSeconds: 3600,
        recordingEnabled: false, transcriptEnabled: false, retentionDays: 90, updatedAt: iso(ago(60 * 24)),
      },
    },
    phoneNumbers: { [LOC]: [{ id: id("pn"), e164: "+12125550199", purpose: "AI_INBOUND", enabled: true, fallbackE164: "+12125550142" }] },
    transferTargets: {
      [LOC]: [
        { id: id("tt"), label: "Front counter", e164: "+12125550142", priority: 1, intent: "GENERAL", activeHours: "BUSINESS_HOURS", smsAlertOnMiss: true, enabled: true },
        { id: id("tt"), label: "Manager (Jordan)", e164: "+12125550188", priority: 1, intent: "CATERING", activeHours: "BUSINESS_HOURS", smsAlertOnMiss: true, enabled: true },
      ],
    },
    hours: {
      [LOC]: {
        store: [
          ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "07:00", closes: "16:00" })),
          { weekday: 6, opens: "08:00", closes: "17:00" },
          { weekday: 0, opens: "08:00", closes: "15:00" },
        ],
        ordering: [
          ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "07:00", closes: "15:30" })),
          { weekday: 6, opens: "08:00", closes: "16:30" },
          { weekday: 0, opens: "08:00", closes: "14:30" },
        ],
      },
    },
    specialHours: {
      [LOC]: [
        { id: id("sh"), date: "2026-11-26", closed: true, note: "Thanksgiving" },
        { id: id("sh"), date: "2026-12-24", closed: false, opens: "08:00", closes: "13:00", note: "Christmas Eve, closing early" },
      ],
    },
    notices: { [LOC]: [] },
    faqs: {
      [LOC]: [
        faq("Is there parking?", "There's street parking on Sample Street, metered until 7 pm. The closest garage is on Example Avenue, two blocks north."),
        faq("Do you have outdoor seating?", "Yes, we have six tables on the patio, open when the weather is good."),
        faq("Are dogs allowed?", "Dogs are welcome on the patio. Only service animals inside, please."),
        faq("Do you serve breakfast all day?", "Yes. The breakfast sandwich and avocado toast are available until we close."),
        faq("Do you have Wi-Fi?", "Yes, free Wi-Fi. The password is on the receipt."),
        faq("Do you take reservations?", "We don't take reservations. Seating is first come, first served."),
        faq("Can I pay by phone?", "We don't take payment over the phone. Pay at the counter when you pick up your order.", { aliases: ["pay over the phone"] }),
        faq("Is the pumpkin loaf back?", "The pumpkin loaf is seasonal and sells out most days. Call early in the morning to check.", { validUntil: "2026-11-30T23:59:00Z", source: "TEMPLATE" }),
      ],
    },
    pronunciations: { [LOC]: [{ id: id("pr"), term: "Third Space", spokenAs: "third space" }, { id: id("pr"), term: "matcha", spokenAs: "MAH-chah" }] },
    integrations: {
      [LOC]: {
        provider: "SQUARE", status: "CONNECTED", environment: "SANDBOX", merchantName: "Third Space (Sandbox)",
        posLocationId: "SQ-LOC-SANDBOX-1", posLocationName: "Third Space – Main Street (Sandbox)",
        scopes: ["ITEMS_READ", "ORDERS_READ", "ORDERS_WRITE", "MERCHANT_PROFILE_READ"],
        lastSuccessAt: syncedAt, lastErrorCode: null, lastErrorAt: null, connectedBy: "Maya Chen",
      },
    },
    squareLocations: [
      { id: "SQ-LOC-SANDBOX-1", name: "Third Space – Main Street (Sandbox)", address: "100 Sample Street, Brooklyn" },
      { id: "SQ-LOC-SANDBOX-2", name: "Third Space – Pop-up (Sandbox)", address: "12 Example Avenue, Brooklyn" },
    ],
    menus: { [LOC]: menu },
    menuSync: { [LOC]: { state: "fresh", lastSuccessAt: syncedAt, lastErrorCode: null } },
    calls,
    orders,
    orderEvents,
    attempts,
    callbacks: [
      ...(callbackCall
        ? [{ id: id("cb"), locationId: LOC, callId: callbackCall.id, customerName: "Grace W.", phone: callbackCall.callerPhone ?? "+12125550123", preferredWindow: "Weekday afternoons", reason: "Office order for about 25 people next Friday.", status: "OPEN" as const, createdAt: callbackCall.startedAt, handledBy: null, handledAt: null }]
        : []),
      { id: id("cb"), locationId: LOC, callId: null, customerName: "Leo P.", phone: "+12125550161", preferredWindow: "After 3 pm", reason: "Wants to ask about hosting a book club.", status: "OPEN", createdAt: iso(ago(60 * 20)), handledBy: null, handledAt: null },
      { id: id("cb"), locationId: LOC, callId: null, customerName: "Mina K.", phone: "+12125550170", preferredWindow: null, reason: "Question about gluten-free options.", status: "DONE", createdAt: iso(ago(60 * 50)), handledBy: "Jordan Ellis", handledAt: iso(ago(60 * 46)) },
    ],
    alerts: [
      ...(missedTransfer
        ? [{ id: id("al"), locationId: LOC, kind: "TRANSFER_MISSED" as const, severity: "WARNING" as const, message: "A transfer to Manager wasn't answered. The AI took a callback request instead.", orderId: null, callId: missedTransfer.id, createdAt: missedTransfer.startedAt, acknowledgedAt: null }]
        : []),
    ],
    audit: [
      { id: id("au"), at: iso(ago(60 * 24 * 5)), actorName: "Maya Chen", actorType: "USER", action: "ordering.mode", target: "Main Street", summary: "Switched phone orders to the Live orders screen and recorded the sign-off." },
      { id: id("au"), at: iso(ago(60 * 24 * 6)), actorName: "Maya Chen", actorType: "USER", action: "square.connect", target: "Main Street", summary: "Connected Square (Sandbox) and chose “Third Space – Main Street”." },
      { id: id("au"), at: iso(ago(60 * 24 * 3)), actorName: "Jordan Ellis", actorType: "USER", action: "faqs.create", target: "Knowledge", summary: "Added “Is the pumpkin loaf back?”." },
      { id: id("au"), at: iso(ago(60 * 24)), actorName: "Maya Chen", actorType: "USER", action: "settings.update", target: "AI agent", summary: "Changed the greeting." },
      { id: id("au"), at: iso(ago(60 * 24 * 2)), actorName: "Maya Chen", actorType: "USER", action: "members.invite", target: "riley@thirdspace.test", summary: "Invited Riley as Staff." },
      { id: id("au"), at: iso(ago(6)), actorName: "System", actorType: "SYSTEM", action: "menu.sync", target: "Main Street", summary: "Synced 13 items from Square." },
    ],
  };
}
