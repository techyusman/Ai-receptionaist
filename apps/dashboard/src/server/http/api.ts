import "server-only";
import type { Order, Problem, Selection, Totals } from "@receptionist/domain";
import type {
  Alert, Analytics, AuditEntry, AvailableNumber, Callback, CallDetail, CallOutcome, CallSummary, Faq, Feasibility, Hours, Integration, Invitation,
  Location, Member, MenuStatus, MenuView, Notice, OrderDetail, OrderingMode, OrderSummary, Page, PhoneNumber, Pronunciation, Role, Session,
  Settings, SetupTask, SpecialHours, SquareLocationOption, TransferTarget,
} from "@/data/types";
import { requireSession } from "../auth";
import { del, get, isId, orNull, patch, post, put } from "./client";

export { InputError, UnavailableError } from "./client";

// The real data layer: the same functions, names and types the screens used with the fake one, each a
// call to the API as the signed-in person. Location-scoped calls use the location chosen in the header.

const loc = async () => (await requireSession()).location.id;
const rest = async () => (await requireSession()).restaurant.id;

export type Range = "today" | "7d" | "30d" | "all";

/* Session and setup ----------------------------------------------------------- */

export async function getSessionInfo(): Promise<Session> {
  return requireSession();
}
export async function getSetupTasks(): Promise<SetupTask[]> {
  return get(`/locations/${await loc()}/onboarding`);
}

/* Location, settings, phone, transfers, hours ---------------------------------- */

export async function getLocation(): Promise<Location> {
  return get(`/locations/${await loc()}`);
}
export async function updateLocation(patchBody: Partial<Pick<Location, "name" | "timezone" | "address" | "directions" | "publicPhone" | "website">>) {
  await patch(`/locations/${await loc()}`, patchBody);
}
export async function getSettings(): Promise<Settings> {
  return get(`/locations/${await loc()}/settings`);
}
export async function updateSettings(body: Partial<Omit<Settings, "updatedAt">>): Promise<Settings> {
  return patch(`/locations/${await loc()}/settings`, body);
}
export async function setOrdering(input: { mode: OrderingMode; feasibility: Feasibility; note: string | null }) {
  await patch(`/locations/${await loc()}/ordering`, input);
}
export async function getPhoneNumbers(): Promise<PhoneNumber[]> {
  return get(`/locations/${await loc()}/phone-numbers`);
}
export async function searchNumbers(areaCode: string): Promise<AvailableNumber[]> {
  return get(`/locations/${await loc()}/phone-numbers/available`, { areaCode });
}
export async function buyNumber(e164: string): Promise<PhoneNumber> {
  return post(`/locations/${await loc()}/phone-numbers`, { e164 });
}
export async function getTransferTargets(): Promise<TransferTarget[]> {
  return get(`/locations/${await loc()}/transfer-targets`);
}
export async function saveTransferTarget(input: Omit<TransferTarget, "id"> & { id?: string }) {
  const { id, ...body } = input;
  if (id) await put(`/transfer-targets/${id}`, body);
  else await post(`/locations/${await loc()}/transfer-targets`, body);
}
export async function deleteTransferTarget(id: string) {
  await del(`/transfer-targets/${id}`);
}
export async function getHours(): Promise<Hours> {
  return get(`/locations/${await loc()}/hours`);
}
export async function putHours(hours: Hours) {
  await put(`/locations/${await loc()}/hours`, hours);
}
export async function getSpecialHours(): Promise<SpecialHours[]> {
  return get(`/locations/${await loc()}/special-hours`);
}
export async function addSpecialHours(input: Omit<SpecialHours, "id">) {
  await post(`/locations/${await loc()}/special-hours`, input);
}
export async function deleteSpecialHours(id: string) {
  await del(`/special-hours/${id}`);
}
export async function getNotices(): Promise<Notice[]> {
  return get(`/locations/${await loc()}/notices`);
}
export async function getOpenState(): Promise<{ storeOpen: boolean; orderingOpen: boolean; today: string }> {
  return get(`/locations/${await loc()}/open-state`);
}

/* Knowledge ------------------------------------------------------------------- */

