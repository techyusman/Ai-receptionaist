import "server-only";
import {
  accept as acceptOrderRule,
  addDays,
  applyChange,
  callerClaim,
  cancel as cancelOrderRule,
  confirm as confirmRule,
  createDraft,
  abandon,
  findOverlaps,
  freshness,
  isOpenAt,
  itemAvailability,
  localClock,
  readyForConfirmation,
  searchMenu,
  startSubmission,
  submissionSucceeded,
  subtotal,
  taxOn,
  toOrderLine,
  validateSelection,
  IN_PROGRESS,
  type Menu,
  type Order,
  type Problem,
  type Result,
  type Selection,
  type Shift,
} from "@receptionist/domain";
import type {
  Alert,
  Analytics,
  AuditEntry,
  AvailableNumber,
  Callback,
  CallDetail,
  CallOutcome,
  CallSummary,
  Faq,
  Feasibility,
  Hours,
  Integration,
  Invitation,
  LiveEvent,
  Location,
  Member,
  MenuStatus,
  Notice,
  OrderDetail,
  OrderingMode,
  OrderSummary,
  Page,
  PhoneNumber,
  Pronunciation,
  Role,
  Session,
  Settings,
  SetupTask,
  SpecialHours,
  SquareLocationOption,
  TransferTarget,
} from "@/data/types";
import { can, type Capability } from "@/lib/permissions";
import { Forbidden, requireCan, requireSession } from "../auth";
import { emit, store, type State, type StoredEvent } from "./store";

/* Helpers --------------------------------------------------------------------- */

export class InputError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "InputError";
    this.field = field;
  }
}

const now = () => new Date();
const iso = () => now().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
const PAGE = 25;

function loc(state: State, s: Session): Location {
  const l = state.locations.find((x) => x.id === s.location.id);
  if (!l) throw new Error("Location not found");
  return l;
}

function audit(s: Session, action: string, target: string, summary: string) {
  store().state.audit.unshift({ id: newId("au"), at: iso(), actorName: s.user.name, actorType: "USER", action, target, summary });
}

function signal(s: Session, e: LiveEvent) {
  emit(s.location.id, e);
}

async function ctx(capability?: Capability) {
  const s = capability ? await requireCan(capability) : await requireSession();
  return { s, state: store().state };
}

function paginate<T>(rows: T[], cursor?: string | null): Page<T> {
  const start = cursor ? Number(cursor) || 0 : 0;
  const items = rows.slice(start, start + PAGE);
  return { items, total: rows.length, nextCursor: start + PAGE < rows.length ? String(start + PAGE) : null };
}

export type Range = "today" | "7d" | "30d" | "all";

function inRange(isoTime: string, range: Range, tz: string): boolean {
  if (range === "all") return true;
  const today = localClock(now(), tz).date;
  const day = localClock(new Date(isoTime), tz).date;
  const days = range === "today" ? 0 : range === "7d" ? 6 : 29;
  return day >= addDays(today, -days) && day <= today;
}

/* Session and setup ----------------------------------------------------------- */

export async function getSessionInfo(): Promise<Session> {
  return requireSession();
}

export async function getSetupTasks(): Promise<SetupTask[]> {
  const { s, state } = await ctx();
  const L = s.location.id;
  const faqs = state.faqs[L] ?? [];
  const integration = state.integrations[L];
  const location = loc(state, s);
  const live = faqs.filter((f) => f.active && f.reviewed).length;
  return [
    { id: "number", title: "Get an AI phone number", detail: "Callers reach the AI on this number.", done: (state.phoneNumbers[L] ?? []).some((p) => p.enabled), href: "/agent/phone" },
    { id: "square", title: "Connect Square", detail: "The AI reads your menu and prices from Square.", done: integration?.status === "CONNECTED" && !!integration.posLocationId, href: "/square" },
    { id: "hours", title: "Set your opening hours", detail: "The AI only takes orders while you're open.", done: (state.hours[L]?.store.length ?? 0) > 0, href: "/location" },
    { id: "transfer", title: "Add a transfer number", detail: "Where calls go when someone asks for a person.", done: (state.transferTargets[L] ?? []).some((t) => t.enabled), href: "/agent/transfers" },
    { id: "faqs", title: "Answer at least 10 common questions", detail: `${live} of 10 so far. Parking, allergies, Wi-Fi, that kind of thing.`, done: live >= 10, href: "/knowledge" },
    { id: "orders", title: "Decide where phone orders go", detail: location.orderingMode === "DISABLED" ? "Ordering is off until you choose." : "Done. You can change it any time.", done: location.orderingMode !== "DISABLED", href: "/agent/orders" },
    { id: "test", title: "Place a test order", detail: "Walk an order through the AI's steps before callers do.", done: state.orders.some((o) => o.isTest && o.locationId === L), href: "/agent/test" },
  ];
}

/* Location, settings, phone, transfers, hours ---------------------------------- */

export async function getLocation(): Promise<Location> {
  const { s, state } = await ctx();
  return loc(state, s);
}

export async function updateLocation(patch: Partial<Pick<Location, "name" | "timezone" | "address" | "directions" | "publicPhone" | "website">>) {
  const { s, state } = await ctx("settings.edit");
  const l = loc(state, s);
  if (patch.name !== undefined && !patch.name.trim()) throw new InputError("Give the location a name.", "name");
  Object.assign(l, patch);
  audit(s, "location.update", l.name, "Updated location details.");
  signal(s, { type: "settings" });
}

export async function getSettings(): Promise<Settings> {
  const { s, state } = await ctx();
  return structuredClone(state.settings[s.location.id]!);
}

const privacyKeys = ["recordingEnabled", "transcriptEnabled", "retentionDays"] as const;

