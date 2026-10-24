// @ts-nocheck -- ported from a plain-JS script; the assertions are what matter here
// Applies the migrations to a real Postgres 18 and checks the invariants the schema promises:
// tenant isolation, the Square gate, order confirmation and versioning, idempotency, append-only logs.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startTestDatabase, type TestDatabase } from "../src/testing.ts";
import type { Tx } from "../src/index.ts";

type Ctx = { rid?: string; uid?: string; system?: boolean; actor?: string };

let t: TestDatabase;
let passed = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) passed++;
  else failures.push(`${name} ${extra}`);
};

// Run fn inside a transaction as app_rw with the given context. Rolls back on error.
async function as<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const c = await t.pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role app_rw");
    if (ctx.system) await c.query(`select set_config('app.system', 'on', true)`);
    if (ctx.rid) await c.query(`select set_config('app.restaurant_id', $1, true)`, [ctx.rid]);
    if (ctx.uid) await c.query(`select set_config('app.user_id', $1, true)`, [ctx.uid]);
    if (ctx.actor) await c.query(`select set_config('app.actor_type', $1, true)`, [ctx.actor]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
async function expectError(name: string, ctx: Ctx, fn: (tx: Tx) => Promise<unknown>, pattern: RegExp) {
  try {
    await as(ctx, fn);
    ok(name, false, "(no error raised)");
  } catch (e) {
    ok(name, pattern.test((e as Error).message), `(got: ${(e as Error).message})`);
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const one = async (tx: Tx, sql: string, params: unknown[] = []): Promise<any> => (await tx.query(sql, params)).rows[0];
const SYS: Ctx = { system: true };

before(async () => {
  t = await startTestDatabase();
});
after(async () => {
  await t.stop();
});

test("schema invariants hold on a real Postgres", async () => {
  const tables = (await t.pool.query(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`)).rows[0].n;
  ok(`schema applies (${tables} tables)`, tables === 39);
  const noRls = (await t.pool.query(`select tablename from pg_tables t join pg_class c on c.relname = t.tablename
    where schemaname = 'public' and tablename <> 'schema_migrations' and not (c.relrowsecurity and c.relforcerowsecurity)`)).rows;
  ok("every table has forced row level security", noRls.length === 0, JSON.stringify(noRls));

  // Seed two tenants as the system context
  const ids = await as(SYS, async (tx) => {
    const ua = (await one(tx, `insert into users (id, email) values (gen_random_uuid(), 'a@x.test') returning id`)).id;
    const ub = (await one(tx, `insert into users (id, email) values (gen_random_uuid(), 'b@x.test') returning id`)).id;
    const ra = (await one(tx, `insert into restaurants (name, slug) values ('Third Space', 'third-space') returning id`)).id;
    const rb = (await one(tx, `insert into restaurants (name, slug) values ('Other Place', 'other-place') returning id`)).id;
    const la = (await one(tx, `insert into locations (restaurant_id, name, timezone) values ($1, 'Main', 'America/New_York') returning id`, [ra])).id;
    const lb = (await one(tx, `insert into locations (restaurant_id, name, timezone) values ($1, 'Main', 'America/Chicago') returning id`, [rb])).id;
    await tx.query(`insert into location_settings (location_id, restaurant_id) values ($1, $2), ($3, $4)`, [la, ra, lb, rb]);
    await tx.query(`insert into memberships (restaurant_id, user_id, role) values ($1, $2, 'OWNER'), ($3, $4, 'OWNER')`, [ra, ua, rb, ub]);
    await tx.query(`insert into phone_numbers (restaurant_id, location_id, provider_sid, e164) values ($1, $2, 'PN_A', '+15550000001')`, [ra, la]);
    await tx.query(`insert into webhook_events (provider, provider_event_id, event_type) values ('SQUARE', 'evt_1', 'catalog.version.updated')`);
    return { ua, ub, ra, rb, la, lb };
  });
  const A = { rid: ids.ra, uid: ids.ua }, B = { rid: ids.rb, uid: ids.ub };

  // 2. Tenant isolation
  await as(A, async (tx) => {
    ok('tenant A sees only its own location', (await one(tx, `select count(*)::int n from locations`)).n === 1);
    ok('tenant A cannot read tenant B by id', (await one(tx, `select count(*)::int n from locations where id = $1`, [ids.lb])).n === 0);
    ok('tenant A sees its own restaurant only', (await one(tx, `select count(*)::int n from restaurants`)).n === 1);
    ok('tenant context cannot see webhook ledger', (await one(tx, `select count(*)::int n from webhook_events`)).n === 0);
  });
  await as({}, async (tx) => {
    ok('no context = no rows', (await one(tx, `select count(*)::int n from locations`)).n === 0);
  });
  await expectError('tenant A cannot write a row for tenant B', A,
    (tx) => tx.query(`insert into faqs (restaurant_id, location_id, question, answer) values ($1, $2, 'Parking?', 'Yes')`, [ids.rb, ids.lb]),
    /row-level security/);
  await expectError('composite FK blocks cross-tenant parent', SYS,
    (tx) => tx.query(`insert into faqs (restaurant_id, location_id, question, answer) values ($1, $2, 'Parking?', 'Yes')`, [ids.ra, ids.lb]),
    /foreign key/);

  // 3. The Square gate (spec P0)
  await expectError('Square ordering blocked until feasibility is verified', A,
    (tx) => tx.query(`update locations set ordering_mode = 'SQUARE' where id = $1`, [ids.la]), /square_mode_needs_proof/);
  await expectError('dashboard tickets need written approval', A,
    (tx) => tx.query(`update locations set ordering_mode = 'DASHBOARD_TICKET' where id = $1`, [ids.la]), /ticket_mode_needs_approval/);
  await as(A, (tx) => tx.query(`update locations set pos_feasibility = 'FALLBACK_APPROVED', ordering_mode = 'DASHBOARD_TICKET' where id = $1`, [ids.la]));
  ok('fallback mode allowed once approved', true);

  // 4. Routing and claims
  await expectError('a called number routes to exactly one tenant', SYS,
    (tx) => tx.query(`insert into phone_numbers (restaurant_id, location_id, provider_sid, e164) values ($1, $2, 'PN_B', '+15550000001')`, [ids.rb, ids.lb]),
    /phone_numbers_route_key/);
  await expectError('two tenants cannot claim one Square location', SYS, async (tx) => {
    for (const [r, l] of [[ids.ra, ids.la], [ids.rb, ids.lb]]) {
      await tx.query(`insert into pos_integrations (restaurant_id, location_id, environment, merchant_id, pos_location_id, access_token_ct, refresh_token_ct)
                      values ($1, $2, 'SANDBOX', 'M1', 'L1', '\\x00', '\\x00')`, [r, l]);
    }
  }, /pos_integrations_claim/);
  await expectError('one owner per restaurant', SYS,
    (tx) => tx.query(`insert into memberships (restaurant_id, user_id, role) values ($1, $2, 'OWNER')`, [ids.ra, ids.ub]),
    /memberships_one_owner/);

  // 5. Order integrity
  const o = await as({ ...A, actor: 'AI' }, async (tx) => {
    const item = (await one(tx, `insert into menu_items (restaurant_id, location_id, square_id, name, square_version, synced_at)
                                 values ($1, $2, 'ITEM1', 'Cold Brew', 1, now()) returning id`, [ids.ra, ids.la])).id;
    const variation = (await one(tx, `insert into menu_variations (restaurant_id, location_id, item_id, square_id, name, pricing_type, price_minor, currency, square_version, synced_at)
                                      values ($1, $2, $3, 'VAR1', 'Large', 'FIXED_PRICING', 550, 'USD', 1, now()) returning id`, [ids.ra, ids.la, item])).id;
    const call = (await one(tx, `insert into calls (restaurant_id, location_id, provider_call_sid, to_e164) values ($1, $2, 'CA1', '+15550000001') returning id`, [ids.ra, ids.la])).id;
    const order = (await one(tx, `insert into orders (restaurant_id, location_id, call_id, currency, pos_mode) values ($1, $2, $3, 'USD', 'DASHBOARD_TICKET') returning id, version, idempotency_key`, [ids.ra, ids.la, call]));
    return { item, variation, call, order: order.id, key: order.idempotency_key };
  });
  const addLine = (tx, n) => tx.query(`insert into order_items (restaurant_id, order_id, line_no, variation_id, square_item_id, square_variation_id, item_name, variation_name, quantity, unit_price_minor)
    values ($1, $2, $3, $4, 'ITEM1', 'VAR1', 'Cold Brew', 'Large', 1, 550)`, [ids.ra, o.order, n, o.variation]);
  const state = (tx) => one(tx, `select local_status s, version v, confirmed_version cv from orders where id = $1`, [o.order]);

  await as(A, async (tx) => {
    await addLine(tx, 1);
    ok('adding a line bumps the version', (await state(tx)).v === 2);
    await tx.query(`update orders set customer_name = 'Sam', customer_phone_e164 = '+15551234567', customer_phone_source = 'SPOKEN' where id = $1`, [o.order]);
    ok('customer details bump the version', (await state(tx)).v === 3);
  });
  await expectError('cannot skip straight to submission', A,
    (tx) => tx.query(`update orders set local_status = 'SUBMISSION_PENDING' where id = $1`, [o.order]), /cannot go from DRAFT/);
  await expectError('read-back needs totals for this version', A,
    (tx) => tx.query(`update orders set local_status = 'READY_FOR_CONFIRMATION' where id = $1`, [o.order]), /read_back_has_totals/);
  const priceAndConfirm = (tx) => tx.query(`update orders set subtotal_minor = 550 * (select count(*) from order_items where order_id = $1),
      total_minor = 550 * (select count(*) from order_items where order_id = $1), totals_version = version, totals_calculated_at = now(), totals_source = 'SQUARE',
      local_status = 'READY_FOR_CONFIRMATION' where id = $1`, [o.order])
    .then(() => tx.query(`update orders set local_status = 'CUSTOMER_CONFIRMED', confirmed_version = version, confirmed_at = now() where id = $1`, [o.order]));
  await as(A, priceAndConfirm);
  await as(A, async (tx) => {
    ok('confirmed at version 3', (await state(tx)).s === 'CUSTOMER_CONFIRMED');
    await addLine(tx, 2);
    const s = await state(tx);
    ok('an edit after confirmation reverts to DRAFT and voids it', s.s === 'DRAFT' && s.v === 4 && s.cv === 3, JSON.stringify(s));
  });
  await expectError('cannot confirm a stale version', A,
    (tx) => tx.query(`update orders set local_status = 'READY_FOR_CONFIRMATION', totals_version = 3, total_minor = 1100, totals_source = 'SQUARE' where id = $1`, [o.order]),
    /read_back_has_totals/);
  await as(A, priceAndConfirm);
  await as({ ...A, actor: 'SYSTEM' }, (tx) => tx.query(`update orders set local_status = 'SUBMISSION_PENDING', submission_attempts = 1, last_submit_attempt_at = now() where id = $1`, [o.order]));
  ok('a confirmed, priced order can be submitted', true);
  await expectError('a real order can never carry an estimated total', SYS,
    (tx) => tx.query(`insert into orders (restaurant_id, location_id, currency, pos_mode, is_test, total_minor, totals_source)
      values ($1, $2, 'USD', 'DASHBOARD_TICKET', false, 100, 'ESTIMATE')`, [ids.ra, ids.la]), /estimate_only_for_tests/);
  await expectError('a total needs a source', SYS,
    (tx) => tx.query(`insert into orders (restaurant_id, location_id, currency, pos_mode, is_test, total_minor)
      values ($1, $2, 'USD', 'DASHBOARD_TICKET', true, 100)`, [ids.ra, ids.la]), /totals_have_source/);
  await as(SYS, (tx) => tx.query(`insert into orders (restaurant_id, location_id, currency, pos_mode, is_test, total_minor, totals_source)
      values ($1, $2, 'USD', 'DASHBOARD_TICKET', true, 100, 'ESTIMATE')`, [ids.ra, ids.la]));
  ok('a test order may carry an estimate', true);
  await expectError('submitted content is frozen', A, (tx) => addLine(tx, 3), /can no longer change/);
  await expectError('submitted customer details are frozen', A,
    (tx) => tx.query(`update orders set customer_name = 'Someone Else' where id = $1`, [o.order]), /can no longer change/);
  await expectError('idempotency key cannot rotate mid-submission', A,
    (tx) => tx.query(`update orders set idempotency_key = gen_random_uuid() where id = $1`, [o.order]), /idempotency key cannot change/);
  await expectError('an attempt must use the order key', A,
    (tx) => tx.query(`insert into pos_submission_attempts (restaurant_id, order_id, attempt_no, order_version, idempotency_key, request_hash)
                      values ($1, $2, 1, 4, gen_random_uuid(), '\\x01')`, [ids.ra, o.order]), /current idempotency key/);
  await as(A, async (tx) => {
    await tx.query(`insert into pos_submission_attempts (restaurant_id, order_id, attempt_no, order_version, idempotency_key, request_hash, outcome)
                    values ($1, $2, 1, 4, $3, '\\x01', 'CREATED')`, [ids.ra, o.order, o.key]);
    await tx.query(`update orders set local_status = 'SUBMITTED_TO_POS', submitted_at = now() where id = $1`, [o.order]);
    await tx.query(`update orders set local_status = 'RECEIVED_BY_RESTAURANT', received_at = now(), received_by = $2 where id = $1`, [o.order, ids.ua]);
    ok('ticket reaches RECEIVED_BY_RESTAURANT', (await state(tx)).s === 'RECEIVED_BY_RESTAURANT');
    const ev = (await tx.query(`select from_status, to_status from order_events where order_id = $1 order by occurred_at, created_at`, [o.order])).rows;
    ok(`every status change is logged (${ev.length} events)`, ev.length === 9, JSON.stringify(ev));
    ok('the trigger-made revert to DRAFT is logged', ev.some((e) => e.from_status === 'CUSTOMER_CONFIRMED' && e.to_status === 'DRAFT'));
  });
  await expectError('received orders cannot go back to draft', A,
    (tx) => tx.query(`update orders set local_status = 'DRAFT' where id = $1`, [o.order]), /cannot go from RECEIVED_BY_RESTAURANT/);
  await expectError('one open order per call', A, async (tx) => {
    await tx.query(`insert into orders (restaurant_id, location_id, call_id, currency, pos_mode) values ($1, $2, $3, 'USD', 'DASHBOARD_TICKET')`, [ids.ra, ids.la, o.call]);
    await tx.query(`insert into orders (restaurant_id, location_id, call_id, currency, pos_mode) values ($1, $2, $3, 'USD', 'DASHBOARD_TICKET')`, [ids.ra, ids.la, o.call]);
  }, /orders_one_open_per_call/);
  await expectError('test orders never go to Square', A,
    (tx) => tx.query(`insert into orders (restaurant_id, location_id, currency, pos_mode, is_test) values ($1, $2, 'USD', 'SQUARE', true)`, [ids.ra, ids.la]),
    /test_orders_stay_local/);

  // 6. Audit, sync, views, timestamps
  await as(A, (tx) => tx.query(`insert into audit_logs (restaurant_id, actor_user_id, actor_type, action, target_type) values ($1, $2, 'USER', 'settings.update', 'location_settings')`, [ids.ra, ids.ua]));
  await expectError('audit log is append-only', A, (tx) => tx.query(`update audit_logs set action = 'x.y'`), /permission denied/);
  await expectError('order events are append-only', A, (tx) => tx.query(`delete from order_events`), /permission denied/);
  await expectError('one running catalog sync per location', A, async (tx) => {
    await tx.query(`insert into catalog_syncs (restaurant_id, location_id, kind, trigger) values ($1, $2, 'FULL', 'MANUAL')`, [ids.ra, ids.la]);
    await tx.query(`insert into catalog_syncs (restaurant_id, location_id, kind, trigger) values ($1, $2, 'INCREMENTAL', 'WEBHOOK')`, [ids.ra, ids.la]);
  }, /catalog_syncs_one_running/);
  await as(A, async (tx) => {
    const rows = (await tx.query(`select location_id, is_stale from location_menu_status`)).rows;
    ok('menu status view obeys tenancy and flags a never-synced menu as stale', rows.length === 1 && rows[0].is_stale === true, JSON.stringify(rows));
    const u = (await tx.query(`select * from usage_monthly`)).rows;
    ok('usage view obeys tenancy', u.every((r) => r.restaurant_id === ids.ra));
  });
  const before = await as(A, (tx) => one(tx, `insert into faqs (restaurant_id, location_id, question, answer) values ($1, $2, 'Parking?', 'Street only') returning id, updated_at`, [ids.ra, ids.la]));
  await new Promise((r) => setTimeout(r, 5));
  const after = await as(A, (tx) => one(tx, `update faqs set answer = 'Free lot behind the building' where id = $1 returning updated_at`, [before.id]));
  ok('FAQs can be edited in place and updated_at moves', new Date(after.updated_at) > new Date(before.updated_at));
  await expectError('generated FAQs stay off until reviewed', A,
    (tx) => tx.query(`insert into faqs (restaurant_id, location_id, question, answer, source, reviewed) values ($1, $2, 'Dogs?', 'Yes', 'GENERATED', false)`, [ids.ra, ids.la]),
    /generated_needs_review/);


  assert.deepEqual(failures, [], `${failures.length} schema checks failed`);
  assert.ok(passed >= 40, `expected at least 40 checks, ran ${passed}`);
});
