// Sample data for local development and demos: one café, three staff, a synced menu, its settings, and a
// month of calls and orders. Every name, number and address is invented (555-01xx numbers are reserved
// for fiction). History goes through the same order and call code as live traffic, then is back-dated.
import { many, maybeOne, one, withSystem, withTenant, type Db, type Tx } from "@receptionist/db";
import { accept, confirm, readyForConfirmation, startSubmission, submissionSucceeded, subtotal, taxOn, toOrderLine, validateSelection, type Menu, type Selection } from "@receptionist/domain";
import type { TokenCipher } from "../crypto.ts";
import { applyCatalog } from "../menu/apply.ts";
import { parseCatalog } from "../menu/parse.ts";
import { loadMenu } from "../menu/read.ts";
import { createOrder, recordAttemptResult, recordAttemptStart, transition, updateDraft } from "../orders/service.ts";
import { devUserId } from "./auth-stub.ts";
import { SAMPLE_SQUARE_LOCATION, thirdSpaceCatalog } from "./third-space-catalog.ts";

export const SEED_PEOPLE = [
  { email: "maya@thirdspace.test", name: "Maya Okafor", role: "OWNER" },
  { email: "jordan@thirdspace.test", name: "Jordan Reyes", role: "MANAGER" },
  { email: "sam@thirdspace.test", name: "Sam Lee", role: "STAFF" },
] as const;

export const SEED_NUMBERS = { publicPhone: "+17185550100", aiNumber: "+17185550142", counter: "+17185550101", owner: "+17185550102" };
const TZ = "America/New_York";
const TAX = 8.875;

const FAQS: [string, string, string[]][] = [
  ["Is there parking nearby?", "There's metered street parking on Main Street and a public lot on Clark Street, two minutes away.", ["where can I park"]],
  ["Do you have Wi-Fi?", "Yes, free Wi-Fi. The network name and password are on the card at the counter.", ["is there internet"]],
  ["Do you have vegan options?", "Yes. Any drink can be made with oat or almond milk, and the avocado toast is vegan on sourdough.", []],
  ["Do you have gluten-free bread?", "Yes, gluten-free bread is available for any sandwich or toast for $2 extra. It's prepared in a shared kitchen.", []],
  ["Can I sit outside?", "We have four tables out front when the weather is good.", ["outdoor seating"]],
  ["Can I bring my dog?", "Dogs are welcome at the outdoor tables. Inside, only service animals, please.", ["are dogs allowed"]],
  ["Can I work on my laptop?", "Of course. There are outlets along the window bar. On weekends we ask laptop users to share tables after an hour.", []],
  ["Do you sell gift cards?", "Yes, at the counter, in any amount from $10.", []],
  ["Do you cater or take large orders?", "We do coffee boxes and pastry platters for groups. Please give us a day's notice; the manager can help with the details.", ["catering"]],
  ["Is there a restroom?", "Yes, one accessible restroom at the back.", []],
  ["Is the café step-free?", "Yes. The front door is level with the sidewalk and the aisles are wide enough for a wheelchair.", ["wheelchair access"]],
  ["Does oat milk cost extra?", "Oat or almond milk is 75 cents extra.", []],
];

async function ensurePeople(tx: Tx): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const p of SEED_PEOPLE) {
    const id = devUserId(p.email);
    await tx.query("insert into users (id, email, display_name, last_seen_at) values ($1, $2, $3, now()) on conflict (id) do nothing", [id, p.email, p.name]);
    ids[p.role] = id;
  }
  return ids;
}