export async function updateSettings(patch: Partial<Omit<Settings, "updatedAt">>): Promise<Settings> {
  const { s, state } = await ctx("settings.edit");
  if (privacyKeys.some((k) => k in patch) && !can(s.role, "privacy.edit")) throw new Forbidden("privacy.edit");
  const current = state.settings[s.location.id]!;
  const next = { ...current, ...patch, updatedAt: iso() };
  if (next.greeting.trim().length < 10) throw new InputError("The greeting needs at least 10 characters.", "greeting");
  if (next.extraLanguages.length > 1) throw new InputError("Use at most one extra language; more makes the AI less accurate.", "extraLanguages");
  state.settings[s.location.id] = next;
  const changed = Object.keys(patch).join(", ");
  audit(s, "settings.update", "AI agent", `Changed ${changed}.`);
  signal(s, { type: "settings" });
  return structuredClone(next);
}

export async function setOrdering(input: { mode: OrderingMode; feasibility: Feasibility; note: string | null }) {
  const { s, state } = await ctx("ordering.mode");
  const l = loc(state, s);
  if (input.mode === "SQUARE" && input.feasibility !== "VERIFIED_NATIVE") {
    throw new InputError("Square ordering needs the Square test to pass and be signed off first.", "mode");
  }
  if (input.mode === "DASHBOARD_TICKET" && input.feasibility !== "VERIFIED_NATIVE" && input.feasibility !== "FALLBACK_APPROVED") {
    throw new InputError("Live orders needs the restaurant's written approval recorded first.", "mode");
  }
  const changedSignOff = input.feasibility !== l.feasibility;
  Object.assign(l, {
    orderingMode: input.mode,
    feasibility: input.feasibility,
    feasibilityNote: input.note,
    ...(changedSignOff ? { feasibilitySignedOffBy: s.user.name, feasibilitySignedOffAt: iso() } : {}),
  });
  audit(s, "ordering.mode", l.name, `Phone orders: ${input.mode.toLowerCase().replace("_", " ")}; sign-off: ${input.feasibility.toLowerCase().replace("_", " ")}.`);
  signal(s, { type: "settings" });
}

export async function getPhoneNumbers(): Promise<PhoneNumber[]> {
  const { s, state } = await ctx();
  return structuredClone(state.phoneNumbers[s.location.id] ?? []);
}

export async function searchNumbers(areaCode: string): Promise<AvailableNumber[]> {
  await ctx("numbers.buy");
  if (!/^[2-9]\d{2}$/.test(areaCode)) throw new InputError("Enter a three-digit US area code.", "areaCode");
  if (areaCode === "999") return [];
  const owned = new Set(Object.values(store().state.phoneNumbers).flat().map((p) => p.e164));
  return [37, 58, 64, 81, 93]
    .map((n) => ({ e164: `+1${areaCode}55501${n}`, locality: "Sample locality" }))
    .filter((n) => !owned.has(n.e164));
}

export async function buyNumber(e164: string): Promise<PhoneNumber> {
  const { s, state } = await ctx("numbers.buy");
  if (!/^\+1\d{10}$/.test(e164)) throw new InputError("Pick a number from the list.", "e164");
  const list = (state.phoneNumbers[s.location.id] ??= []);
  if (list.some((p) => p.e164 === e164 && p.enabled)) throw new InputError("You already have that number.", "e164");
  const row: PhoneNumber = { id: newId("pn"), e164, purpose: "AI_INBOUND", enabled: true, fallbackE164: loc(state, s).publicPhone };
  list.push(row);
  audit(s, "numbers.buy", e164, "Added an AI phone number.");
  return row;
}

export async function getTransferTargets(): Promise<TransferTarget[]> {
  const { s, state } = await ctx();
  return structuredClone(state.transferTargets[s.location.id] ?? []);
}

export async function saveTransferTarget(input: Omit<TransferTarget, "id"> & { id?: string }) {
  const { s, state } = await ctx("settings.edit");
  const aiNumbers = (state.phoneNumbers[s.location.id] ?? []).map((p) => p.e164);
  if (aiNumbers.includes(input.e164)) throw new InputError("That's your AI number. Transfers to it would loop back to the AI.", "e164");
  if (!input.label.trim()) throw new InputError("Give this number a name staff will recognise.", "label");
  const list = (state.transferTargets[s.location.id] ??= []);
  if (input.id) {
    const row = list.find((t) => t.id === input.id);
    if (!row) throw new InputError("That transfer number no longer exists.");
    Object.assign(row, input);
  } else {
    list.push({ ...input, id: newId("tt") });
  }
  audit(s, "transfers.save", input.label, `Saved transfer number ${input.label}.`);
}

export async function deleteTransferTarget(id: string) {
  const { s, state } = await ctx("settings.edit");
  const list = state.transferTargets[s.location.id] ?? [];
  const row = list.find((t) => t.id === id);
  state.transferTargets[s.location.id] = list.filter((t) => t.id !== id);
  if (row) audit(s, "transfers.delete", row.label, `Removed transfer number ${row.label}.`);
}

export async function getHours(): Promise<Hours> {
  const { s, state } = await ctx();
  return structuredClone(state.hours[s.location.id] ?? { store: [], ordering: [] });
}

export async function putHours(hours: Hours) {
  const { s, state } = await ctx("settings.edit");
  for (const [kind, shifts] of Object.entries(hours) as [keyof Hours, Shift[]][]) {
    const overlaps = findOverlaps(shifts);
    if (overlaps.length) throw new InputError(overlaps[0]!.message, kind);
  }
  state.hours[s.location.id] = structuredClone(hours);
  audit(s, "hours.update", "Opening hours", "Updated the weekly hours.");
  signal(s, { type: "settings" });
}

