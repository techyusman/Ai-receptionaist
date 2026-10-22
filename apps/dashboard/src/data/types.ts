// Shapes the dashboard reads. They follow the API in replica/architecture.md, so the fake data layer
// (src/server/fake) and the real HTTP client return exactly these.

import type { Menu, Order, OrderEvent, Shift, SpecialDay } from "@receptionist/domain";

export type Role = "OWNER" | "MANAGER" | "STAFF" | "SUPPORT_LIMITED";

export type User = { id: string; email: string; name: string };

export type Session = {
  user: User;
  role: Role;
  restaurant: { id: string; name: string; slug: string };
  location: LocationSummary;
  locations: LocationSummary[];
};

export type LocationSummary = { id: string; name: string };

export type OrderingMode = "DISABLED" | "DASHBOARD_TICKET" | "SQUARE";
export type Feasibility = "UNVERIFIED" | "VERIFIED_NATIVE" | "FALLBACK_APPROVED" | "BLOCKED";

export type Location = {
  id: string;
  restaurantId: string;
  name: string;
  timezone: string;
  currency: string;
  taxRatePercent: number;
  address: { line1: string; line2?: string; city: string; region: string; postalCode: string; country: string };
  directions: string;
  publicPhone: string | null;
  website: string | null;
  status: "SETUP" | "LIVE" | "PAUSED";
  orderingMode: OrderingMode;
  feasibility: Feasibility;
  feasibilityNote: string | null;
  feasibilitySignedOffBy: string | null;
  feasibilitySignedOffAt: string | null;
};

export type AfterHoursMode = "INFO_ONLY" | "TAKE_CALLBACK" | "TRANSFER_FALLBACK";

export type Settings = {
  greeting: string;
  voice: string;
  primaryLanguage: string;
  extraLanguages: string[];
  orderingEnabled: boolean;
  pickupNotesEnabled: boolean;
  scheduledPickupEnabled: boolean;
  pickupPolicy: string;
  pickupEstimateMinutes: number | null;
  afterHoursMode: AfterHoursMode;
  ringStaffFirst: boolean;
  ringStaffSeconds: number;
  transferStrategy: "DIRECT" | "WARM";
  transferTimeoutSeconds: number;
  maxTransferAttempts: number;
  maxCallSeconds: number;
  silenceTimeoutSeconds: number;
  maxClarificationRetries: number;
  menuStaleMaxAgeSeconds: number;
  recordingEnabled: boolean;
  transcriptEnabled: boolean;
  retentionDays: number;
  updatedAt: string;
};

export type PhoneNumber = { id: string; e164: string; purpose: "AI_INBOUND" | "TEST"; enabled: boolean; fallbackE164: string | null };
export type AvailableNumber = { e164: string; locality: string };

export type TransferIntent = "GENERAL" | "CATERING" | "LARGE_PARTY" | "COMPLAINT" | "ALLERGEN";
export type TransferTarget = {
  id: string;
  label: string;
  e164: string;
  priority: number;
  intent: TransferIntent;
  activeHours: "ALWAYS" | "BUSINESS_HOURS";
  smsAlertOnMiss: boolean;
  enabled: boolean;
};

export type Hours = { store: Shift[]; ordering: Shift[] };
export type SpecialHours = SpecialDay & { id: string; note: string | null };
export type Notice = { id: string; message: string; startsAt: string; endsAt: string };

export type Faq = {
  id: string;
  question: string;
  aliases: string[];
  answer: string;
  active: boolean;
  validFrom: string | null;
  validUntil: string | null;
  source: "MANUAL" | "TEMPLATE" | "GENERATED";
  reviewed: boolean;
  updatedAt: string;
};

export type Pronunciation = { id: string; term: string; spokenAs: string };

export type Integration = {
  provider: "SQUARE";
  status: "CONNECTED" | "NEEDS_REAUTH" | "REVOKED" | "DISCONNECTED";
  environment: "SANDBOX" | "PRODUCTION";
  merchantName: string | null;
  posLocationId: string | null;
  posLocationName: string | null;
  scopes: string[];
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  connectedBy: string | null;
};

export type SquareLocationOption = { id: string; name: string; address: string };

export type MenuSyncState = "fresh" | "running" | "stale" | "failed";
export type MenuStatus = { state: MenuSyncState; lastSuccessAt: string | null; lastErrorCode: string | null; itemCount: number };
export type MenuView = Menu;