export async function getFaqs(): Promise<Faq[]> {
  return get(`/locations/${await loc()}/faqs`);
}
export async function saveFaq(input: Pick<Faq, "question" | "answer" | "aliases" | "active" | "validFrom" | "validUntil"> & { id?: string }) {
  const { id, ...body } = input;
  if (id) await put(`/faqs/${id}`, body);
  else await post(`/locations/${await loc()}/faqs`, body);
}
export async function deleteFaq(id: string) {
  await del(`/faqs/${id}`);
}
export async function addFaqTemplates(): Promise<number> {
  return (await post<{ added: number }>(`/locations/${await loc()}/faqs/templates`)).added;
}
export async function getPronunciations(): Promise<Pronunciation[]> {
  return get(`/locations/${await loc()}/pronunciations`);
}
export async function addPronunciation(term: string, spokenAs: string) {
  await post(`/locations/${await loc()}/pronunciations`, { term, spokenAs });
}
export async function deletePronunciation(id: string) {
  await del(`/pronunciations/${id}`);
}

/* Square and menu ------------------------------------------------------------- */

export async function getIntegration(): Promise<Integration> {
  return get(`/locations/${await loc()}/integrations`);
}
export async function getSquareLocations(): Promise<SquareLocationOption[]> {
  return get(`/locations/${await loc()}/integrations/square/locations`);
}
/** Returns Square's sign-in page; the browser goes there and Square sends it back to the API. */
export async function connectSquare(environment: "SANDBOX" | "PRODUCTION"): Promise<{ url: string }> {
  return post(`/locations/${await loc()}/integrations/square/connect`, { environment });
}
export async function chooseSquareLocation(posLocationId: string) {
  await put(`/locations/${await loc()}/integrations/square/location`, { posLocationId });
}
export async function disconnectSquare() {
  await post(`/locations/${await loc()}/integrations/square/disconnect`);
}
export async function resyncMenu() {
  await post(`/locations/${await loc()}/menu/sync`);
}
export async function getMenuStatus(): Promise<MenuStatus> {
  return get(`/locations/${await loc()}/menu/status`);
}
export async function getMenu(): Promise<MenuView> {
  return get(`/locations/${await loc()}/menu`);
}
export async function setItemOverlay(itemId: string, body: { aiHidden?: boolean; aiUnavailableUntil?: string | null }) {
  await patch(`/menu-items/${itemId}/overlay`, body);
}
export async function addAlias(itemId: string, phrase: string) {
  await post(`/locations/${await loc()}/menu/aliases`, { itemId, phrase });
}
export async function removeAlias(itemId: string, phrase: string) {
  await del(`/locations/${await loc()}/menu/aliases`, { itemId, phrase });
}

/* Orders ---------------------------------------------------------------------- */

export type OrderView = "open" | "accepted" | "attention" | "all";

export async function listOrders(filter: { view?: OrderView; range?: Range; cursor?: string | null }): Promise<Page<OrderSummary>> {
  return get(`/locations/${await loc()}/orders`, filter);
}
export async function countOrders(): Promise<Record<OrderView, number>> {
  return get(`/locations/${await loc()}/orders/counts`);
}
export async function getLiveTickets(): Promise<OrderSummary[]> {
  return get(`/locations/${await loc()}/live-tickets`);
}
export async function getOrder(id: string): Promise<OrderDetail | null> {
  if (!isId(id)) return null;
  return orNull(get<OrderDetail>(`/orders/${id}`));
}
export async function acceptOrder(id: string) {
  await post(`/orders/${id}/accept`);
}
export async function cancelOrder(id: string, reason: string) {
  await post(`/orders/${id}/cancel`, { reason });
}

/* Calls, callbacks, alerts, analytics ------------------------------------------- */

export type CallFilter = { outcome?: CallOutcome | "all"; transferred?: boolean; range?: Range; q?: string; cursor?: string | null };

export async function listCalls(filter: CallFilter): Promise<Page<CallSummary>> {
  return get(`/locations/${await loc()}/calls`, { ...filter, transferred: filter.transferred ? "true" : undefined });
}
export async function getCall(id: string): Promise<CallDetail | null> {
  if (!isId(id)) return null;
  return orNull(get<CallDetail>(`/calls/${id}`));
}
export async function listCallbacks(status: "OPEN" | "DONE" | "all" = "OPEN"): Promise<Callback[]> {
  return get(`/locations/${await loc()}/callbacks`, { status });
}
export async function updateCallback(id: string, status: "DONE" | "CANCELLED" | "OPEN") {
  await patch(`/callbacks/${id}`, { status });
}
export async function listAlerts(): Promise<Alert[]> {
  return get(`/locations/${await loc()}/alerts`);
}
export async function ackAlert(id: string) {
  await post(`/alerts/${id}/ack`);
}
export async function getAnalytics(range: "7d" | "30d"): Promise<Analytics> {
  return get(`/locations/${await loc()}/analytics`, { range });
}