export async function getSpecialHours(): Promise<SpecialHours[]> {
  const { s, state } = await ctx();
  return structuredClone(state.specialHours[s.location.id] ?? []).sort((a, b) => a.date.localeCompare(b.date));
}

export async function addSpecialHours(input: Omit<SpecialHours, "id">) {
  const { s, state } = await ctx("settings.edit");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new InputError("Pick a date.", "date");
  if (!input.closed && (!input.opens || !input.closes)) throw new InputError("Add opening and closing times, or mark the day closed.", "opens");
  (state.specialHours[s.location.id] ??= []).push({ ...input, id: newId("sh") });
  audit(s, "hours.special", input.date, input.closed ? `Closed on ${input.date}.` : `Special hours on ${input.date}.`);
}

export async function deleteSpecialHours(id: string) {
  const { s, state } = await ctx("settings.edit");
  state.specialHours[s.location.id] = (state.specialHours[s.location.id] ?? []).filter((x) => x.id !== id);
}

export async function getNotices(): Promise<Notice[]> {
  const { s, state } = await ctx();
  return structuredClone(state.notices[s.location.id] ?? []);
}

/** Is the location open for orders right now, in its own time zone? */
export async function getOpenState(): Promise<{ storeOpen: boolean; orderingOpen: boolean; today: string }> {
  const { s, state } = await ctx();
  const l = loc(state, s);
  const hours = state.hours[l.id] ?? { store: [], ordering: [] };
  const specials = state.specialHours[l.id] ?? [];
  const at = now();
  return {
    storeOpen: isOpenAt(hours.store, specials, at, l.timezone),
    orderingOpen: isOpenAt(hours.ordering.length ? hours.ordering : hours.store, specials, at, l.timezone),
    today: localClock(at, l.timezone).date,
  };
}

/* Knowledge ------------------------------------------------------------------- */

export async function getFaqs(): Promise<Faq[]> {
  const { s, state } = await ctx();
  return structuredClone(state.faqs[s.location.id] ?? []);
}

export async function saveFaq(input: Pick<Faq, "question" | "answer" | "aliases" | "active" | "validFrom" | "validUntil"> & { id?: string }) {
  const { s, state } = await ctx("knowledge.edit");
  if (input.question.trim().length < 3) throw new InputError("Write the question the way a caller would ask it.", "question");
  if (!input.answer.trim()) throw new InputError("Add the answer the AI should give.", "answer");
  if (input.validFrom && input.validUntil && input.validUntil <= input.validFrom) {
    throw new InputError("The end date must be after the start date.", "validUntil");
  }
  const list = (state.faqs[s.location.id] ??= []);
  const same = (q: string) => q.trim().toLowerCase().replace(/[?.!\s]+$/, "");
  if (list.some((f) => f.id !== input.id && same(f.question) === same(input.question))) {
    throw new InputError("You already have this question. Edit that one instead, so the AI has one answer.", "question");
  }
  if (input.id) {
    const row = list.find((f) => f.id === input.id);
    if (!row) throw new InputError("That question no longer exists.");
    Object.assign(row, input, { updatedAt: iso(), reviewed: true });
    audit(s, "faqs.update", "Knowledge", `Edited “${input.question}”.`);
  } else {
    list.unshift({ ...input, id: newId("faq"), source: "MANUAL", reviewed: true, updatedAt: iso() });
    audit(s, "faqs.create", "Knowledge", `Added “${input.question}”.`);
  }
}

export async function deleteFaq(id: string) {
  const { s, state } = await ctx("knowledge.edit");
  const list = state.faqs[s.location.id] ?? [];
  const row = list.find((f) => f.id === id);
  state.faqs[s.location.id] = list.filter((f) => f.id !== id);
  if (row) audit(s, "faqs.delete", "Knowledge", `Deleted “${row.question}”.`);
}

const starterFaqs: [string, string][] = [
  ["Do you have vegan options?", "[Which items are vegan, or how to ask for a swap.]"],
  ["Is there step-free access?", "[Entrance, ramps, accessible restroom.]"],
  ["Can I bring my laptop and work?", "[Your policy on laptops, outlets and time limits.]"],
  ["Do you sell gift cards?", "[Whether you sell them and where.]"],
  ["Can I order for a large group?", "[How far ahead, and who to call for catering.]"],
];

/** Adds our starter questions as inactive drafts: placeholders in [brackets] must be replaced. */
export async function addFaqTemplates(): Promise<number> {
  const { s, state } = await ctx("knowledge.edit");
  const list = (state.faqs[s.location.id] ??= []);
  const have = new Set(list.map((f) => f.question));
  const fresh = starterFaqs.filter(([q]) => !have.has(q));
  for (const [question, answer] of fresh) {
    list.push({ id: newId("faq"), question, answer, aliases: [], active: false, validFrom: null, validUntil: null, source: "TEMPLATE", reviewed: false, updatedAt: iso() });
  }
  audit(s, "faqs.templates", "Knowledge", `Added ${fresh.length} starter questions as drafts.`);
  return fresh.length;
}

export async function getPronunciations(): Promise<Pronunciation[]> {
  const { s, state } = await ctx();
  return structuredClone(state.pronunciations[s.location.id] ?? []);
}

export async function addPronunciation(term: string, spokenAs: string) {
  const { s, state } = await ctx("settings.edit");
  if (!term.trim() || !spokenAs.trim()) throw new InputError("Fill in both the word and how to say it.", "term");
  const list = (state.pronunciations[s.location.id] ??= []);
  if (list.some((p) => p.term.toLowerCase() === term.trim().toLowerCase())) throw new InputError("That word is already on the list.", "term");
  list.push({ id: newId("pr"), term: term.trim(), spokenAs: spokenAs.trim() });
}