export type CallOutcome =
  | "INFO_RESOLVED"
  | "ORDER_SUBMITTED"
  | "TRANSFERRED"
  | "CALLER_HUNG_UP"
  | "FAILED"
  | "CALLBACK_REQUESTED"
  | "STAFF_ANSWERED";

export type TransferResult = "CONNECTED" | "NO_ANSWER" | "BUSY" | "FAILED" | "CANCELED";

export type CallSummary = {
  id: string;
  startedAt: string;
  durationSeconds: number | null;
  callerPhone: string | null;
  callerName: string | null;
  outcome: CallOutcome | null;
  status: "RINGING_STAFF" | "IN_PROGRESS" | "TRANSFERRING" | "ENDED";
  summary: string | null;
  orderId: string | null;
  transferred: boolean;
  isTest: boolean;
};

export type CallEvent = { at: string; type: string; actor: "SYSTEM" | "AI" | "CALLER" | "STAFF"; detail: string };
export type Transfer = { id: string; destination: string; label: string | null; reason: string; startedAt: string; result: TransferResult | null };
export type TranscriptTurn = { speaker: "CALLER" | "AI"; text: string; atMs: number };

export type CallDetail = CallSummary & {
  events: CallEvent[];
  transfers: Transfer[];
  transcript: TranscriptTurn[] | null;
  transcriptsEnabled: boolean;
};

export type SubmissionAttempt = {
  attemptNo: number;
  startedAt: string;
  outcome: "CREATED" | "TRANSIENT_ERROR" | "VALIDATION_ERROR" | "AUTH_ERROR" | "TIMEOUT" | "RATE_LIMITED" | "UNKNOWN" | null;
  httpStatus: number | null;
  idempotencyKey: string;
};

export type OrderSummary = Pick<
  Order,
  "id" | "status" | "posMode" | "isTest" | "createdAt" | "pickupAt" | "currency" | "totals" | "customer" | "lines" | "posOrderId" | "callId"
>;

export type OrderDetail = Order & { events: (OrderEvent & { actorName: string | null })[]; attempts: SubmissionAttempt[] };

export type Callback = {
  id: string;
  callId: string | null;
  customerName: string;
  phone: string;
  preferredWindow: string | null;
  reason: string | null;
  status: "OPEN" | "DONE" | "CANCELLED";
  createdAt: string;
  handledBy: string | null;
  handledAt: string | null;
};

export type AlertKind =
  | "ORDER_SUBMISSION_UNKNOWN"
  | "ORDER_FAILED"
  | "NEW_TICKET"
  | "CATALOG_STALE"
  | "CATALOG_SYNC_FAILED"
  | "POS_AUTH_EXPIRED"
  | "POS_REVOKED"
  | "TRANSFER_MISSED"
  | "CALLBACK_REQUESTED"
  | "VOICE_DEGRADED";

export type Alert = {
  id: string;
  kind: AlertKind;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  orderId: string | null;
  callId: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
};

export type Member = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  scope: "ALL_LOCATIONS" | string;
  status: "ACTIVE" | "REVOKED";
  lastSeenAt: string | null;
};

export type Invitation = { id: string; email: string; role: "MANAGER" | "STAFF"; invitedBy: string; expiresAt: string; createdAt: string };

export type AuditEntry = {
  id: string;
  at: string;
  actorName: string;
  actorType: "USER" | "SUPPORT" | "SYSTEM";
  action: string;
  target: string;
  summary: string;
};

export type SetupTask = { id: string; title: string; detail: string; done: boolean; href: string };

export type Analytics = {
  range: "7d" | "30d";
  calls: number;
  callsPrev: number;
  minutes: number;
  avgCallSeconds: number;
  transferredPct: number;
  transferredPctPrev: number;
  orders: number;
  ordersPrev: number;
  orderValueMinor: number;
  conversionPct: number;
  byDay: { date: string; calls: number; orders: number }[];
  outcomes: { outcome: CallOutcome; count: number }[];
  topItems: { name: string; count: number }[];
};

export type Page<T> = { items: T[]; nextCursor: string | null; total: number };

/** Live events pushed to the dashboard (SSE now, the API's SSE later). */
export type LiveEvent =
  | { type: "order"; id: string; status: string; isTest: boolean }
  | { type: "call"; id: string }
  | { type: "alert"; id: string }
  | { type: "callback"; id: string }
  | { type: "menu" }
  | { type: "settings" };
