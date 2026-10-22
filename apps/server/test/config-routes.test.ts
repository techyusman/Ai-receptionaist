import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
let lid: string;
const faq = (over: object = {}) => ({ question: "Do you have parking?", answer: "Street parking only.", aliases: [], active: true, validFrom: null, validUntil: null, ...over });

before(async () => {
  h = await startHarness();
  ({ locationId: lid } = await signUp(h, maya, "Third Space"));
});
after(async () => {
  await h.stop();
});

describe("the Square question", () => {
  test("ordering cannot be switched on before the feasibility is proven or approved", async () => {
    const sq = await h.call(maya, "PATCH", `/locations/${lid}/ordering`, { mode: "SQUARE", feasibility: "UNVERIFIED", note: null });
    assert.equal(sq.status, 422);
    assert.equal(sq.body.error.field, "mode");
    const ticket = await h.call(maya, "PATCH", `/locations/${lid}/ordering`, { mode: "DASHBOARD_TICKET", feasibility: "UNVERIFIED", note: null });
    assert.equal(ticket.status, 422);
  });

  test("with written approval recorded, live orders turn on and the sign-off is stamped", async () => {
    const r = await h.call(maya, "PATCH", `/locations/${lid}/ordering`, { mode: "DASHBOARD_TICKET", feasibility: "FALLBACK_APPROVED", note: "Approved by email from the owner, 12 Oct." });
    assert.equal(r.status, 200);
    assert.equal(r.body.orderingMode, "DASHBOARD_TICKET");
    assert.equal(r.body.feasibilitySignedOffBy, "Maya Owner");
    assert.ok(r.body.feasibilitySignedOffAt);
  });

  test("even a direct database write cannot get around the gate", async () => {
    const { withTenant } = await import("@receptionist/db");
    const { restaurantId } = (await h.call(maya, "GET", "/me")).body.memberships[0].restaurant ? { restaurantId: (await h.call(maya, "GET", "/me")).body.memberships[0].restaurant.id } : { restaurantId: "" };
    await assert.rejects(
      withTenant(h.db, { restaurantId }, (tx) => tx.query("update locations set ordering_mode = 'SQUARE' where id = $1", [lid])),
      /square_mode_needs_proof/,
    );
  });
});

