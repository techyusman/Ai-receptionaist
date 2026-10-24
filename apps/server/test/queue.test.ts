import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createPool, withTenant, withSystem, type Db } from "@receptionist/db";
import { startTestDatabase, type TestDatabase } from "@receptionist/db/testing";
import { grantQueueAccess, PgBossQueue } from "../src/jobs/pgboss.ts";
import type { JobHandlers } from "../src/jobs/queue.ts";

let td: TestDatabase;
let queue: PgBossQueue;
let appDb: Db;
const ran: { name: string; data: unknown }[] = [];

const handlers = Object.fromEntries(
  ["catalog.sync", "catalog.reconcile", "catalog.staleness", "square.refresh_tokens", "order.reconcile", "webhook.process", "call.finalize", "alerts.fanout", "retention.purge", "usage.rollup"].map((n) => [n, async (data: unknown) => void ran.push({ name: n, data })]),
) as unknown as JobHandlers;
const wait = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out");
};

before(async () => {
  td = await startTestDatabase();
  // As in production: the owner installs the queue at migrate time; the worker only runs it.
  const installer = new PgBossQueue(td.url, "install");
  await installer.install();
  await installer.stop();
  await grantQueueAccess(td.pool);
  queue = new PgBossQueue(td.url, "worker");
  await queue.connect();
  await queue.work(handlers, () => {});
  appDb = td.pool;
});
after(async () => {
  await queue.stop();
  await td.stop();
});

test("a job queued inside a transaction runs after it commits, and never if it rolls back", async () => {
  await withSystem(appDb, (tx) => queue.enqueue("call.finalize", { callId: "committed" }, { tx }));
  await assert.rejects(
    withSystem(appDb, async (tx) => {
      await queue.enqueue("call.finalize", { callId: "rolled-back" }, { tx });
      throw new Error("the change failed");
    }),
    /the change failed/,
  );
  await wait(() => ran.some((j) => (j.data as { callId?: string }).callId === "committed"));
  await new Promise((r) => setTimeout(r, 2500));
  assert.ok(!ran.some((j) => (j.data as { callId?: string }).callId === "rolled-back"), "the rolled-back change left no job behind");
});

test("the application role (not the owner) can queue jobs from a tenant transaction", async () => {
  const rid = await withSystem(appDb, async (tx) => (await tx.query<{ id: string }>("insert into restaurants (name, slug) values ('Q', 'q-cafe') returning id")).rows[0]!.id);
  await withTenant(appDb, { restaurantId: rid }, (tx) => queue.enqueue("alerts.fanout", { alertId: "from-tenant" }, { tx }));
  await wait(() => ran.some((j) => (j.data as { alertId?: string }).alertId === "from-tenant"));
});

test("a job with a singleton key is queued once however often it is asked for", async () => {
  await Promise.all([1, 2, 3, 4].map(() => queue.enqueue("catalog.sync", { locationId: "L1", kind: "INCREMENTAL", trigger: "WEBHOOK" }, { singletonKey: "sync:L1", delaySeconds: 3 })));
  await wait(() => ran.some((j) => j.name === "catalog.sync"), 10000);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(ran.filter((j) => j.name === "catalog.sync").length, 1);
});

test("a delayed job waits", async () => {
  const at = Date.now();
  await queue.enqueue("order.reconcile", { orderId: "later" }, { delaySeconds: 3 });
  await wait(() => ran.some((j) => (j.data as { orderId?: string }).orderId === "later"), 10000);
  assert.ok(Date.now() - at >= 2500, "did not run early");
});

test("the recurring jobs are scheduled", async () => {
  const rows = await td.pool.query("select name from pgboss.schedule order by name");
  const names = new Set(rows.rows.map((r: { name: string }) => r.name));
  for (const n of ["catalog.reconcile", "catalog.staleness", "square.refresh_tokens", "retention.purge", "usage.rollup"]) assert.ok(names.has(n), n);
});

test("BUG-001: a database error inside the queue is logged, not thrown as an uncaught 'error' event", async () => {
  const listeners = queue.boss.listenerCount("error");
  assert.ok(listeners > 0, "the queue must listen for its own error events, or a dropped connection crashes the process");
  assert.doesNotThrow(() => queue.boss.emit("error", new Error("Connection terminated unexpectedly")));
});
