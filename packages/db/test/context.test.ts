import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { migrate, one, many, pgError, PG, withSystem, withTenant, withUser } from "../src/index.ts";
import { startTestDatabase, type TestDatabase } from "../src/testing.ts";

let t: TestDatabase;
before(async () => {
  t = await startTestDatabase();
});
after(async () => {
  await t.stop();
});

test("migrations are applied once and a second run does nothing", async () => {
  const again = await migrate(t.pool);
  assert.deepEqual(again.applied, []);
  assert.deepEqual(again.skipped, ["0001_init.sql", "0002_backend_columns.sql"]);
});

test("withTenant sees one restaurant, withSystem sees all, withUser sees own memberships", async () => {
  const ids = await withSystem(t.pool, async (tx) => {
    const a = await one<{ id: string }>(tx, "insert into users (id, email) values (gen_random_uuid(), 'a@x.test') returning id");
    const r1 = await one<{ id: string }>(tx, "insert into restaurants (name, slug) values ('One', 'one') returning id");
    const r2 = await one<{ id: string }>(tx, "insert into restaurants (name, slug) values ('Two', 'two') returning id");
    await tx.query("insert into memberships (restaurant_id, user_id, role) values ($1, $2, 'OWNER')", [r1.id, a.id]);
    return { user: a.id, r1: r1.id, r2: r2.id };
  });
  const own = await withTenant(t.pool, { restaurantId: ids.r1, userId: ids.user }, (tx) => many<{ name: string }>(tx, "select name from restaurants"));
  assert.deepEqual(own.map((r) => r.name), ["One"]);
  const all = await withSystem(t.pool, (tx) => many(tx, "select id from restaurants"));
  assert.equal(all.length, 2);
  const mine = await withUser(t.pool, ids.user, (tx) => many<{ restaurant_id: string }>(tx, "select restaurant_id from memberships"));
  assert.deepEqual(mine.map((m) => m.restaurant_id), [ids.r1]);
  const nothing = await withUser(t.pool, ids.user, (tx) => many(tx, "select id from locations"));
  assert.equal(nothing.length, 0);
});

test("settings do not leak between transactions on a reused connection", async () => {
  const rid = await withSystem(t.pool, async (tx) => (await one<{ id: string }>(tx, "select id from restaurants where slug = 'one'")).id);
  await withTenant(t.pool, { restaurantId: rid }, async () => {});
  const leaked = await t.pool.query("select current_setting('app.restaurant_id', true) as v, current_user as u");
  assert.ok(!leaked.rows[0].v, "restaurant context cleared after commit");
  assert.equal(leaked.rows[0].u, "postgres", "role switched back after commit");
});

test("a failed transaction rolls back and reports the Postgres error code", async () => {
  await assert.rejects(
    withSystem(t.pool, async (tx) => {
      await tx.query("insert into restaurants (name, slug) values ('Three', 'three')");
      await tx.query("insert into restaurants (name, slug) values ('Dup', 'three')");
    }),
    (e: unknown) => pgError(e)?.code === PG.uniqueViolation,
  );
  const rows = await withSystem(t.pool, (tx) => many(tx, "select 1 from restaurants where slug = 'three'"));
  assert.equal(rows.length, 0);
});

test("bigint, timestamptz and date come back as number, ISO string and plain date", async () => {
  const r = await t.pool.query("select 9007199254740::bigint as n, '2026-03-08 12:00:00+00'::timestamptz as ts, '2026-03-08'::date as d");
  assert.equal(r.rows[0].n, 9007199254740);
  assert.equal(r.rows[0].ts, "2026-03-08T12:00:00.000Z");
  assert.equal(r.rows[0].d, "2026-03-08");
});