async function setUpCafe(tx: Tx, people: Record<string, string>, cipher: TokenCipher, squareTokens: { access: string; refresh: string }) {
  const r = await one<{ id: string }>(tx, "insert into restaurants (name, slug, created_by) values ('Third Space', 'third-space', $1) returning id", [people.OWNER]);
  const l = await one<{ id: string }>(
    tx,
    `insert into locations (restaurant_id, name, timezone, address_line1, city, region, postal_code, country, directions, public_phone_e164, website, status,
                            ordering_mode, pos_feasibility, pos_feasibility_note, pos_feasibility_signed_off_by, pos_feasibility_signed_off_at, estimate_tax_rate_percent)
     values ($1, 'Main Street', $2, '214 Main Street', 'Brooklyn', 'NY', '11201', 'US', 'Across from the library, next to the bike shop. The entrance is on Main Street.',
             $3, 'https://thirdspace.example', 'LIVE', 'DASHBOARD_TICKET', 'FALLBACK_APPROVED',
             'The owner approved taking phone orders on the Live orders screen, by email on 14 Oct 2026.', $4, now() - interval '8 days', $5)
     returning id`,
    [r.id, TZ, SEED_NUMBERS.publicPhone, people.OWNER, TAX],
  );
  const rid = r.id;
  const lid = l.id;
  await tx.query(
    `insert into location_settings (location_id, restaurant_id, greeting, ordering_enabled, pickup_policy, pickup_estimate_minutes, after_hours_mode, transcript_enabled)
     values ($1, $2, 'Thanks for calling Third Space. I''m the café''s AI assistant. How can I help?', true,
             'Pay at the counter when you pick up. Orders are held for 30 minutes.', 15, 'TAKE_CALLBACK', true)`,
    [lid, rid],
  );
  for (const p of SEED_PEOPLE) await tx.query("insert into memberships (restaurant_id, user_id, role) values ($1, $2, $3)", [rid, people[p.role], p.role]);
  for (let wd = 0; wd < 7; wd++) {
    const weekend = wd === 0 || wd === 6;
    await tx.query("insert into business_hours (restaurant_id, location_id, kind, weekday, opens_at, closes_at) values ($1, $2, 'STORE', $3, $4, $5)", [rid, lid, wd, weekend ? "08:00" : "07:00", weekend ? "16:00" : "18:00"]);
  }
  await tx.query("insert into special_hours (restaurant_id, location_id, on_date, closed, note) values ($1, $2, '2026-11-26', true, 'Closed for Thanksgiving')", [rid, lid]);
  await tx.query("insert into special_hours (restaurant_id, location_id, on_date, closed, opens_at, closes_at, note) values ($1, $2, '2026-12-24', false, '08:00', '14:00', 'Christmas Eve: closing early')", [rid, lid]);
  for (const [q, a, aliases] of FAQS) await tx.query("insert into faqs (restaurant_id, location_id, question, answer, question_aliases) values ($1, $2, $3, $4, $5)", [rid, lid, q, a, aliases]);
  await tx.query("insert into pronunciations (restaurant_id, location_id, term, spoken_as) values ($1, $2, 'Matcha', 'MAH-chuh'), ($1, $2, 'Chai', 'chy')", [rid, lid]);
  await tx.query(
    `insert into transfer_targets (restaurant_id, location_id, label, e164, priority, intent, active_hours, sms_alert_on_miss)
     values ($1, $2, 'Front counter', $3, 1, 'GENERAL', 'BUSINESS_HOURS', true), ($1, $2, 'Maya (owner)', $4, 2, 'ALLERGEN', 'ALWAYS', false)`,
    [rid, lid, SEED_NUMBERS.counter, SEED_NUMBERS.owner],
  );
  await tx.query("insert into phone_numbers (restaurant_id, location_id, provider_sid, e164, fallback_e164) values ($1, $2, 'PN00000000000000000000000000000001', $3, $4)", [rid, lid, SEED_NUMBERS.aiNumber, SEED_NUMBERS.publicPhone]);
  const integ = await one<{ id: string }>(
    tx,
    `insert into pos_integrations (restaurant_id, location_id, environment, merchant_id, merchant_name, pos_location_id, pos_location_name, status, scopes, connected_by)
     values ($1, $2, 'SANDBOX', 'MSAMPLE', 'Third Space', $3, 'Third Space - Main Street', 'DISCONNECTED', '{MERCHANT_PROFILE_READ,ITEMS_READ,ORDERS_READ,ORDERS_WRITE}', $4) returning id`,
    [rid, lid, SAMPLE_SQUARE_LOCATION, people.OWNER],
  );
  await tx.query(
    `update pos_integrations set access_token_ct = $2, refresh_token_ct = $3, key_version = $4, token_expires_at = now() + interval '30 days', status = 'CONNECTED', last_success_at = now()
      where id = $1`,
    [integ.id, cipher.encrypt(squareTokens.access, `${integ.id}:access`), cipher.encrypt(squareTokens.refresh, `${integ.id}:refresh`), cipher.version],
  );
  await applyCatalog(tx, { restaurantId: rid, locationId: lid, parsed: parseCatalog(thirdSpaceCatalog(), SAMPLE_SQUARE_LOCATION, "USD"), full: true, at: new Date() });
  await tx.query("insert into catalog_syncs (restaurant_id, location_id, kind, trigger, status, finished_at, objects_upserted, catalog_high_water) values ($1, $2, 'FULL', 'CONNECT', 'SUCCEEDED', now(), 60, now())", [rid, lid]);
  const items = await many<{ id: string; name: string }>(tx, "select id, name from menu_items where location_id = $1", [lid]);
  const byName = new Map(items.map((i) => [i.name, i.id]));
  for (const [phrase, item] of [["iced coffee", "Cold Brew"], ["green tea latte", "Matcha Latte"], ["egg sandwich", "Breakfast Sandwich"]] as const) {
    await tx.query("insert into menu_aliases (restaurant_id, location_id, item_id, phrase, created_by) values ($1, $2, $3, $4, $5)", [rid, lid, byName.get(item), phrase, people.MANAGER]);
  }
  return { rid, lid };
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pick = [item: string, variation: string, choices?: Record<string, string[]>, qty?: number];
const MIXES: Pick[][] = [
  [["Latte", "Large", { Milk: ["Oat milk"] }], ["Almond Croissant", "Each"]],
  [["Cold Brew", "Regular"], ["Breakfast Sandwich", "Regular", { Bread: ["Sourdough"], Egg: ["Fried egg"] }]],
  [["Cappuccino", "Regular", { Milk: ["Whole milk"] }, 2]],
  [["Matcha Latte", "Regular", { Milk: ["Almond milk"], Temperature: ["Iced"] }], ["Avocado Toast", "Regular", { Bread: ["Sourdough"] }]],
  [["Drip Coffee", "Large"], ["Drip Coffee", "Small"], ["Almond Croissant", "Each", {}, 2]],
  [["Chai Latte", "Regular", { Milk: ["Oat milk"], Temperature: ["Hot"] }]],
];
const NAMES = ["Priya", "Marcus", "Elena", "Tom", "Aisha", "Ben", "Carmen", "Dev", "Grace", "Hiro", "Ines", "Kofi", "Lena", "Noah"];
const INFO = [
  "Asked about parking. Answered from the restaurant's notes.", "Asked if oat milk costs extra. Quoted the menu price.", "Asked about Sunday opening hours.",
  "Asked whether there's outdoor seating.", "Asked if the café has Wi-Fi.", "Asked about gluten-free bread.", "Asked whether dogs are allowed.",
];

function selection(menu: Menu, [item, variation, choices = {}, qty = 1]: Pick): Selection {
  const it = menu.items.find((i) => i.name === item)!;
  return {
    itemId: it.id, variationId: it.variations.find((v) => v.name === variation)!.id, quantity: qty,
    modifiers: Object.entries(choices).flatMap(([list, opts]) => {
      const l = Object.values(menu.lists).find((x) => x.name === list)!;
      return opts.map((o) => ({ listId: l.id, optionId: l.options.find((x) => x.name === o)!.id }));
    }),
  };
}

/** Builds an order step by step through the real state machine, then returns its id and total. */
async function historicOrder(db: Db, rid: string, lid: string, menu: Menu, callId: string, mix: Pick[], who: { name: string; phone: string }, received: string | null) {
  const at = () => new Date().toISOString();
  return withTenant(db, { restaurantId: rid, actorType: "AI" }, async (tx) => {
    let o = await createOrder(tx, { restaurantId: rid, locationId: lid, callId, isTest: false, posMode: "DASHBOARD_TICKET", currency: "USD" }, { actor: "AI" });
    for (const p of mix) {
      const sel = selection(menu, p);
      if (validateSelection(menu, sel, new Date()).length) continue;
      o = await updateDraft(tx, o.id, { op: "add", line: toOrderLine(menu, sel) }, { actor: "AI" });
    }
    o = await updateDraft(tx, o.id, { op: "customer", customer: { name: who.name, phone: who.phone, phoneSource: "CALLER_ID_CONFIRMED" } }, { actor: "AI" });
    const sub = subtotal(o);
    const tax = taxOn(sub, TAX);
    o = await transition(tx, o.id, (x) => readyForConfirmation(x, { subtotalMinor: sub, taxMinor: tax, totalMinor: sub + tax, version: x.version, calculatedAt: at(), source: "SQUARE" }, 0, { actor: "AI", at: at() }), { actor: "AI" });
    o = await transition(tx, o.id, (x) => confirm(x, x.version, { actor: "AI", at: at() }), { actor: "AI" });
    o = await transition(tx, o.id, (x) => startSubmission(x, { actor: "SYSTEM", at: at() }), { actor: "SYSTEM" });
    await recordAttemptStart(tx, o, Buffer.from(`ticket:${o.id}`));
    await recordAttemptResult(tx, o.id, o.submissionAttempts, { outcome: "CREATED" });
    o = await transition(tx, o.id, (x) => submissionSucceeded(x, { actor: "SYSTEM", at: at() }), { actor: "SYSTEM" });
    if (received) o = await transition(tx, o.id, (x) => accept(x, received, { actor: "STAFF", at: at() }), { actor: "STAFF", userId: received });
    return { id: o.id, total: sub + tax, lines: o.lines.map((l) => `${l.quantity} × ${l.itemName}`).join(", ") };
  });
}

type Outcome = "INFO_RESOLVED" | "ORDER_SUBMITTED" | "TRANSFERRED" | "CALLBACK_REQUESTED" | "CALLER_HUNG_UP" | "STAFF_ANSWERED";

function localInstant(daysAgo: number, minutesIntoDay: number): Date {
  // Midnight in New York `daysAgo` days back, then add minutes. Good enough for sample data across DST.
  const now = new Date();
  const ny = new Date(now.toLocaleString("en-US", { timeZone: TZ }));
  const offset = now.getTime() - ny.getTime();
  const midnight = new Date(ny.getFullYear(), ny.getMonth(), ny.getDate() - daysAgo, 0, 0, 0, 0).getTime() + offset;
  return new Date(midnight + minutesIntoDay * 60_000);
}

async function historicCall(db: Db, rid: string, lid: string, menu: Menu, people: Record<string, string>, rand: () => number, at: Date, outcome: Outcome, n: number, waiting: boolean) {
  const name = NAMES[Math.floor(rand() * NAMES.length)]!;
  const phone = `+121255501${String(Math.floor(rand() * 100)).padStart(2, "0")}`;
  const dur = { INFO_RESOLVED: 40, ORDER_SUBMITTED: 120, TRANSFERRED: 50, CALLBACK_REQUESTED: 70, CALLER_HUNG_UP: 10, STAFF_ANSWERED: 30 }[outcome] + Math.floor(rand() * 120);
  const call = await withSystem(db, (tx) => one<{ id: string }>(
    tx,
    `insert into calls (restaurant_id, location_id, phone_number_id, provider_call_sid, from_e164, to_e164, started_at, answered_at, status)
     select $1, $2, p.id, $3, $4, $5, $6, $6, 'IN_PROGRESS' from phone_numbers p where p.location_id = $2 limit 1 returning id`,
    [rid, lid, `CASEED${String(n).padStart(28, "0")}`, phone, SEED_NUMBERS.aiNumber, at.toISOString()],
  ));
  let summary = "Caller hung up.";
  let callerName: string | null = null;
  const events: [number, string, string, string][] = [[0, "call.started", "SYSTEM", "Call answered by the AI line."]];
  if (outcome === "ORDER_SUBMITTED") {
    const mix = MIXES[Math.floor(rand() * MIXES.length)]!;
    const order = await historicOrder(db, rid, lid, menu, call.id, mix, { name, phone }, waiting ? null : people.STAFF!);
    summary = `Phone order: ${order.lines} ($${(order.total / 100).toFixed(2)}).`;
    callerName = name;
    events.push([6, "tool.search_menu", "AI", "Searched the menu."], [40, "tool.update_order_draft", "AI", "Order draft: add item."], [80, "tool.calculate_order_total", "AI", "Priced the order and read it back."], [100, "tool.submit_confirmed_order", "AI", "Sent the order (sent not acknowledged)."]);
    const sentAt = new Date(at.getTime() + (dur - 10) * 1000);
    await db.query("update orders set created_at = $2, updated_at = $3, submitted_at = $3, received_at = case when received_at is null then null else $4::timestamptz end where id = $1", [order.id, at.toISOString(), sentAt.toISOString(), new Date(sentAt.getTime() + 90_000).toISOString()]);
    // Spread the order's history over the call, one step a few seconds after the last.
    await db.query(
      `update order_events e set occurred_at = $2::timestamptz + (x.step * interval '15 seconds')
         from (select id, row_number() over (order by occurred_at, created_at) as step from order_events where order_id = $1) x where x.id = e.id`,
      [order.id, at.toISOString()],
    );
  } else if (outcome === "INFO_RESOLVED") {
    summary = INFO[Math.floor(rand() * INFO.length)]!;
    events.push([8, "tool.get_restaurant_info", "AI", "Looked up an answer."]);
  } else if (outcome === "TRANSFERRED") {
    summary = rand() < 0.5 ? "Asked about an allergy; passed to the owner." : "Wanted to talk to someone about a large order.";
    await db.query("insert into transfers (restaurant_id, call_id, destination_e164, reason, strategy, started_at, answered_at, ended_at, result) values ($1, $2, $3, 'CALLER_REQUEST', 'DIRECT', $4, $4, $4, 'CONNECTED')", [rid, call.id, SEED_NUMBERS.counter, new Date(at.getTime() + 30_000).toISOString()]);
    events.push([28, "handoff.triggered", "AI", "Connecting the caller to Front counter."], [40, "transfer.connected", "STAFF", "A person took the call."]);
  } else if (outcome === "CALLBACK_REQUESTED") {
    summary = "Asked for a call back about catering.";
    callerName = name;
    const open = at.getTime() > Date.now() - 2 * 86_400_000;
    await db.query(
      `insert into callback_requests (restaurant_id, location_id, call_id, customer_name, phone_e164, preferred_window, reason, status, handled_by, handled_at, created_at)
       values ($1, $2, $3, $4, $5, 'This afternoon', 'Coffee box for 12 people on Friday', $6, $7, $8, $9)`,
      [rid, lid, call.id, name, phone, open ? "OPEN" : "DONE", open ? null : people.STAFF, open ? null : new Date(at.getTime() + 3_600_000).toISOString(), at.toISOString()],
    );
    events.push([50, "callback.requested", "AI", "Took a callback request."]);
  } else if (outcome === "STAFF_ANSWERED") {
    summary = "Staff answered before the AI.";
  }
  events.push([dur, "call.ended", "SYSTEM", "Call ended (completed)."]);
  const ended = new Date(at.getTime() + dur * 1000);
  await db.query(
    `update calls set status = 'ENDED', outcome = $2, ended_at = $3, duration_seconds = $4, summary = $5, caller_name = $6,
            transfer_status = case when $2 = 'TRANSFERRED' then 'CONNECTED' else 'NONE' end, purge_after = $3::timestamptz + interval '90 days'
      where id = $1`,
    [call.id, outcome, ended.toISOString(), dur, summary, callerName],
  );
  for (const [i, [offset, type, actor, detail]] of events.entries()) {
    await db.query("insert into call_events (restaurant_id, call_id, seq, event_type, actor_type, occurred_at, payload_redacted) values ($1, $2, $3, $4, $5, $6, $7)", [rid, call.id, i, type, actor, new Date(at.getTime() + offset * 1000).toISOString(), JSON.stringify({ detail })]);
  }
}

export type SeedResult = { restaurantId: string; locationId: string; created: boolean };

/**
 * Creates the sample café if it isn't there yet. `db` must connect as the database owner (the dev stack's
 * superuser), because back-dating history writes to tables the application role may only append to.
 */
export async function seedThirdSpace(db: Db, opts: { cipher: TokenCipher; squareTokens: { access: string; refresh: string }; days?: number }): Promise<SeedResult> {
  const existing = await withSystem(db, (tx) => maybeOne<{ id: string; location_id: string }>(tx, "select r.id, l.id as location_id from restaurants r join locations l on l.restaurant_id = r.id where r.slug = 'third-space' limit 1"));
  if (existing) return { restaurantId: existing.id, locationId: existing.location_id, created: false };

  const { people, rid, lid } = await withSystem(db, async (tx) => {
    const people = await ensurePeople(tx);
    const cafe = await setUpCafe(tx, people, opts.cipher, opts.squareTokens);
    return { people, ...cafe };
  });
  const menu = await withSystem(db, (tx) => loadMenu(tx, lid));
  const rand = rng(20261021);
  const outcomes: [number, Outcome][] = [[0.4, "INFO_RESOLVED"], [0.7, "ORDER_SUBMITTED"], [0.8, "TRANSFERRED"], [0.86, "CALLBACK_REQUESTED"], [0.96, "CALLER_HUNG_UP"], [1, "STAFF_ANSWERED"]];
  let n = 0;
  const days = opts.days ?? 30;
  for (let d = days - 1; d >= 0; d--) {
    const weekend = [0, 6].includes(localInstant(d, 12 * 60).getUTCDay());
    const open = weekend ? 8 * 60 : 7 * 60;
    const close = weekend ? 16 * 60 : 18 * 60;
    const count = 6 + Math.floor(rand() * 9);
    const times = Array.from({ length: count }, () => open + Math.floor(rand() * (close - open - 10))).sort((a, b) => a - b);
    for (const [i, minute] of times.entries()) {
      const at = localInstant(d, minute);
      if (at.getTime() > Date.now() - 15 * 60_000) continue;
      const r = rand();
      const outcome = outcomes.find(([p]) => r < p)![1];
      await historicCall(db, rid, lid, menu, people, rand, at, outcome, ++n, false);
      void i;
    }
  }
  // Two tickets waiting on the Live orders board right now, so the screen has something to show.
  for (const minsAgo of [9, 3]) await historicCall(db, rid, lid, menu, people, rand, new Date(Date.now() - minsAgo * 60_000), "ORDER_SUBMITTED", ++n, true);

  await withSystem(db, async (tx) => {
    const waiting = await many<{ id: string; customer_name: string }>(tx, "select id, customer_name from orders where location_id = $1 and local_status = 'SUBMITTED_TO_POS'", [lid]);
    for (const w of waiting) {
      await tx.query("insert into alerts (restaurant_id, location_id, kind, severity, order_id, message, dedupe_key, notified_at) values ($1, $2, 'NEW_TICKET', 'INFO', $3, $4, $5, now())", [rid, lid, w.id, `New phone order from ${w.customer_name}.`, `ticket:${w.id}`]);
    }
    const audit = [
      [people.OWNER, "USER", "ordering.mode", "Main Street", "Phone orders: dashboard ticket; sign-off: fallback approved.", 8],
      [people.MANAGER, "USER", "faqs.create", "Knowledge", "Added “Does oat milk cost extra?”.", 6],
      [people.MANAGER, "USER", "menu.alias", "Cold Brew", "Callers can say “iced coffee” for Cold Brew.", 5],
      [null, "SYSTEM", "menu.sync", "Menu", "Synced 60 menu entries from Square.", 0],
    ] as const;
    for (const [actor, type, action, target, summary, daysAgo] of audit) {
      await tx.query(
        "insert into audit_logs (restaurant_id, actor_user_id, actor_type, action, target_type, after_redacted, occurred_at) values ($1, $2, $3, $4, 'seed', $5, now() - make_interval(days => $6))",
        [rid, actor, type, action, JSON.stringify({ target, summary }), daysAgo],
      );
    }
  });
  return { restaurantId: rid, locationId: lid, created: true };
}
