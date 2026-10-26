// The second sample restaurant: Tandoor & Crust in Lahore, a burger, pizza and Pakistani kitchen with a
// bigger menu than the café's, priced in rupees, on Pakistan time, with Pakistani (+92) numbers. Its own
// owner and staff; phone orders go to Live orders. No history: a fresh restaurant for trying the AI (by
// test call or chat test) on a menu with many choices. Every name, number and address is invented.
import { many, maybeOne, one, withSystem, type Db, type Tx } from "@receptionist/db";
import type { TokenCipher } from "../crypto.ts";
import { applyCatalog } from "../menu/apply.ts";
import { parseCatalog } from "../menu/parse.ts";
import { devUserId } from "./auth-stub.ts";
import { TANDOOR_SQUARE_LOCATION, tandoorCrustCatalog } from "./tandoor-crust-catalog.ts";

export const TANDOOR_PEOPLE = [
  { email: "ali@tandoorcrust.test", name: "Ali Raza", role: "OWNER" },
  { email: "sara@tandoorcrust.test", name: "Sara Khan", role: "STAFF" },
] as const;

// 042 3500 0189 (a Lahore landline), 0300 0000191 (a mobile), and so on. Dummies: the dev stack never dials.
const NUMBERS = { publicPhone: "+924235000189", aiNumber: "+924235000190", counter: "+923000000191", owner: "+923000000192" };

const FAQS: [string, string, string[]][] = [
  ["Is your meat halal?", "Yes, everything we serve is halal: chicken, beef and mutton from a certified supplier.", ["is it halal", "zabiha"]],
  ["Do you deliver?", "Phone orders are for pickup. For delivery, you'll find us on the food delivery apps.", ["delivery"]],
  ["How spicy is the food?", "Curries, grills and anything marked spicy come mild, medium, hot or extra hot. Medium is our house level.", ["spice level"]],
  ["Do you have vegetarian options?", "Yes: daal makhani, palak paneer, vegetable biryani, vegetable samosas, chaat papri, Margherita pizza and all the breads.", ["vegetarian", "veg options"]],
  ["Where can I park?", "There's free parking right in front of the restaurant on Main Boulevard.", ["parking"]],
  ["Do you do catering?", "Yes, biryani and karahi trays for groups of ten or more. Give us two days' notice; the owner prices it with you.", ["catering", "party order"]],
  ["How do I pay?", "Cash or card when you pick up. We don't take payment over the phone.", ["payment", "card", "jazzcash", "easypaisa"]],
  ["How long does a pickup order take?", "Usually 20 to 25 minutes. Karahi is cooked fresh, so allow about 30.", ["wait time"]],
];

async function ensurePeople(tx: Tx): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const p of TANDOOR_PEOPLE) {
    const id = devUserId(p.email);
    await tx.query("insert into users (id, email, display_name, last_seen_at) values ($1, $2, $3, now()) on conflict (id) do nothing", [id, p.email, p.name]);
    ids[p.role] = id;
  }
  return ids;
}

