// The order state machine (spec §9). Mirrors the database triggers in replica/schema.sql, so the
// rules hold even if a caller skips this module. Pure: every function returns a new order.

export const ORDER_STATUSES = [
  "DRAFT",
  "NEEDS_CLARIFICATION",
  "READY_FOR_CONFIRMATION",
  "CUSTOMER_CONFIRMED",
  "SUBMISSION_PENDING",
  "SUBMISSION_UNKNOWN",
  "SUBMITTED_TO_POS",
  "POS_VISIBILITY_UNVERIFIED",
  "RECEIVED_BY_RESTAURANT",
  "TRANSFERRED_TO_STAFF",
  "ABANDONED",
  "FAILED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const allowed: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["NEEDS_CLARIFICATION", "READY_FOR_CONFIRMATION", "TRANSFERRED_TO_STAFF", "ABANDONED", "CANCELLED", "FAILED"],
  NEEDS_CLARIFICATION: ["DRAFT", "READY_FOR_CONFIRMATION", "TRANSFERRED_TO_STAFF", "ABANDONED", "CANCELLED", "FAILED"],
  READY_FOR_CONFIRMATION: ["CUSTOMER_CONFIRMED", "DRAFT", "NEEDS_CLARIFICATION", "TRANSFERRED_TO_STAFF", "ABANDONED", "CANCELLED"],
  CUSTOMER_CONFIRMED: ["SUBMISSION_PENDING", "DRAFT", "NEEDS_CLARIFICATION", "TRANSFERRED_TO_STAFF", "ABANDONED", "CANCELLED"],
  SUBMISSION_PENDING: ["SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED", "SUBMISSION_UNKNOWN", "NEEDS_CLARIFICATION", "FAILED"],
  SUBMISSION_UNKNOWN: ["SUBMISSION_PENDING", "SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED", "FAILED"],
  SUBMITTED_TO_POS: ["RECEIVED_BY_RESTAURANT", "POS_VISIBILITY_UNVERIFIED", "CANCELLED"],
  POS_VISIBILITY_UNVERIFIED: ["RECEIVED_BY_RESTAURANT", "CANCELLED"],
  RECEIVED_BY_RESTAURANT: ["CANCELLED"],
  TRANSFERRED_TO_STAFF: ["CANCELLED"],
  ABANDONED: [],
  FAILED: [],
  CANCELLED: [],
};

/** Content (lines, customer, notes) can no longer change once the order reaches one of these. */
export const FROZEN: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "SUBMISSION_PENDING",
  "SUBMISSION_UNKNOWN",
  "SUBMITTED_TO_POS",
  "POS_VISIBILITY_UNVERIFIED",
  "RECEIVED_BY_RESTAURANT",
  "TRANSFERRED_TO_STAFF",
  "ABANDONED",
  "FAILED",
  "CANCELLED",
]);

/** Still being built on the call; at most one of these per call. */
export const IN_PROGRESS: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "DRAFT",
  "NEEDS_CLARIFICATION",
  "READY_FOR_CONFIRMATION",
  "CUSTOMER_CONFIRMED",
  "SUBMISSION_PENDING",
  "SUBMISSION_UNKNOWN",
]);

export const TERMINAL: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["ABANDONED", "FAILED", "CANCELLED"]);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || allowed[from].includes(to);
}

export type PosMode = "SQUARE" | "DASHBOARD_TICKET";
export type Actor = "SYSTEM" | "AI" | "STAFF" | "SUPPORT" | "WEBHOOK";

export type ModifierChoice = {
  modifierId: string;
  listId: string;
  name: string;
  priceMinor: number;
  quantity: number;
  parentModifierId?: string;
};

export type OrderLine = {
  lineNo: number;
  itemId: string;
  variationId: string;
  itemName: string;
  variationName: string;
  quantity: number;
  unitPriceMinor: number;
  modifiers: ModifierChoice[];
  note?: string;
};

export type Totals = {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** The order version these totals were calculated for. */
  version: number;
  calculatedAt: string;
  source: "SQUARE" | "ESTIMATE";
};

