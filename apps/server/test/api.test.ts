import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { newUser, signUp, startHarness, type Harness, type TestUser } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
const sam = newUser("Sam Staff");
const outsider = newUser("Olivia Outsider");
let rid: string;
let lid: string;

before(async () => {
  h = await startHarness();
  ({ restaurantId: rid, locationId: lid } = await signUp(h, maya, "Third Space"));
});
after(async () => {
  await h.stop();
});

describe("authentication", () => {
  test("no token, a bad token and a wrong-audience token are all 401", async () => {
    assert.equal((await h.call(null, "GET", "/me")).status, 401);
    const bad = await h.app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: "Bearer not-a-jwt" } });
    assert.equal(bad.statusCode, 401);
    const wrongAud = await h.app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${await h.token(maya, { aud: "anon" })}` } });
    assert.equal(wrongAud.statusCode, 401);
    const expired = await h.app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${await h.token(maya, { expiresIn: "-1h" })}` } });
    assert.equal(expired.statusCode, 401);
  });

  test("an unsigned (alg none) token is refused", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: maya.id, email: maya.email, aud: "authenticated", iss: "https://project.supabase.test/auth/v1", exp: 9999999999 })}.`;
    const r = await h.app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${forged}` } });
    assert.equal(r.statusCode, 401);
  });

  test("healthz is public and reports the database", async () => {
    const r = await h.app.inject({ method: "GET", url: "/healthz" });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true });
  });

  test("responses are never cached and never sniffed", async () => {
    const r = await h.app.inject({ method: "GET", url: "/healthz" });
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
  });
});

describe("sign-up and /me", () => {
  test("the creator becomes the owner of a restaurant with one location and default settings", async () => {
    const me = await h.call(maya, "GET", "/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, maya.email);
    assert.equal(me.body.memberships.length, 1);
    assert.equal(me.body.memberships[0].role, "OWNER");
    assert.equal(me.body.memberships[0].locations[0].id, lid);
    const settings = await h.call(maya, "GET", `/locations/${lid}/settings`);
    assert.equal(settings.status, 200);
    assert.equal(settings.body.recordingEnabled, false, "recording is off by default");
    assert.equal(settings.body.transcriptEnabled, false, "transcripts are off by default");
    const loc = await h.call(maya, "GET", `/locations/${lid}`);
    assert.equal(loc.body.orderingMode, "DISABLED");
    assert.equal(loc.body.feasibility, "UNVERIFIED");
  });

  test("a second restaurant with the same name gets its own slug", async () => {
    const other = newUser("Dana Duplicate");
    const r = await signUp(h, other, "Third Space");
    assert.notEqual(r.slug, "third-space");
  });

  test("invalid input is a 400 with the field named", async () => {
    const r = await h.call(newUser("Bad Input"), "POST", "/restaurants", { name: "", location: { name: "x", timezone: "Mars/Base", address: {} } });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, "VALIDATION");
    assert.ok(r.body.error.field);
  });
});

describe("request bodies", () => {
  test("an action with an empty JSON body is read as {}, and broken JSON is a 400", async () => {
    const tok = await h.token(maya);
    const empty = await h.app.inject({ method: "POST", url: `/api/v1/locations/${lid}/faqs/templates`, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" } });
    assert.equal(empty.statusCode, 200);
    const broken = await h.app.inject({ method: "POST", url: `/api/v1/locations/${lid}/faqs`, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, payload: "{not json" });
    assert.equal(broken.statusCode, 400);
    assert.equal(JSON.parse(broken.body).error.code, "VALIDATION");
  });
});