export async function deletePronunciation(id: string) {
  const { s, state } = await ctx("settings.edit");
  state.pronunciations[s.location.id] = (state.pronunciations[s.location.id] ?? []).filter((p) => p.id !== id);
}

/* Square and menu ------------------------------------------------------------- */

export async function getIntegration(): Promise<Integration> {
  const { s, state } = await ctx();
  return structuredClone(
    state.integrations[s.location.id] ?? {
      provider: "SQUARE", status: "DISCONNECTED", environment: "SANDBOX", merchantName: null, posLocationId: null,
      posLocationName: null, scopes: [], lastSuccessAt: null, lastErrorCode: null, lastErrorAt: null, connectedBy: null,
    },
  );
}

export async function getSquareLocations(): Promise<SquareLocationOption[]> {
  const { state } = await ctx("square.connect");
  return structuredClone(state.squareLocations);
}

/** Fake OAuth: the real flow redirects to Square and back to /integrations/square/oauth/callback. */
export async function connectSquare(environment: "SANDBOX" | "PRODUCTION") {
  const { s, state } = await ctx("square.connect");
  state.integrations[s.location.id] = {
    provider: "SQUARE", status: "CONNECTED", environment, merchantName: "Third Space", posLocationId: null, posLocationName: null,
    scopes: ["ITEMS_READ", "ORDERS_READ", "ORDERS_WRITE", "MERCHANT_PROFILE_READ"],
    lastSuccessAt: iso(), lastErrorCode: null, lastErrorAt: null, connectedBy: s.user.name,
  };
  audit(s, "square.connect", s.location.name, `Connected Square (${environment.toLowerCase()}).`);
}

export async function chooseSquareLocation(posLocationId: string) {
  const { s, state } = await ctx("square.connect");
  const option = state.squareLocations.find((l) => l.id === posLocationId);
  const integration = state.integrations[s.location.id];
  if (!option || !integration || integration.status !== "CONNECTED") throw new InputError("Connect Square first, then pick a location.");
  Object.assign(integration, { posLocationId, posLocationName: option.name });
  audit(s, "square.location", s.location.name, `Linked Square location “${option.name}”.`);
  await resyncMenuAs(s);
}

export async function disconnectSquare() {
  const { s, state } = await ctx("square.disconnect");
  const integration = state.integrations[s.location.id];
  if (integration) Object.assign(integration, { status: "DISCONNECTED", posLocationId: null, posLocationName: null, scopes: [] });
  const l = loc(state, s);
  if (l.orderingMode === "SQUARE") l.orderingMode = "DISABLED";
  audit(s, "square.disconnect", l.name, "Disconnected Square. Square ordering was switched off.");
  signal(s, { type: "settings" });
}

async function resyncMenuAs(s: Session) {
  const { state } = store();
  const sync = state.menuSync[s.location.id]!;
  sync.state = "running";
  signal(s, { type: "menu" });
  // The fake sync "takes" a moment so the running state is visible.
  setTimeout(() => {
    const menu = state.menus[s.location.id];
    const at = iso();
    if (menu) menu.syncedAt = at;
    Object.assign(sync, { state: "fresh", lastSuccessAt: at, lastErrorCode: null });
    const integration = state.integrations[s.location.id];
    if (integration) integration.lastSuccessAt = at;
    state.audit.unshift({ id: newId("au"), at, actorName: "System", actorType: "SYSTEM", action: "menu.sync", target: s.location.name, summary: `Synced ${menu?.items.length ?? 0} items from Square.` });
    signal(s, { type: "menu" });
  }, 1500);
}

export async function resyncMenu() {
  const { s, state } = await ctx("square.connect");
  const integration = state.integrations[s.location.id];
  if (integration?.status !== "CONNECTED" || !integration.posLocationId) throw new InputError("Connect Square and pick a location before syncing.");
  if (state.menuSync[s.location.id]?.state === "running") return;
  await resyncMenuAs(s);
}

export async function getMenuStatus(): Promise<MenuStatus> {
  const { s, state } = await ctx();
  const sync = state.menuSync[s.location.id] ?? { state: "failed", lastSuccessAt: null, lastErrorCode: "NOT_CONNECTED" };
  const maxAge = state.settings[s.location.id]?.menuStaleMaxAgeSeconds ?? 3600;
  const stale = sync.state === "fresh" && freshness(sync.lastSuccessAt, maxAge, now()) === "stale";
  return {
    state: stale ? "stale" : sync.state,
    lastSuccessAt: sync.lastSuccessAt,
    lastErrorCode: sync.lastErrorCode,
    itemCount: state.menus[s.location.id]?.items.filter((i) => !i.deleted).length ?? 0,
  };
}

export async function getMenu(): Promise<Menu> {
  const { s, state } = await ctx();
  return structuredClone(state.menus[s.location.id]!);
}

export async function setItemOverlay(itemId: string, patch: { aiHidden?: boolean; aiUnavailableUntil?: string | null }) {
  const { s, state } = await ctx("menu.overlay");
  const item = state.menus[s.location.id]?.items.find((i) => i.id === itemId);
  if (!item) throw new InputError("That item isn't on the menu any more.");
  Object.assign(item, patch);
  const what = patch.aiHidden !== undefined ? (patch.aiHidden ? "Hid from the AI" : "Showed to the AI") : patch.aiUnavailableUntil ? "Marked unavailable" : "Marked available";
  audit(s, "menu.overlay", item.name, `${what}: ${item.name}.`);
  signal(s, { type: "menu" });
}