export type Customer = {
  name?: string;
  phone?: string;
  phoneSource?: "CALLER_ID_CONFIRMED" | "SPOKEN";
};

export type Order = {
  id: string;
  locationId: string;
  callId: string | null;
  isTest: boolean;
  posMode: PosMode;
  status: OrderStatus;
  version: number;
  confirmedVersion: number | null;
  confirmedAt: string | null;
  lines: OrderLine[];
  customer: Customer;
  pickupAt: string | null;
  note?: string;
  currency: string;
  totals: Totals | null;
  idempotencyKey: string;
  submissionAttempts: number;
  submittedAt: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  posOrderId: string | null;
  failedReason: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderEvent = {
  from: OrderStatus | null;
  to: OrderStatus;
  version: number;
  actor: Actor;
  reason?: string;
  at: string;
};

export type Result = { order: Order; events: OrderEvent[] };
export type Ctx = { actor: Actor; at: string; reason?: string };

export class OrderRuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OrderRuleError";
    this.code = code;
  }
}

function move(order: Order, to: OrderStatus, ctx: Ctx, patch: Partial<Order> = {}): Result {
  if (!canTransition(order.status, to)) {
    throw new OrderRuleError("BAD_TRANSITION", `An order can't go from ${order.status} to ${to}.`);
  }
  const next: Order = { ...order, ...patch, status: to, updatedAt: ctx.at };
  const events: OrderEvent[] =
    to === order.status ? [] : [{ from: order.status, to, version: next.version, actor: ctx.actor, reason: ctx.reason, at: ctx.at }];
  return { order: next, events };
}

export function createDraft(input: {
  id: string;
  locationId: string;
  callId: string | null;
  isTest: boolean;
  posMode: PosMode;
  currency: string;
  idempotencyKey: string;
  ctx: Ctx;
}): Result {
  if (input.isTest && input.posMode !== "DASHBOARD_TICKET") {
    throw new OrderRuleError("TEST_ORDER_TO_POS", "Test orders stay on the dashboard and never go to Square.");
  }
  const order: Order = {
    id: input.id,
    locationId: input.locationId,
    callId: input.callId,
    isTest: input.isTest,
    posMode: input.posMode,
    status: "DRAFT",
    version: 1,
    confirmedVersion: null,
    confirmedAt: null,
    lines: [],
    customer: {},
    pickupAt: null,
    currency: input.currency,
    totals: null,
    idempotencyKey: input.idempotencyKey,
    submissionAttempts: 0,
    submittedAt: null,
    receivedAt: null,
    receivedBy: null,
    posOrderId: null,
    failedReason: null,
    cancelledReason: null,
    createdAt: input.ctx.at,
    updatedAt: input.ctx.at,
  };
  return { order, events: [{ from: null, to: "DRAFT", version: 1, actor: input.ctx.actor, reason: input.ctx.reason, at: input.ctx.at }] };
}

export type DraftChange =
  | { op: "add"; line: Omit<OrderLine, "lineNo"> }
  | { op: "remove"; lineNo: number }
  | { op: "quantity"; lineNo: number; quantity: number }
  | { op: "modifiers"; lineNo: number; modifiers: ModifierChoice[]; unitPriceMinor?: number }
  | { op: "line-note"; lineNo: number; note: string | undefined }
  | { op: "customer"; customer: Customer }
  | { op: "pickup"; pickupAt: string | null }
  | { op: "note"; note: string | undefined };

const MAX_LINES = 100;

function checkQuantity(q: number) {
  if (!Number.isInteger(q) || q < 1 || q > 99) {
    throw new OrderRuleError("QUANTITY", "Quantity must be a whole number from 1 to 99.");
  }
}

function lineAt(order: Order, lineNo: number): OrderLine {
  const line = order.lines.find((l) => l.lineNo === lineNo);
  if (!line) throw new OrderRuleError("NO_SUCH_LINE", `There is no line ${lineNo} on this order.`);
  return line;
}

/**
 * Any edit bumps the version. An edit after read-back or confirmation sends the order back to
 * DRAFT, because the caller confirmed a different order. Pass expectedVersion from tool calls so a
 * replayed call fails with VERSION_CONFLICT instead of applying twice.
 */