describe("settings", () => {
  test("a patch changes only what it names, and bad values are refused with a reason", async () => {
    const before = (await h.call(maya, "GET", `/locations/${lid}/settings`)).body;
    const ok = await h.call(maya, "PATCH", `/locations/${lid}/settings`, { greeting: "Thanks for calling Third Space, how can I help?", maxCallSeconds: 600 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.maxCallSeconds, 600);
    assert.equal(ok.body.ringStaffSeconds, before.ringStaffSeconds);
    const short = await h.call(maya, "PATCH", `/locations/${lid}/settings`, { greeting: "Hi" });
    assert.equal(short.status, 400);
    assert.equal(short.body.error.field, "greeting");
    const tooMany = await h.call(maya, "PATCH", `/locations/${lid}/settings`, { extraLanguages: ["es", "fr"] });
    assert.equal(tooMany.status, 400);
    const unknown = await h.call(maya, "PATCH", `/locations/${lid}/settings`, { notAColumn: 1 });
    assert.equal(unknown.status, 400, "unknown keys are rejected, never passed to SQL");
  });
});

describe("hours", () => {
  test("a week saves atomically and an overlapping shift saves nothing", async () => {
    const week = { store: [{ weekday: 1, opens: "07:00", closes: "15:00" }, { weekday: 2, opens: "07:00", closes: "15:00" }], ordering: [] };
    assert.equal((await h.call(maya, "PUT", `/locations/${lid}/hours`, week)).status, 200);
    const overlap = { store: [{ weekday: 1, opens: "07:00", closes: "15:00" }, { weekday: 1, opens: "14:00", closes: "18:00" }], ordering: [] };
    const bad = await h.call(maya, "PUT", `/locations/${lid}/hours`, overlap);
    assert.equal(bad.status, 422);
    assert.match(bad.body.error.message, /overlap/i);
    const now = await h.call(maya, "GET", `/locations/${lid}/hours`);
    assert.equal(now.body.store.length, 2, "the failed save left the old week intact");
  });

  test("special hours: a closure, a duplicate closure, and open-now computed in the restaurant's zone", async () => {
    assert.equal((await h.call(maya, "POST", `/locations/${lid}/special-hours`, { date: "2026-12-25", closed: true })).status, 201);
    const dup = await h.call(maya, "POST", `/locations/${lid}/special-hours`, { date: "2026-12-25", closed: true });
    assert.equal(dup.status, 409);
    const partial = await h.call(maya, "POST", `/locations/${lid}/special-hours`, { date: "2026-12-31", closed: false, opens: "08:00" });
    assert.equal(partial.status, 400);
    // Monday 2026-10-19 12:00 in New York is 16:00 UTC: inside 07:00-15:00? No, 12:00 local is inside.
    h.setNow(new Date("2026-10-19T16:00:00Z"));
    assert.equal((await h.call(maya, "GET", `/locations/${lid}/open-state`)).body.storeOpen, true);
    h.setNow(new Date("2026-10-19T20:00:00Z")); // 16:00 local, after close
    assert.equal((await h.call(maya, "GET", `/locations/${lid}/open-state`)).body.storeOpen, false);
    h.setNow(new Date("2026-12-25T16:00:00Z")); // closed all day, even though it's a Friday with no shift anyway
    assert.equal((await h.call(maya, "GET", `/locations/${lid}/open-state`)).body.storeOpen, false);
    h.setNow(null);
  });
});

describe("knowledge", () => {
  test("add, edit in place, and refuse a duplicate question", async () => {
    const a = await h.call(maya, "POST", `/locations/${lid}/faqs`, faq());
    assert.equal(a.status, 201);
    const dup = await h.call(maya, "POST", `/locations/${lid}/faqs`, faq({ question: "do you have parking" }));
    assert.equal(dup.status, 409, "same question ignoring case and punctuation");
    const edited = await h.call(maya, "PUT", `/faqs/${a.body.id}`, faq({ answer: "A free lot behind the building." }));
    assert.equal(edited.status, 200);
    const list = (await h.call(maya, "GET", `/locations/${lid}/faqs`)).body;
    assert.equal(list.length, 1, "edited in place, not duplicated");
    assert.equal(list[0].id, a.body.id);
    assert.equal(list[0].answer, "A free lot behind the building.");
  });

  test("starter questions arrive as inactive drafts that cannot be saved until the brackets are replaced", async () => {
    const t = await h.call(maya, "POST", `/locations/${lid}/faqs/templates`);
    assert.equal(t.body.added, 5);
    assert.equal((await h.call(maya, "POST", `/locations/${lid}/faqs/templates`)).body.added, 0, "no duplicates on a second run");
    const drafts = (await h.call(maya, "GET", `/locations/${lid}/faqs`)).body.filter((f: { source: string }) => f.source === "TEMPLATE");
    assert.equal(drafts.length, 5);
    assert.ok(drafts.every((d: { active: boolean; reviewed: boolean }) => !d.active && !d.reviewed));
    const tryBrackets = await h.call(maya, "PUT", `/faqs/${drafts[0].id}`, faq({ question: drafts[0].question, answer: drafts[0].answer }));
    assert.equal(tryBrackets.status, 422);
    const fixed = await h.call(maya, "PUT", `/faqs/${drafts[0].id}`, faq({ question: drafts[0].question, answer: "Yes, our oat-milk drinks and the avocado toast are vegan." }));
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.reviewed, true);
  });

  test("an answer with an end date is stored as an instant", async () => {
    const r = await h.call(maya, "POST", `/locations/${lid}/faqs`, faq({ question: "Are you open on Christmas Eve?", answer: "Until 2pm.", validUntil: "2026-12-25T04:59:00.000Z" }));
    assert.equal(r.status, 201);
    assert.equal(r.body.validUntil, "2026-12-25T04:59:00.000Z");
  });
});
