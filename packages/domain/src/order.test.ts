import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accept,
  applyChange,
  callerClaim,
  canTransition,
  confirm,
  createDraft,
  lineTotal,
  OrderRuleError,
  readyForConfirmation,
  rotateIdempotencyKey,
  startSubmission,
  submissionSucceeded,
  submissionUncertain,
  subtotal,
  type Ctx,
  type Order,
  type Totals,
} from "./order.ts";

const ctx: Ctx = { actor: "AI", at: "2026-10-22T16:00:00.000Z" };
const line = {
  itemId: "i1",
  variationId: "v1",
  itemName: "Cold brew",
  variationName: "Large",
  quantity: 2,
  unitPriceMinor: 550,
  modifiers: [{ modifierId: "m1", listId: "l1", name: "Oat milk", priceMinor: 75, quantity: 1 }],
};

function draft(): Order {
  return createDraft({
    id: "o1", locationId: "loc", callId: "c1", isTest: false, posMode: "DASHBOARD_TICKET",
    currency: "USD", idempotencyKey: "k1", ctx,
  }).order;
}

function totalsFor(o: Order): Totals {
  return { subtotalMinor: subtotal(o), taxMinor: 0, totalMinor: subtotal(o), version: o.version, calculatedAt: ctx.at, source: "ESTIMATE" };
}

function readyAndConfirmed(o: Order): Order {
  const r = readyForConfirmation(o, totalsFor(o), 0, ctx).order;
  return confirm(r, r.version, ctx).order;
}

function withCustomer(o: Order): Order {
  return applyChange(o, { op: "customer", customer: { name: "Sam", phone: "+15551234567", phoneSource: "SPOKEN" } }, ctx).order;
}

const throwsCode = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof OrderRuleError && e.code === code);

test("prices lines with modifiers in minor units", () => {
  assert.equal(lineTotal({ ...line, lineNo: 1 }), (550 + 75) * 2);
});

test("every edit bumps the version", () => {
  let o = draft();
  o = applyChange(o, { op: "add", line }, ctx).order;
  assert.equal(o.version, 2);
  o = applyChange(o, { op: "quantity", lineNo: 1, quantity: 3 }, ctx).order;
  assert.equal(o.version, 3);
  assert.equal(o.lines[0]?.quantity, 3);
});

test("a replayed tool call with an old version is refused, not applied twice", () => {
  const o = applyChange(draft(), { op: "add", line }, { ...ctx, expectedVersion: 1 }).order;
  throwsCode(() => applyChange(o, { op: "add", line }, { ...ctx, expectedVersion: 1 }), "VERSION_CONFLICT");
});

test("an edit after confirmation voids it and returns to DRAFT", () => {
  const confirmed = readyAndConfirmed(withCustomer(applyChange(draft(), { op: "add", line }, ctx).order));
  assert.equal(confirmed.status, "CUSTOMER_CONFIRMED");
  const r = applyChange(confirmed, { op: "remove", lineNo: 1 }, ctx);
  assert.equal(r.order.status, "DRAFT");
  assert.equal(r.order.confirmedVersion, confirmed.version);
  assert.ok(r.order.version > (r.order.confirmedVersion ?? 0));
  assert.deepEqual(r.events.map((e) => [e.from, e.to]), [["CUSTOMER_CONFIRMED", "DRAFT"]]);
});

test("read-back needs totals for this exact version", () => {
  const o = applyChange(draft(), { op: "add", line }, ctx).order;
  throwsCode(() => readyForConfirmation(o, { ...totalsFor(o), version: o.version - 1 }, 0, ctx), "STALE_TOTALS");
  throwsCode(() => readyForConfirmation(o, totalsFor(o), 1, ctx), "INVALID");
  throwsCode(() => readyForConfirmation(draft(), totalsFor(draft()), 0, ctx), "EMPTY");
});

test("a caller can only confirm the version that was read back", () => {
  const o = applyChange(draft(), { op: "add", line }, ctx).order;
  const r = readyForConfirmation(o, totalsFor(o), 0, ctx).order;
  throwsCode(() => confirm(r, r.version - 1, ctx), "STALE_CONFIRMATION");
  throwsCode(() => confirm(o, o.version, ctx), "NOT_READ_BACK");
});

test("submission needs confirmation, current totals and the caller's details", () => {
  const noCustomer = readyAndConfirmed(applyChange(draft(), { op: "add", line }, ctx).order);
  throwsCode(() => startSubmission(noCustomer, ctx), "NO_CUSTOMER");
  throwsCode(() => startSubmission(draft(), ctx), "NOT_CONFIRMED");
  const ok = readyAndConfirmed(withCustomer(applyChange(draft(), { op: "add", line }, ctx).order));
  const pending = startSubmission(ok, ctx).order;
  assert.equal(pending.status, "SUBMISSION_PENDING");
  assert.equal(pending.submissionAttempts, 1);
});

test("submitted orders are frozen and keep their idempotency key", () => {
  const ok = readyAndConfirmed(withCustomer(applyChange(draft(), { op: "add", line }, ctx).order));
  const pending = startSubmission(ok, ctx).order;
  throwsCode(() => applyChange(pending, { op: "add", line }, ctx), "FROZEN");
  throwsCode(() => rotateIdempotencyKey(pending, "k2"), "KEY_LOCKED");
});

test("an uncertain submission retries with the same key", () => {
  const ok = readyAndConfirmed(withCustomer(applyChange(draft(), { op: "add", line }, ctx).order));
  const unknown = submissionUncertain(startSubmission(ok, ctx).order, ctx).order;
  assert.equal(callerClaim(unknown), "UNCERTAIN");
  const retry = startSubmission(unknown, ctx).order;
  assert.equal(retry.status, "SUBMISSION_PENDING");
  assert.equal(retry.idempotencyKey, "k1");
  assert.equal(retry.submissionAttempts, 2);
});

test("the AI only claims 'received' after staff accept", () => {
  const ok = readyAndConfirmed(withCustomer(applyChange(draft(), { op: "add", line }, ctx).order));
  const sent = submissionSucceeded(startSubmission(ok, ctx).order, ctx).order;
  assert.equal(callerClaim(sent), "SENT_NOT_ACKNOWLEDGED");
  const got = accept(sent, "staff-1", { ...ctx, actor: "STAFF" }).order;
  assert.equal(got.status, "RECEIVED_BY_RESTAURANT");
  assert.equal(callerClaim(got), "RECEIVED");
});

test("Square submissions need the Square order id", () => {
  const sq = createDraft({ id: "o2", locationId: "l", callId: null, isTest: false, posMode: "SQUARE", currency: "USD", idempotencyKey: "k", ctx }).order;
  const ok = readyAndConfirmed(withCustomer(applyChange(sq, { op: "add", line }, ctx).order));
  throwsCode(() => submissionSucceeded(startSubmission(ok, ctx).order, ctx), "NO_POS_ID");
});

test("test orders never go to Square", () => {
  throwsCode(
    () => createDraft({ id: "t", locationId: "l", callId: null, isTest: true, posMode: "SQUARE", currency: "USD", idempotencyKey: "k", ctx }),
    "TEST_ORDER_TO_POS",
  );
});

test("the transition table matches the database's", () => {
  assert.ok(canTransition("SUBMISSION_UNKNOWN", "SUBMISSION_PENDING"));
  assert.ok(!canTransition("DRAFT", "SUBMISSION_PENDING"));
  assert.ok(!canTransition("RECEIVED_BY_RESTAURANT", "DRAFT"));
  assert.ok(!canTransition("CANCELLED", "DRAFT"));
});