export function applyChange(order: Order, change: DraftChange, ctx: Ctx & { expectedVersion?: number }): Result {
  if (FROZEN.has(order.status)) {
    throw new OrderRuleError("FROZEN", `This order is ${order.status}; its contents can no longer change.`);
  }
  if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== order.version) {
    throw new OrderRuleError("VERSION_CONFLICT", `Expected version ${ctx.expectedVersion}, order is at ${order.version}.`);
  }
  let lines = order.lines;
  let customer = order.customer;
  let pickupAt = order.pickupAt;
  let note = order.note;
  switch (change.op) {
    case "add": {
      if (lines.length >= MAX_LINES) throw new OrderRuleError("TOO_MANY_LINES", "An order can have at most 100 lines.");
      checkQuantity(change.line.quantity);
      const lineNo = lines.reduce((m, l) => Math.max(m, l.lineNo), 0) + 1;
      lines = [...lines, { ...change.line, lineNo }];
      break;
    }
    case "remove":
      lineAt(order, change.lineNo);
      lines = lines.filter((l) => l.lineNo !== change.lineNo);
      break;
    case "quantity":
      lineAt(order, change.lineNo);
      checkQuantity(change.quantity);
      lines = lines.map((l) => (l.lineNo === change.lineNo ? { ...l, quantity: change.quantity } : l));
      break;
    case "modifiers":
      lineAt(order, change.lineNo);
      lines = lines.map((l) =>
        l.lineNo === change.lineNo
          ? { ...l, modifiers: change.modifiers, unitPriceMinor: change.unitPriceMinor ?? l.unitPriceMinor }
          : l,
      );
      break;
    case "line-note":
      lineAt(order, change.lineNo);
      lines = lines.map((l) => (l.lineNo === change.lineNo ? { ...l, note: change.note } : l));
      break;
    case "customer":
      customer = { ...customer, ...change.customer };
      break;
    case "pickup":
      pickupAt = change.pickupAt;
      break;
    case "note":
      note = change.note;
      break;
  }
  const bumped: Order = { ...order, lines, customer, pickupAt, note, version: order.version + 1, updatedAt: ctx.at };
  if (order.status === "READY_FOR_CONFIRMATION" || order.status === "CUSTOMER_CONFIRMED") {
    return move(bumped, "DRAFT", { ...ctx, reason: ctx.reason ?? "Changed after read-back" });
  }
  return { order: bumped, events: [] };
}

/** Line total including modifiers, in minor units. */
export function lineTotal(line: OrderLine): number {
  const mods = line.modifiers.reduce((sum, m) => sum + m.priceMinor * m.quantity, 0);
  return (line.unitPriceMinor + mods) * line.quantity;
}

