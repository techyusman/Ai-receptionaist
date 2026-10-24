import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { many, maybeOne, withSystem } from "@receptionist/db";
import { thirdSpaceCatalog, SAMPLE_SQUARE_LOCATION } from "../src/dev/third-space-catalog.ts";
import { buildHandlers } from "../src/jobs/handlers.ts";
import { newUser, signUp, startHarness, type Harness } from "./harness.ts";

let h: Harness;
const maya = newUser("Maya Owner");
const rita = newUser("Rita Rival");
let rid: string;
let lid: string;
let B: { restaurantId: string; locationId: string };

/** Plays the part of the browser: press Connect, approve at Square, land on our callback. */
async function connect(user = maya, location = lid, code = "good-code") {
  const r = await h.call(user, "POST", `/locations/${location}/integrations/square/connect`, { environment: "SANDBOX" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const url = new URL(r.body.url);
  const state = url.searchParams.get("state")!;
  const cb = await h.app.inject({ method: "GET", url: `/oauth/square/callback?code=${code}&state=${state}` });
  return { authorizeUrl: url, state, redirect: cb.headers.location as string, status: cb.statusCode };
}

before(async () => {
  h = await startHarness({ square: true });
  h.square!.catalog = thirdSpaceCatalog().map((o, i) => ({ ...o, updated_at: `2026-10-01T00:00:${String(i).padStart(2, "0")}Z` }));
  h.jobs.handlers = buildHandlers(h.deps);
  ({ restaurantId: rid, locationId: lid } = await signUp(h, maya, "Third Space"));
  B = await signUp(h, rita, "Rival Cafe");
});
after(async () => {
  await h.stop();
});

describe("connecting Square", () => {
  test("the authorize link asks for the fewest scopes and carries a one-time state", async () => {
    const { authorizeUrl } = await connect();
    assert.equal(authorizeUrl.searchParams.get("client_id"), "sq0idp-test");
    assert.deepEqual(authorizeUrl.searchParams.get("scope")!.split(" ").sort(), ["ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "ORDERS_WRITE"]);
    assert.equal(authorizeUrl.searchParams.get("redirect_uri"), "https://api.example.test/oauth/square/callback");
    assert.ok(authorizeUrl.searchParams.get("state")!.length >= 40);
  });

  test("approving sends the owner back to the dashboard, with tokens stored encrypted", async () => {
    const r = await connect();
    assert.equal(r.status, 302);
    assert.equal(r.redirect, "https://app.example.test/square?connected=1");
    const status = (await h.call(maya, "GET", `/locations/${lid}/integrations`)).body;
    assert.equal(status.status, "CONNECTED");
    assert.equal(status.merchantName, "Third Space");
    assert.equal(status.posLocationId, null, "no location chosen yet");
    const row = await withSystem(h.db, (tx) => maybeOne<{ access_token_ct: Buffer }>(tx, "select access_token_ct from pos_integrations where location_id = $1", [lid]));
    assert.ok(row!.access_token_ct.length > 28);
    assert.ok(!row!.access_token_ct.toString("utf8").includes("access-"), "the token is not stored in the clear");
  });

  test("a state works once, and an unknown or denied one goes nowhere useful", async () => {
    const first = await connect();
    const replay = await h.app.inject({ method: "GET", url: `/oauth/square/callback?code=good-code&state=${first.state}` });
    assert.equal(replay.headers.location, "https://app.example.test/square?error=expired");
    const unknown = await h.app.inject({ method: "GET", url: "/oauth/square/callback?code=good-code&state=made-up" });
    assert.equal(unknown.headers.location, "https://app.example.test/square?error=expired");
    const noState = await h.app.inject({ method: "GET", url: "/oauth/square/callback?code=good-code" });
    assert.equal(noState.headers.location, "https://app.example.test/square?error=state");
    const r = await h.call(maya, "POST", `/locations/${lid}/integrations/square/connect`, { environment: "SANDBOX" });
    const state = new URL(r.body.url).searchParams.get("state")!;
    const denied = await h.app.inject({ method: "GET", url: `/oauth/square/callback?error=access_denied&state=${state}` });
    assert.equal(denied.headers.location, "https://app.example.test/square?error=denied");
    const afterDenied = await h.app.inject({ method: "GET", url: `/oauth/square/callback?code=good-code&state=${state}` });
    assert.equal(afterDenied.headers.location, "https://app.example.test/square?error=expired", "a denied state is spent");
    const bad = await connect(maya, lid, "wrong-code");
    assert.equal(bad.redirect, "https://app.example.test/square?error=failed");
  });

  test("someone outside the restaurant cannot start a connection", async () => {
    const r = await h.call(rita, "POST", `/locations/${lid}/integrations/square/connect`, { environment: "SANDBOX" });
    assert.equal(r.status, 404);
  });
});

describe("choosing a location and syncing the menu", () => {
  test("picking a Square location starts a full sync that fills the menu", async () => {
    await connect();
    const list = await h.call(maya, "GET", `/locations/${lid}/integrations/square/locations`);
    assert.equal(list.status, 200);
    assert.equal(list.body[0].id, SAMPLE_SQUARE_LOCATION);
    assert.equal((await h.call(maya, "PUT", `/locations/${lid}/integrations/square/location`, { posLocationId: "LNOPE" })).status, 422);
    const put = await h.call(maya, "PUT", `/locations/${lid}/integrations/square/location`, { posLocationId: SAMPLE_SQUARE_LOCATION });
    assert.equal(put.status, 200);
    assert.equal(put.body.posLocationName, "Third Space - Main Street");
    assert.deepEqual(h.jobs.names(), ["catalog.sync"]);
    await h.jobs.drain();
    const menu = (await h.call(maya, "GET", `/locations/${lid}/menu`)).body;
    assert.equal(menu.items.filter((i: { deleted: boolean }) => !i.deleted).length, 11);
    const status = (await h.call(maya, "GET", `/locations/${lid}/menu/status`)).body;
    assert.equal(status.state, "fresh");
    assert.equal(status.itemCount, 11);
    const done = await withSystem(h.db, (tx) => many<{ kind: string; status: string }>(tx, "select kind, status from catalog_syncs where location_id = $1", [lid]));
    assert.deepEqual(done.map((d) => `${d.kind}:${d.status}`), ["FULL:SUCCEEDED"]);
  });

  test("a second restaurant cannot claim the same Square location", async () => {
    await connect(rita, B.locationId);
    const r = await h.call(rita, "PUT", `/locations/${B.locationId}/integrations/square/location`, { posLocationId: SAMPLE_SQUARE_LOCATION });
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /already connected to another restaurant/);
  });

  test("an incremental sync applies only what changed since the last one", async () => {
    const stub = h.square!;
    const latte = stub.catalog.find((o) => o.id === "I_LATTE")!;
    const vars = (latte.item_data!.variations as { id: string; item_variation_data: { price_money: { amount: number } } }[]).map((v) =>
      v.id === "V_LATTE_L" ? { ...v, item_variation_data: { ...v.item_variation_data, price_money: { amount: 600, currency: "USD" } } } : v);
    stub.catalog = stub.catalog.map((o) => (o.id === "I_LATTE" ? { ...o, version: 2, updated_at: "2026-10-02T00:00:00Z", item_data: { ...o.item_data, variations: vars } } : o));
    await h.jobs.enqueue("catalog.sync", { locationId: lid, kind: "INCREMENTAL", trigger: "WEBHOOK" });
    stub.requests.length = 0;
    await h.jobs.drain();
    assert.ok(stub.requests.some((r) => r.path === "/v2/catalog/search"), "asked Square only for changes");
    assert.ok(!stub.requests.some((r) => r.path === "/v2/catalog/list"), "did not re-download the catalog");
    const menu = (await h.call(maya, "GET", `/locations/${lid}/menu`)).body;
    const latteNow = menu.items.find((i: { name: string }) => i.name === "Latte");
    assert.equal(latteNow.variations.find((v: { name: string }) => v.name === "Large").priceMinor, 600);
  });

  test("every Square call carries the pinned API version and the owner's own token", async () => {
    const calls = h.square!.requests.filter((r) => r.path.startsWith("/v2/"));
    assert.ok(calls.length > 0);
    assert.ok(calls.every((c) => c.version === "2026-08-19"));
    assert.ok(calls.every((c) => /^Bearer access-\d+$/.test(c.auth ?? "")));
  });
});