/* Team and audit --------------------------------------------------------------- */

export async function listMembers(): Promise<{ members: Member[]; invitations: Invitation[] }> {
  return get(`/restaurants/${await rest()}/members`);
}
export async function invite(email: string, role: "MANAGER" | "STAFF") {
  const s = await requireSession();
  // Staff are invited to the location being worked in; managers to every location.
  await post(`/restaurants/${s.restaurant.id}/invitations`, { email, role, locationId: role === "STAFF" ? s.location.id : null });
}
export async function revokeInvitation(id: string) {
  await del(`/invitations/${id}`);
}
export async function changeMember(membershipId: string, change: { role?: Role; revoke?: boolean }) {
  await patch(`/restaurants/${await rest()}/members/${membershipId}`, change);
}
export async function getAudit(cursor?: string | null): Promise<Page<AuditEntry>> {
  return get(`/restaurants/${await rest()}/audit-log`, { cursor });
}

/* Test agent: the voice tools, driven by hand (S22) ------------------------------ */

export type TestCandidate = { itemId: string; name: string; matched: string; variations: { id: string; name: string; priceMinor: number }[] };

const testBase = async () => `/locations/${await loc()}/test-agent`;

export async function testSearch(query: string): Promise<TestCandidate[]> {
  return get(`${await testBase()}/search`, { q: query });
}
export async function testStart(): Promise<string> {
  return (await post<{ orderId: string }>(`${await testBase()}/calls`)).orderId;
}
export async function testAddLine(orderId: string, sel: Selection): Promise<{ problems: Problem[] }> {
  return post(`${await testBase()}/orders/${orderId}/lines`, sel);
}
export async function testRemoveLine(orderId: string, lineNo: number) {
  await del(`${await testBase()}/orders/${orderId}/lines/${lineNo}`);
}
export async function testSetCustomer(orderId: string, name: string, phone: string) {
  await put(`${await testBase()}/orders/${orderId}/customer`, { name, phone });
}
export async function testReadBack(orderId: string): Promise<{ version: number; totals: Totals }> {
  return post(`${await testBase()}/orders/${orderId}/read-back`);
}
export async function testConfirm(orderId: string, version: number) {
  await post(`${await testBase()}/orders/${orderId}/confirm`, { version });
}
export async function testSubmit(orderId: string) {
  return (await post<{ claim: string; say: string }>(`${await testBase()}/orders/${orderId}/submit`)).claim;
}
export async function testHangUp(orderId: string) {
  await post(`${await testBase()}/orders/${orderId}/hang-up`);
}
export async function getTestOrder(orderId: string): Promise<Order | null> {
  return orNull(get<Order>(`${await testBase()}/orders/${orderId}`));
}

/* The test chat (S22b): texting the AI through the same tools as a call -------------------------- */

export type ChatTurn = { replies: string[]; steps: string[]; order: OrderSummary | null; notice: string | null; ended: boolean };
const chatBase = async () => `/locations/${await loc()}/test-chat`;

export async function getTestChatStatus(): Promise<{ configured: boolean; model: string | null }> {
  return get(await chatBase());
}
export async function startTestChat(): Promise<{ chatId: string; greeting: string; model: string }> {
  return post(await chatBase());
}
export async function sendTestChat(chatId: string, text: string): Promise<ChatTurn> {
  return post(`${await chatBase()}/${chatId}/messages`, { text });
}
export async function endTestChat(chatId: string): Promise<void> {
  await post(`${await chatBase()}/${chatId}/end`);
}

/* Joining and signing up (no restaurant chosen yet, so these don't use the session) -------------- */

export async function acceptInvitation(token: string): Promise<{ restaurantId: string; locationId: string | null }> {
  return post("/invitations/accept", { token });
}
export async function createRestaurant(input: { name: string; location: { name: string; timezone: string; address: Location["address"] } }): Promise<{ restaurantId: string; locationId: string }> {
  return post("/restaurants", input);
}

/** Deletes the signed-in person's own account (the API refuses for a restaurant's owner). */
export async function deleteAccount(): Promise<void> {
  await del("/me");
}