export async function addAlias(itemId: string, phrase: string) {
  const { s, state } = await ctx("menu.overlay");
  const menu = state.menus[s.location.id]!;
  const item = menu.items.find((i) => i.id === itemId);
  const p = phrase.trim();
  if (!item) throw new InputError("That item isn't on the menu any more.");
  if (p.length < 2 || p.length > 80) throw new InputError("Use 2 to 80 characters.", "phrase");
  const clash = menu.items.find((i) => i.aliases.some((a) => a.toLowerCase() === p.toLowerCase()) || i.name.toLowerCase() === p.toLowerCase());
  if (clash) throw new InputError(clash.id === item.id ? "That's already on this item." : `“${p}” already means ${clash.name}.`, "phrase");
  item.aliases.push(p);
  audit(s, "menu.alias", item.name, `Callers can say “${p}” for ${item.name}.`);
}

export async function removeAlias(itemId: string, phrase: string) {
  const { s, state } = await ctx("menu.overlay");
  const item = state.menus[s.location.id]?.items.find((i) => i.id === itemId);
  if (item) item.aliases = item.aliases.filter((a) => a !== phrase);
}

/* Orders ---------------------------------------------------------------------- */

const summarize = (o: Order): OrderSummary => ({
  id: o.id, status: o.status, posMode: o.posMode, isTest: o.isTest, createdAt: o.createdAt, pickupAt: o.pickupAt,
  currency: o.currency, totals: o.totals, customer: o.customer, lines: o.lines, posOrderId: o.posOrderId, callId: o.callId,
});

export type OrderView = "open" | "accepted" | "attention" | "all";

export async function listOrders(filter: { view?: OrderView; range?: Range; cursor?: string | null }): Promise<Page<OrderSummary>> {
  const { s, state } = await ctx("orders.view");
  const tz = loc(state, s).timezone;
  const view = filter.view ?? "all";
  const rows = state.orders.filter((o) => {
    if (o.locationId !== s.location.id) return false;
    if (!inRange(o.createdAt, filter.range ?? "all", tz)) return false;
    if (view === "open") return o.status === "SUBMITTED_TO_POS" || IN_PROGRESS.has(o.status);
    if (view === "accepted") return o.status === "RECEIVED_BY_RESTAURANT";
    if (view === "attention") return ["SUBMISSION_UNKNOWN", "POS_VISIBILITY_UNVERIFIED", "FAILED"].includes(o.status);
    return true;
  });
  const page = paginate(rows, filter.cursor);
  return { ...page, items: page.items.map(summarize) };
}

export async function countOrders(): Promise<Record<OrderView, number>> {
  const { s, state } = await ctx("orders.view");
  const mine = state.orders.filter((o) => o.locationId === s.location.id);
  return {
    open: mine.filter((o) => o.status === "SUBMITTED_TO_POS" || IN_PROGRESS.has(o.status)).length,
    accepted: mine.filter((o) => o.status === "RECEIVED_BY_RESTAURANT").length,
    attention: mine.filter((o) => ["SUBMISSION_UNKNOWN", "POS_VISIBILITY_UNVERIFIED", "FAILED"].includes(o.status)).length,
    all: mine.length,
  };
}

