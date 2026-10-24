import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { newUser, signUp, startHarness, type Harness, type TestUser } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
const rita = newUser("Rita Rival");
const jordan = newUser("Jordan Manager");
const sam = newUser("Sam Staff");
let A: { restaurantId: string; locationId: string };
let B: { restaurantId: string; locationId: string };

/** Pulls the invitation token out of the email the server sent. */
function inviteToken(to: string): string {
  const mail = [...h.email.sent].reverse().find((m) => m.to === to);
  assert.ok(mail, `no email sent to ${to}`);
  return decodeURIComponent(/token=([^\s&]+)/.exec(mail.text)![1]!);
}

async function join(owner: TestUser, rid: string, who: TestUser, role: "MANAGER" | "STAFF") {
  const inv = await h.call(owner, "POST", `/restaurants/${rid}/invitations`, { email: who.email, role });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const accepted = await h.call(who, "POST", "/invitations/accept", { token: inviteToken(who.email) });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
}

before(async () => {
  h = await startHarness();
  A = await signUp(h, maya, "Third Space");
  B = await signUp(h, rita, "Rival Cafe");
  await join(maya, A.restaurantId, jordan, "MANAGER");
  await join(maya, A.restaurantId, sam, "STAFF");
});
after(async () => {
  await h.stop();
});

describe("a second restaurant sees nothing of the first", () => {
  test("every location-scoped read answers 404 for an outsider", async () => {
    const paths = ["", "/settings", "/hours", "/special-hours", "/notices", "/faqs", "/transfer-targets", "/phone-numbers", "/menu", "/menu/status",
      "/orders", "/orders/counts", "/live-tickets", "/calls", "/callbacks", "/alerts", "/analytics", "/onboarding", "/open-state", "/pronunciations"];
    for (const p of paths) {
      const r = await h.call(rita, "GET", `/locations/${A.locationId}${p}`);
      assert.equal(r.status, 404, `${p} leaked: ${r.status}`);
    }
  });

  test("writes are refused the same way", async () => {
    const attempts: [string, string, unknown][] = [
      ["PATCH", `/locations/${A.locationId}`, { name: "Hijacked" }],
      ["PATCH", `/locations/${A.locationId}/settings`, { greeting: "Hello from the rival cafe" }],
      ["PUT", `/locations/${A.locationId}/hours`, { store: [], ordering: [] }],
      ["POST", `/locations/${A.locationId}/faqs`, { question: "Is it free?", answer: "Yes", aliases: [], active: true, validFrom: null, validUntil: null }],
      ["PATCH", `/locations/${A.locationId}/ordering`, { mode: "DISABLED", feasibility: "UNVERIFIED", note: null }],
    ];
    for (const [m, url, body] of attempts) {
      const r = await h.call(rita, m, url, body);
      assert.equal(r.status, 404, `${m} ${url} -> ${r.status}`);
    }
    const loc = await h.call(maya, "GET", `/locations/${A.locationId}`);
    assert.equal(loc.body.name, "Main Street", "nothing changed");
  });

  test("a resource id from another tenant is just not found", async () => {
    const faq = await h.call(maya, "POST", `/locations/${A.locationId}/faqs`, { question: "Do you have parking?", answer: "Street parking only.", aliases: [], active: true, validFrom: null, validUntil: null });
    assert.equal(faq.status, 201);
    assert.equal((await h.call(rita, "PUT", `/faqs/${faq.body.id}`, { question: "Do you have parking?", answer: "Free!", aliases: [], active: true, validFrom: null, validUntil: null })).status, 404);
    assert.equal((await h.call(rita, "DELETE", `/faqs/${faq.body.id}`)).status, 404);
    assert.equal((await h.call(rita, "GET", `/orders/${faq.body.id}`)).status, 404);
    assert.equal((await h.call(rita, "GET", `/restaurants/${A.restaurantId}/members`)).status, 404);
    assert.equal((await h.call(rita, "GET", `/restaurants/${A.restaurantId}/audit-log`)).status, 404);
    const still = await h.call(maya, "GET", `/locations/${A.locationId}/faqs`);
    assert.equal(still.body[0].answer, "Street parking only.");
  });

  test("row level security blocks even a query that forgets its WHERE clause", async () => {
    const { withTenant, many } = await import("@receptionist/db");
    const rows = await withTenant(h.db, { restaurantId: B.restaurantId, userId: rita.id }, (tx) => many(tx, "select id from faqs"));
    assert.equal(rows.length, 0);
    const mine = await withTenant(h.db, { restaurantId: A.restaurantId, userId: maya.id }, (tx) => many(tx, "select id from faqs"));
    assert.equal(mine.length, 1);
  });
});

