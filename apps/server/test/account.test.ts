import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { maybeOne, withSystem } from "@receptionist/db";
import { buildApp } from "../src/app.ts";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
const sam = newUser("Sam Staff");
let rid: string;
const deleted: string[] = [];
const realFetch = globalThis.fetch;

before(async () => {
  h = await startHarness({ configure: (env) => void (env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test") });
  // Stand in for Supabase's admin API; everything else goes out as normal.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://project.supabase.test/auth/v1/admin/users/")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer service-role-test");
      deleted.push(url.split("/").at(-1)!);
      return new Response("{}", { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  ({ restaurantId: rid } = await signUp(h, maya, "Third Space"));
  await h.call(maya, "POST", `/restaurants/${rid}/invitations`, { email: sam.email, role: "STAFF" });
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.email.sent.at(-1)!.text)![1]!);
  await h.call(sam, "POST", "/invitations/accept", { token });
});
after(async () => {
  globalThis.fetch = realFetch;
  await h.stop();
});

test("an owner is asked to hand over the restaurant before deleting their account", async () => {
  const r = await h.call(maya, "DELETE", "/me");
  assert.equal(r.status, 409);
  assert.match(r.body.error.message, /You own Third Space/);
  assert.deepEqual(deleted, []);
});

test("a team member's deletion removes the sign-in, the user and the membership, and leaves a note", async () => {
  const r = await h.call(sam, "DELETE", "/me");
  assert.equal(r.status, 204);
  assert.deepEqual(deleted, [sam.id]);
  const row = await withSystem(h.db, (tx) => maybeOne(tx, "select 1 as x from users where id = $1", [sam.id]));
  assert.equal(row, null);
  const members = (await h.call(maya, "GET", `/restaurants/${rid}/members`)).body.members;
  assert.ok(!members.some((m: { email: string }) => m.email === sam.email));
  const log = (await h.call(maya, "GET", `/restaurants/${rid}/audit-log`)).body.items;
  assert.ok(log.some((e: { action: string }) => e.action === "members.account_deleted"));
});

test("BUG-014 a deleted account's tokens are refused and never bring the person back", async () => {
  // Their sign-in token stays valid until it expires (up to an hour), and they may still be signed in on
  // another device. Using it must not re-create the user row (their email and name) they asked us to delete.
  const gone = newUser("Gone Soon");
  assert.equal((await h.call(maya, "POST", `/restaurants/${rid}/invitations`, { email: gone.email, role: "STAFF" })).status, 201);
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.email.sent.at(-1)!.text)![1]!);
  assert.equal((await h.call(gone, "POST", "/invitations/accept", { token })).status, 200);
  assert.equal((await h.call(gone, "GET", "/me")).status, 200);
  assert.equal((await h.call(gone, "DELETE", "/me")).status, 204);

  const again = await h.call(gone, "GET", "/me");
  assert.equal(again.status, 401, JSON.stringify(again.body));
  const fresh = await buildApp(h.deps); // another API instance, which never saw them
  const elsewhere = await fresh.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${await h.token(gone)}` } });
  await fresh.close();
  assert.equal(elsewhere.statusCode, 401, elsewhere.body);
  const row = await withSystem(h.db, (tx) => maybeOne(tx, "select 1 as x from users where id = $1", [gone.id]));
  assert.equal(row, null, "the deleted person is not re-created");
});