/** The Live orders board: tickets waiting for staff, anything uncertain, and the last half hour of accepted ones. */
export async function getLiveTickets(): Promise<OrderSummary[]> {
  const { s, state } = await ctx("orders.view");
  const cutoff = now().getTime() - 30 * 60_000;
  return state.orders
    .filter((o) => o.locationId === s.location.id)
    .filter(
      (o) =>
        ["SUBMITTED_TO_POS", "SUBMISSION_UNKNOWN", "POS_VISIBILITY_UNVERIFIED", "SUBMISSION_PENDING"].includes(o.status) ||
        (o.status === "RECEIVED_BY_RESTAURANT" && o.receivedAt && new Date(o.receivedAt).getTime() > cutoff),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(summarize);
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  const { s, state } = await ctx("orders.view");
  const o = state.orders.find((x) => x.id === id && x.locationId === s.location.id);
  if (!o) return null;
  const names = new Map(state.users.map((u) => [u.id, u.name]));
  return {
    ...structuredClone(o),
    events: (state.orderEvents[o.id] ?? []).map((e) => ({ ...e, actorName: e.actorUserId ? names.get(e.actorUserId) ?? null : null })),
    attempts: structuredClone(state.attempts[o.id] ?? []),
  };
}

function commit(s: Session, state: State, r: Result, actorUserId: string | null = null) {
  const i = state.orders.findIndex((o) => o.id === r.order.id);
  if (i >= 0) state.orders[i] = r.order;
  else state.orders.unshift(r.order);
  (state.orderEvents[r.order.id] ??= []).push(...r.events.map((e): StoredEvent => ({ ...e, actorUserId })));
  signal(s, { type: "order", id: r.order.id, status: r.order.status, isTest: r.order.isTest });
  return r.order;
}

export async function acceptOrder(id: string) {
  const { s, state } = await ctx("orders.accept");
  const o = state.orders.find((x) => x.id === id && x.locationId === s.location.id);
  if (!o) throw new InputError("That order no longer exists.");
  if (o.status === "RECEIVED_BY_RESTAURANT") return; // a double tap is harmless
  commit(s, state, acceptOrderRule(o, s.user.id, { actor: "STAFF", at: iso() }), s.user.id);
}

export async function cancelOrder(id: string, reason: string) {
  const { s, state } = await ctx("orders.manage");
  const o = state.orders.find((x) => x.id === id && x.locationId === s.location.id);
  if (!o) throw new InputError("That order no longer exists.");
  if (reason.trim().length < 3) throw new InputError("Say why, so the team knows later.", "reason");
  commit(s, state, cancelOrderRule(o, reason.trim(), { actor: "STAFF", at: iso() }), s.user.id);
  audit(s, "orders.cancel", o.customer.name ?? o.id, `Cancelled: ${reason.trim()}`);
}

/* Calls ----------------------------------------------------------------------- */

export type CallFilter = { outcome?: CallOutcome | "all"; transferred?: boolean; range?: Range; q?: string; cursor?: string | null };

function maskFor(s: Session, c: CallSummary): CallSummary {
  return can(s.role, "calls.fullPhone") ? c : { ...c, callerPhone: c.callerPhone ? `•••${c.callerPhone.slice(-4)}` : null };
}

export async function listCalls(filter: CallFilter): Promise<Page<CallSummary>> {
  const { s, state } = await ctx("calls.view");
  const tz = loc(state, s).timezone;
  const q = filter.q?.trim().toLowerCase();
  const rows = state.calls.filter((c) => {
    if (c.locationId !== s.location.id) return false;
    if (filter.outcome && filter.outcome !== "all" && c.outcome !== filter.outcome) return false;
    if (filter.transferred && !c.transferred) return false;
    if (!inRange(c.startedAt, filter.range ?? "all", tz)) return false;
    if (q && !`${c.summary ?? ""} ${c.callerName ?? ""} ${c.callerPhone ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const page = paginate(rows, filter.cursor);
  return {
    ...page,
    items: page.items.map(({ events: _e, transfers: _t, transcript: _x, transcriptsEnabled: _y, locationId: _l, ...c }) => maskFor(s, c)),
  };
}

export async function getCall(id: string): Promise<CallDetail | null> {
  const { s, state } = await ctx("calls.view");
  const c = state.calls.find((x) => x.id === id && x.locationId === s.location.id);
  if (!c) return null;
  const { locationId: _l, ...detail } = structuredClone(c);
  const transcripts = state.settings[s.location.id]?.transcriptEnabled ?? false;
  return {
    ...detail,
    ...maskFor(s, detail),
    transcriptsEnabled: transcripts,
    transcript: can(s.role, "calls.transcript") ? detail.transcript : null,
  };
}

/* Callbacks, alerts ------------------------------------------------------------ */

export async function listCallbacks(status: "OPEN" | "DONE" | "all" = "OPEN"): Promise<Callback[]> {
  const { s, state } = await ctx("calls.view");
  return state.callbacks
    .filter((c) => c.locationId === s.location.id && (status === "all" || c.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ locationId: _l, ...c }) => ({ ...c, phone: can(s.role, "calls.fullPhone") || c.status === "OPEN" ? c.phone : `•••${c.phone.slice(-4)}` }));
}

export async function updateCallback(id: string, status: "DONE" | "CANCELLED" | "OPEN") {
  const { s, state } = await ctx("callbacks.handle");
  const c = state.callbacks.find((x) => x.id === id && x.locationId === s.location.id);
  if (!c) throw new InputError("That callback no longer exists.");
  Object.assign(c, status === "OPEN" ? { status, handledBy: null, handledAt: null } : { status, handledBy: s.user.name, handledAt: iso() });
  signal(s, { type: "callback", id });
}

export async function listAlerts(): Promise<Alert[]> {
  const { s, state } = await ctx();
  return state.alerts
    .filter((a) => a.locationId === s.location.id && !a.acknowledgedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ locationId: _l, ...a }) => a);
}

export async function ackAlert(id: string) {
  const { s, state } = await ctx("callbacks.handle");
  const a = state.alerts.find((x) => x.id === id && x.locationId === s.location.id);
  if (a) a.acknowledgedAt = iso();
  signal(s, { type: "alert", id });
}

/* Analytics ------------------------------------------------------------------- */

export async function getAnalytics(range: "7d" | "30d"): Promise<Analytics> {
  const { s, state } = await ctx("analytics.view");
  const l = loc(state, s);
  const days = range === "7d" ? 7 : 30;
  const today = localClock(now(), l.timezone).date;
  const from = addDays(today, -(days - 1));
  const prevFrom = addDays(from, -days);
  const dayOf = (t: string) => localClock(new Date(t), l.timezone).date;
  const calls = state.calls.filter((c) => c.locationId === l.id && !c.isTest);
  const cur = calls.filter((c) => dayOf(c.startedAt) >= from);
  const prev = calls.filter((c) => dayOf(c.startedAt) >= prevFrom && dayOf(c.startedAt) < from);
  const orders = state.orders.filter((o) => o.locationId === l.id && !o.isTest && o.status === "RECEIVED_BY_RESTAURANT");
  const curOrders = orders.filter((o) => dayOf(o.createdAt) >= from);
  const prevOrders = orders.filter((o) => dayOf(o.createdAt) >= prevFrom && dayOf(o.createdAt) < from);
  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
  const minutes = Math.round(cur.reduce((m, c) => m + (c.durationSeconds ?? 0), 0) / 60);
  const byDay = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, calls: cur.filter((c) => dayOf(c.startedAt) === date).length, orders: curOrders.filter((o) => dayOf(o.createdAt) === date).length };
  });
  const outcomes = new Map<CallOutcome, number>();
  for (const c of cur) if (c.outcome) outcomes.set(c.outcome, (outcomes.get(c.outcome) ?? 0) + 1);
  const items = new Map<string, number>();
  for (const o of curOrders) for (const line of o.lines) items.set(line.itemName, (items.get(line.itemName) ?? 0) + line.quantity);
  return {
    range,
    calls: cur.length,
    callsPrev: prev.length,
    minutes,
    avgCallSeconds: cur.length ? Math.round(cur.reduce((m, c) => m + (c.durationSeconds ?? 0), 0) / cur.length) : 0,
    transferredPct: pct(cur.filter((c) => c.transferred).length, cur.length),
    transferredPctPrev: pct(prev.filter((c) => c.transferred).length, prev.length),
    orders: curOrders.length,
    ordersPrev: prevOrders.length,
    orderValueMinor: curOrders.reduce((m, o) => m + (o.totals?.totalMinor ?? 0), 0),
    conversionPct: pct(curOrders.length, cur.length),
    byDay,
    outcomes: [...outcomes].map(([outcome, count]) => ({ outcome, count })).sort((a, b) => b.count - a.count),
    topItems: [...items].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

/* Team and audit --------------------------------------------------------------- */

export async function listMembers(): Promise<{ members: Member[]; invitations: Invitation[] }> {
  const { s, state } = await ctx("members.view");
  const members = state.memberships
    .filter((m) => m.restaurantId === s.restaurant.id)
    .map((m): Member => {
      const u = state.users.find((x) => x.id === m.userId)!;
      const scope = m.locationId ? state.locations.find((l) => l.id === m.locationId)?.name ?? "Unknown location" : "ALL_LOCATIONS";
      return { membershipId: m.id, userId: u.id, name: u.name, email: u.email, role: m.role, scope, status: m.status, lastSeenAt: u.lastSeenAt };
    });
  return { members, invitations: state.invitations.map(({ locationId: _l, ...i }) => i) };
}

export async function invite(email: string, role: "MANAGER" | "STAFF") {
  const { s, state } = await ctx("members.manage");
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new InputError("Enter a valid email address.", "email");
  if (state.users.some((u) => u.email === e)) throw new InputError("That person is already on the team.", "email");
  if (state.invitations.some((i) => i.email === e)) throw new InputError("There's already an open invite for that email.", "email");
  state.invitations.push({ id: newId("inv"), email: e, role, invitedBy: s.user.name, expiresAt: new Date(now().getTime() + 7 * 86_400_000).toISOString(), createdAt: iso(), locationId: role === "STAFF" ? s.location.id : null });
  audit(s, "members.invite", e, `Invited ${e} as ${role.toLowerCase()}.`);
}

export async function revokeInvitation(id: string) {
  const { s, state } = await ctx("members.manage");
  const inv = state.invitations.find((i) => i.id === id);
  state.invitations = state.invitations.filter((i) => i.id !== id);
  if (inv) audit(s, "members.invite_revoke", inv.email, `Cancelled the invite for ${inv.email}.`);
}

export async function changeMember(membershipId: string, change: { role?: Role; revoke?: boolean }) {
  const { s, state } = await ctx("members.manage");
  const m = state.memberships.find((x) => x.id === membershipId && x.restaurantId === s.restaurant.id);
  if (!m) throw new InputError("That person isn't on the team.");
  if (m.userId === s.user.id) throw new InputError("You can't change your own access. Ask another owner.");
  if (m.role === "OWNER" || change.role === "OWNER") throw new InputError("Ownership moves through support, not here.");
  const name = state.users.find((u) => u.id === m.userId)?.name ?? "Member";
  if (change.revoke) {
    m.status = "REVOKED";
    audit(s, "members.revoke", name, `Removed ${name}'s access.`);
  } else if (change.role) {
    m.role = change.role;
    audit(s, "members.role", name, `Made ${name} ${change.role.toLowerCase()}.`);
  }
}

export async function getAudit(cursor?: string | null): Promise<Page<AuditEntry>> {
  const { state } = await ctx("audit.view");
  const rows = [...state.audit].sort((a, b) => b.at.localeCompare(a.at));
  return paginate(rows, cursor);
}

/* Test agent: the voice tools, driven by hand (S22) ------------------------------ */
// Each step calls the same domain rules the voice agent will use, so the vertical slice proves the
// order flow end to end before Twilio and the model exist.

export type TestCandidate = { itemId: string; name: string; matched: string; variations: { id: string; name: string; priceMinor: number }[] };

export async function testSearch(query: string): Promise<TestCandidate[]> {
  const { s, state } = await ctx("agent.test");
  const menu = state.menus[s.location.id]!;
  return searchMenu(menu, query, now()).map((c) => ({
    itemId: c.item.id,
    name: c.item.name,
    matched: c.matched,
    variations: c.item.variations.filter((v) => !v.deleted && !v.soldOut && v.priceMinor !== null).map((v) => ({ id: v.id, name: v.name, priceMinor: v.priceMinor! })),
  }));
}

export async function testStart(): Promise<string> {
  const { s, state } = await ctx("agent.test");
  const l = loc(state, s);
  const callId = newId("call");
  state.calls.unshift({
    id: callId, locationId: l.id, startedAt: iso(), durationSeconds: null, callerPhone: "+12125550100", callerName: null,
    outcome: null, status: "IN_PROGRESS", summary: "Test call from the dashboard.", orderId: null, transferred: false, isTest: true,
    events: [{ at: iso(), type: "call.started", actor: "SYSTEM", detail: `Test call started by ${s.user.name}` }],
    transfers: [], transcript: null, transcriptsEnabled: false,
  });
  const r = createDraft({
    id: newId("ord"), locationId: l.id, callId, isTest: true, posMode: "DASHBOARD_TICKET", currency: l.currency,
    idempotencyKey: crypto.randomUUID(), ctx: { actor: "AI", at: iso() },
  });
  commit(s, state, r);
  state.calls[0]!.orderId = r.order.id;
  signal(s, { type: "call", id: callId });
  return r.order.id;
}

function testOrder(state: State, s: Session, orderId: string): Order {
  const o = state.orders.find((x) => x.id === orderId && x.locationId === s.location.id && x.isTest);
  if (!o) throw new InputError("That test order has ended. Start a new one.");
  return o;
}

function callEvent(state: State, o: Order, type: string, detail: string) {
  state.calls.find((c) => c.id === o.callId)?.events.push({ at: iso(), type, actor: "AI", detail });
}

export async function testAddLine(orderId: string, sel: Selection): Promise<{ problems: Problem[] }> {
  const { s, state } = await ctx("agent.test");
  const o = testOrder(state, s, orderId);
  const menu = state.menus[s.location.id]!;
  const problems = validateSelection(menu, sel, now());
  if (problems.length) return { problems };
  const line = toOrderLine(menu, sel);
  commit(s, state, applyChange(o, { op: "add", line }, { actor: "AI", at: iso(), expectedVersion: o.version }));
  callEvent(state, o, "tool.update_order_draft", `Added ${line.quantity} × ${line.itemName} (${line.variationName})`);
  return { problems: [] };
}

export async function testRemoveLine(orderId: string, lineNo: number) {
  const { s, state } = await ctx("agent.test");
  const o = testOrder(state, s, orderId);
  commit(s, state, applyChange(o, { op: "remove", lineNo }, { actor: "AI", at: iso() }));
  callEvent(state, o, "tool.update_order_draft", `Removed line ${lineNo}`);
}

export async function testSetCustomer(orderId: string, name: string, phone: string) {
  const { s, state } = await ctx("agent.test");
  const o = testOrder(state, s, orderId);
  const digits = phone.replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  if (!name.trim()) throw new InputError("Ask for the caller's name.", "name");
  if (!e164) throw new InputError("That isn't a 10-digit US number. Read it back digit by digit.", "phone");
  commit(s, state, applyChange(o, { op: "customer", customer: { name: name.trim(), phone: e164, phoneSource: "SPOKEN" } }, { actor: "AI", at: iso() }));
}

/** Stands in for Square CalculateOrder: menu prices plus the location's tax rate. */
export async function testReadBack(orderId: string) {
  const { s, state } = await ctx("agent.test");
  const o = testOrder(state, s, orderId);
  const l = loc(state, s);
  const menu = state.menus[l.id]!;
  const maxAge = state.settings[l.id]?.menuStaleMaxAgeSeconds ?? 3600;
  if (freshness(menu.syncedAt, maxAge, now()) === "stale") throw new InputError("The menu is out of date, so the AI won't take orders until it syncs.");
  const gone = o.lines.find((line) => {
    const item = menu.items.find((i) => i.id === line.itemId);
    return !item || !itemAvailability(item, now()).orderable;
  });
  if (gone) throw new InputError(`${gone.itemName} just became unavailable. Remove it and offer something else.`);
  const sub = subtotal(o);
  const tax = taxOn(sub, l.taxRatePercent);
  commit(s, state, readyForConfirmation(o, { subtotalMinor: sub, taxMinor: tax, totalMinor: sub + tax, version: o.version, calculatedAt: iso(), source: "ESTIMATE" }, 0, { actor: "AI", at: iso() }));
  callEvent(state, o, "tool.calculate_order_total", "Read the order back with the total");
}

export async function testConfirm(orderId: string, version: number) {
  const { s, state } = await ctx("agent.test");
  const o = testOrder(state, s, orderId);
  commit(s, state, confirmRule(o, version, { actor: "AI", at: iso() }));
  callEvent(state, o, "tool.mark_customer_confirmation", `Caller confirmed version ${version}`);
}

/** DashboardTicketAdapter: "submitting" puts the ticket on the Live orders board. */
export async function testSubmit(orderId: string) {
  const { s, state } = await ctx("agent.test");
  let o = testOrder(state, s, orderId);
  o = commit(s, state, startSubmission(o, { actor: "SYSTEM", at: iso() }));
  (state.attempts[o.id] ??= []).push({ attemptNo: o.submissionAttempts, startedAt: iso(), outcome: "CREATED", httpStatus: null, idempotencyKey: o.idempotencyKey });
  o = commit(s, state, submissionSucceeded(o, { actor: "SYSTEM", at: iso() }));
  callEvent(state, o, "tool.submit_confirmed_order", "Sent to Live orders");
  const call = state.calls.find((c) => c.id === o.callId);
  if (call) Object.assign(call, { status: "ENDED", outcome: "ORDER_SUBMITTED", durationSeconds: Math.round((now().getTime() - new Date(call.startedAt).getTime()) / 1000), callerName: o.customer.name ?? null });
  return callerClaim(o);
}

export async function testHangUp(orderId: string) {
  const { s, state } = await ctx("agent.test");
  const o = testOrder(state, s, orderId);
  if (IN_PROGRESS.has(o.status) && o.status !== "SUBMISSION_PENDING" && o.status !== "SUBMISSION_UNKNOWN") {
    commit(s, state, abandon(o, { actor: "SYSTEM", at: iso(), reason: "Test caller hung up" }));
  }
  const call = state.calls.find((c) => c.id === o.callId);
  if (call && call.status !== "ENDED") Object.assign(call, { status: "ENDED", outcome: "CALLER_HUNG_UP", durationSeconds: Math.round((now().getTime() - new Date(call.startedAt).getTime()) / 1000) });
}

export async function getTestOrder(orderId: string): Promise<Order | null> {
  const { s, state } = await ctx("agent.test");
  const o = state.orders.find((x) => x.id === orderId && x.locationId === s.location.id && x.isTest);
  return o ? structuredClone(o) : null;
}