describe("roles", () => {
  test("staff can read and work the queue but cannot change configuration", async () => {
    assert.equal((await h.call(sam, "GET", `/locations/${A.locationId}/settings`)).status, 200);
    assert.equal((await h.call(sam, "GET", `/locations/${A.locationId}/live-tickets`)).status, 200);
    assert.equal((await h.call(sam, "PATCH", `/locations/${A.locationId}/settings`, { greeting: "A different greeting here" })).status, 403);
    assert.equal((await h.call(sam, "POST", `/locations/${A.locationId}/faqs`, { question: "Anything?", answer: "No", aliases: [], active: true, validFrom: null, validUntil: null })).status, 403);
    assert.equal((await h.call(sam, "GET", `/locations/${A.locationId}/analytics`)).status, 403);
    assert.equal((await h.call(sam, "GET", `/restaurants/${A.restaurantId}/members`)).status, 403);
  });

  test("a manager edits settings but not ordering mode, privacy, members or the audit log", async () => {
    assert.equal((await h.call(jordan, "PATCH", `/locations/${A.locationId}/settings`, { greeting: "Thanks for calling Third Space." })).status, 200);
    assert.equal((await h.call(jordan, "PATCH", `/locations/${A.locationId}/settings`, { recordingEnabled: true })).status, 403);
    assert.equal((await h.call(jordan, "PATCH", `/locations/${A.locationId}/ordering`, { mode: "DISABLED", feasibility: "UNVERIFIED", note: null })).status, 403);
    assert.equal((await h.call(jordan, "GET", `/restaurants/${A.restaurantId}/members`)).status, 200);
    assert.equal((await h.call(jordan, "POST", `/restaurants/${A.restaurantId}/invitations`, { email: "x@example.test", role: "STAFF" })).status, 403);
    assert.equal((await h.call(jordan, "GET", `/restaurants/${A.restaurantId}/audit-log`)).status, 403);
  });

  test("F01-N2 only the owner buys phone numbers (they cost money)", async () => {
    assert.equal((await h.call(jordan, "GET", `/locations/${A.locationId}/phone-numbers/available?areaCode=212`)).status, 403);
    assert.equal((await h.call(jordan, "POST", `/locations/${A.locationId}/phone-numbers`, { e164: "+12125550199" })).status, 403);
    assert.equal((await h.call(sam, "POST", `/locations/${A.locationId}/phone-numbers`, { e164: "+12125550199" })).status, 403);
  });

  test("the owner can do all of it, and every change is in the audit log", async () => {
    assert.equal((await h.call(maya, "PATCH", `/locations/${A.locationId}/settings`, { recordingEnabled: true, retentionDays: 30 })).status, 200);
    const log = await h.call(maya, "GET", `/restaurants/${A.restaurantId}/audit-log`);
    assert.equal(log.status, 200);
    const actions = log.body.items.map((e: { action: string }) => e.action);
    for (const a of ["settings.update", "members.invite", "members.accept", "faqs.create", "restaurant.create"]) assert.ok(actions.includes(a), `missing ${a} in ${actions.join(",")}`);
    const update = log.body.items.find((e: { action: string; actorName: string }) => e.action === "settings.update" && e.actorName.includes("Jordan"));
    assert.ok(update, "the manager's change is attributed to the manager");
  });
});