export function subtotal(order: Order): number {
  return order.lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

export function needsClarification(order: Order, ctx: Ctx): Result {
  return move(order, "NEEDS_CLARIFICATION", ctx);
}

/** Totals must be for this exact version, and the selection must have passed validation. */
export function readyForConfirmation(order: Order, totals: Totals, problemCount: number, ctx: Ctx): Result {
  if (problemCount > 0) throw new OrderRuleError("INVALID", "Fix the order's problems before reading it back.");
  if (order.lines.length === 0) throw new OrderRuleError("EMPTY", "There's nothing on the order yet.");
  if (totals.version !== order.version) {
    throw new OrderRuleError("STALE_TOTALS", "The totals are for an older version of this order.");
  }
  return move(order, "READY_FOR_CONFIRMATION", ctx, { totals });
}

/** The caller said yes to this exact version. */
export function confirm(order: Order, version: number, ctx: Ctx): Result {
  if (order.status !== "READY_FOR_CONFIRMATION") {
    throw new OrderRuleError("NOT_READ_BACK", "Read the order back before asking the caller to confirm.");
  }
  if (version !== order.version) {
    throw new OrderRuleError("STALE_CONFIRMATION", "The caller confirmed an older version of this order.");
  }
  return move(order, "CUSTOMER_CONFIRMED", ctx, { confirmedVersion: version, confirmedAt: ctx.at });
}

export function startSubmission(order: Order, ctx: Ctx): Result {
  if (order.status === "SUBMISSION_UNKNOWN") {
    // Retry with the same idempotency key and body; never a new key for an ambiguous attempt.
    return move(order, "SUBMISSION_PENDING", ctx, { submissionAttempts: order.submissionAttempts + 1 });
  }
  if (order.status !== "CUSTOMER_CONFIRMED" || order.confirmedVersion !== order.version) {
    throw new OrderRuleError("NOT_CONFIRMED", "Only an order the caller confirmed can be submitted.");
  }
  if (!order.totals || order.totals.version !== order.version) {
    throw new OrderRuleError("STALE_TOTALS", "The totals are for an older version of this order.");
  }
  if (!order.customer.name || !order.customer.phone) {
    throw new OrderRuleError("NO_CUSTOMER", "The order needs the caller's name and phone number.");
  }
  return move(order, "SUBMISSION_PENDING", ctx, { submissionAttempts: order.submissionAttempts + 1 });
}

export function submissionSucceeded(order: Order, ctx: Ctx, posOrderId?: string): Result {
  if (order.posMode === "SQUARE" && !posOrderId) {
    throw new OrderRuleError("NO_POS_ID", "A Square submission needs the Square order id.");
  }
  return move(order, "SUBMITTED_TO_POS", ctx, { submittedAt: ctx.at, posOrderId: posOrderId ?? null });
}

export function submissionUncertain(order: Order, ctx: Ctx): Result {
  return move(order, "SUBMISSION_UNKNOWN", ctx);
}

/** Square definitively rejected the request (a validation error): back to the caller to fix it. */
export function submissionRejected(order: Order, ctx: Ctx): Result {
  return move(order, "NEEDS_CLARIFICATION", ctx);
}

/** Only before submission. The database refuses a key change during or after one. */
export function rotateIdempotencyKey(order: Order, key: string): Order {
  if (order.status !== "DRAFT" && order.status !== "NEEDS_CLARIFICATION" &&
      order.status !== "READY_FOR_CONFIRMATION" && order.status !== "CUSTOMER_CONFIRMED") {
    throw new OrderRuleError("KEY_LOCKED", `The idempotency key can't change while the order is ${order.status}.`);
  }
  return { ...order, idempotencyKey: key };
}

export function accept(order: Order, staffUserId: string, ctx: Ctx): Result {
  return move(order, "RECEIVED_BY_RESTAURANT", ctx, { receivedAt: ctx.at, receivedBy: staffUserId });
}

export function cancel(order: Order, reason: string, ctx: Ctx): Result {
  return move(order, "CANCELLED", { ...ctx, reason }, { cancelledReason: reason });
}

export function fail(order: Order, reason: string, ctx: Ctx): Result {
  return move(order, "FAILED", { ...ctx, reason }, { failedReason: reason });
}

export function transferToStaff(order: Order, ctx: Ctx): Result {
  return move(order, "TRANSFERRED_TO_STAFF", ctx);
}

export function abandon(order: Order, ctx: Ctx): Result {
  return move(order, "ABANDONED", ctx);
}

/**
 * What the AI may tell the caller about this order. Never more optimistic than the verified state
 * (spec FR-ORDER-015): "received" only after the restaurant acknowledged it.
 */
export type CallerClaim = "NOT_PLACED" | "SENDING" | "UNCERTAIN" | "SENT_NOT_ACKNOWLEDGED" | "RECEIVED" | "STOPPED";

export function callerClaim(order: Order): CallerClaim {
  switch (order.status) {
    case "SUBMISSION_PENDING":
      return "SENDING";
    case "SUBMISSION_UNKNOWN":
    case "POS_VISIBILITY_UNVERIFIED":
      return "UNCERTAIN";
    case "SUBMITTED_TO_POS":
      return "SENT_NOT_ACKNOWLEDGED";
    case "RECEIVED_BY_RESTAURANT":
      return "RECEIVED";
    case "TRANSFERRED_TO_STAFF":
    case "ABANDONED":
    case "FAILED":
    case "CANCELLED":
      return "STOPPED";
    default:
      return "NOT_PLACED";
  }
}