export async function seedTandoorCrust(db: Db, opts: { cipher: TokenCipher; squareTokens: { access: string; refresh: string } }): Promise<{ restaurantId: string; created: boolean }> {
  const existing = await withSystem(db, (tx) => maybeOne<{ id: string }>(tx, "select id from restaurants where slug = 'tandoor-crust'"));
  if (existing) return { restaurantId: existing.id, created: false };

  return withSystem(db, async (tx) => {
    const people = await ensurePeople(tx);
    const r = await one<{ id: string }>(tx, "insert into restaurants (name, slug, created_by) values ('Tandoor & Crust', 'tandoor-crust', $1) returning id", [people.OWNER]);
    const rid = r.id;
    const l = await one<{ id: string }>(
      tx,
      `insert into locations (restaurant_id, name, timezone, address_line1, city, region, postal_code, country, directions, public_phone_e164, website, status, currency,
                              ordering_mode, pos_feasibility, pos_feasibility_note, pos_feasibility_signed_off_by, pos_feasibility_signed_off_at, estimate_tax_rate_percent)
       values ($1, 'Gulberg', 'Asia/Karachi', '24-B Main Boulevard, Gulberg III', 'Lahore', 'Punjab', '54660', 'PK', 'On Main Boulevard, opposite the park, next to the bank.',
               $2, 'https://tandoorcrust.example', 'LIVE', 'PKR', 'DASHBOARD_TICKET', 'FALLBACK_APPROVED',
               'The owner approved taking phone orders on the Live orders screen.', $3, now(), 16)
       returning id`,
      [rid, NUMBERS.publicPhone, people.OWNER],
    );
    const lid = l.id;
    await tx.query(
      `insert into location_settings (location_id, restaurant_id, greeting, ordering_enabled, pickup_policy, pickup_estimate_minutes, after_hours_mode, transcript_enabled)
       values ($1, $2, 'Assalam-o-alaikum, and thanks for calling Tandoor & Crust. I''m the restaurant''s AI assistant. What can I get you?', true,
               'Pay at the counter when you pick up. Karahi is cooked fresh, so allow about 30 minutes.', 25, 'TAKE_CALLBACK', true)`,
      [lid, rid],
    );
    for (const p of TANDOOR_PEOPLE) await tx.query("insert into memberships (restaurant_id, user_id, role) values ($1, $2, $3)", [rid, people[p.role], p.role]);
    // Noon to 11 pm, and to 1 am on Friday and Saturday nights.
    for (let wd = 0; wd < 7; wd++) {
      await tx.query("insert into business_hours (restaurant_id, location_id, kind, weekday, opens_at, closes_at) values ($1, $2, 'STORE', $3, '12:00', $4)", [rid, lid, wd, wd === 5 || wd === 6 ? "01:00" : "23:00"]);
    }
    for (const [q, a, aliases] of FAQS) await tx.query("insert into faqs (restaurant_id, location_id, question, answer, question_aliases) values ($1, $2, $3, $4, $5)", [rid, lid, q, a, aliases]);
    await tx.query("insert into pronunciations (restaurant_id, location_id, term, spoken_as) values ($1, $2, 'Karahi', 'kuh-RAA-hee'), ($1, $2, 'Nihari', 'ni-HAA-ree')", [rid, lid]);
    await tx.query(
      `insert into transfer_targets (restaurant_id, location_id, label, e164, priority, intent, active_hours, sms_alert_on_miss)
       values ($1, $2, 'Kitchen counter', $3, 1, 'GENERAL', 'BUSINESS_HOURS', true), ($1, $2, 'Ali (owner)', $4, 2, 'CATERING', 'ALWAYS', false)`,
      [rid, lid, NUMBERS.counter, NUMBERS.owner],
    );
    await tx.query("insert into phone_numbers (restaurant_id, location_id, provider_sid, e164, fallback_e164) values ($1, $2, 'PN00000000000000000000000000000002', $3, $4)", [rid, lid, NUMBERS.aiNumber, NUMBERS.publicPhone]);
    const integ = await one<{ id: string }>(
      tx,
      `insert into pos_integrations (restaurant_id, location_id, environment, merchant_id, merchant_name, pos_location_id, pos_location_name, status, scopes, connected_by)
       values ($1, $2, 'SANDBOX', 'MSAMPLE', 'Tandoor & Crust', $3, 'Tandoor & Crust - Gulberg', 'DISCONNECTED', '{MERCHANT_PROFILE_READ,ITEMS_READ,ORDERS_READ,ORDERS_WRITE}', $4) returning id`,
      [rid, lid, TANDOOR_SQUARE_LOCATION, people.OWNER],
    );
    await tx.query(
      `update pos_integrations set access_token_ct = $2, refresh_token_ct = $3, key_version = $4, token_expires_at = now() + interval '30 days', status = 'CONNECTED', last_success_at = now()
        where id = $1`,
      [integ.id, opts.cipher.encrypt(opts.squareTokens.access, `${integ.id}:access`), opts.cipher.encrypt(opts.squareTokens.refresh, `${integ.id}:refresh`), opts.cipher.version],
    );
    await applyCatalog(tx, { restaurantId: rid, locationId: lid, parsed: parseCatalog(tandoorCrustCatalog(), TANDOOR_SQUARE_LOCATION, "PKR"), full: true, at: new Date() });
    await tx.query("insert into catalog_syncs (restaurant_id, location_id, kind, trigger, status, finished_at, objects_upserted, catalog_high_water) values ($1, $2, 'FULL', 'CONNECT', 'SUCCEEDED', now(), 120, now())", [rid, lid]);
    const items = await many<{ id: string; name: string }>(tx, "select id, name from menu_items where location_id = $1", [lid]);
    const byName = new Map(items.map((i) => [i.name, i.id]));
    for (const [phrase, item] of [["coke", "Soft Drink"], ["soda", "Soft Drink"], ["pink tea", "Kashmiri Chai"], ["tikka boti", "Chicken Tikka"]] as const) {
      await tx.query("insert into menu_aliases (restaurant_id, location_id, item_id, phrase, created_by) values ($1, $2, $3, $4, $5)", [rid, lid, byName.get(item), phrase, people.OWNER]);
    }
    return { restaurantId: rid, created: true };
  });
}
