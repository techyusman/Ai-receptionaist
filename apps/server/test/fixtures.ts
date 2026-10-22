// Shared set-up for tests that need a restaurant with a synced Square menu and orders to submit.
import assert from "node:assert/strict";
import { withSystem, withTenant, type Tx } from "@receptionist/db";
import { confirm, readyForConfirmation, subtotal, toOrderLine, validateSelection, type Menu, type Order, type PosMode, type Selection } from "@receptionist/domain";
import { thirdSpaceCatalog, SAMPLE_SQUARE_LOCATION } from "../src/dev/third-space-catalog.ts";
import { buildHandlers } from "../src/jobs/handlers.ts";
import { loadMenu } from "../src/menu/read.ts";
import { priceOrder } from "../src/pos/pricing.ts";
import { createOrder, transition, updateDraft } from "../src/orders/service.ts";
import { signUp, type Harness, type TestUser } from "./harness.ts";

export type Ready = { rid: string; lid: string; menu: Menu };
const AI = { actor: "AI" as const };
const at = () => new Date().toISOString();

export function lineFrom(menu: Menu, name: string, variation: string, picks: Record<string, string[]> = {}, quantity = 1, parents: Record<string, string> = {}) {
  const item = menu.items.find((i) => i.name === name)!;
  const sel: Selection = {
    itemId: item.id, variationId: item.variations.find((v) => v.name === variation)!.id, quantity,
    modifiers: Object.entries(picks).flatMap(([list, options]) => {
      const l = Object.values(menu.lists).find((x) => x.name === list)!;
      return options.map((o) => {
        const parent = parents[o] ? Object.values(menu.lists).flatMap((pl) => pl.options).find((x) => x.name === parents[o]) : undefined;
        return { listId: l.id, optionId: l.options.find((x) => x.name === o)!.id, ...(parent ? { parentOptionId: parent.id } : {}) };
      });
    }),
  };
  assert.deepEqual(validateSelection(menu, sel, new Date()), []);
  return toOrderLine(menu, sel);
}

/** Sign up, connect Square (against the stub), pick the location, sync the menu. Optionally switch to Square ordering. */
export async function squareReady(h: Harness, owner: TestUser, name: string, mode: "SQUARE" | "DASHBOARD_TICKET" = "SQUARE"): Promise<Ready> {
  const stub = h.square!;
  if (!stub.catalog.length) stub.catalog = thirdSpaceCatalog().map((o, i) => ({ ...o, updated_at: `2026-10-01T00:00:${String(i).padStart(2, "0")}Z` }));
  h.jobs.handlers = buildHandlers(h.deps);
  const { restaurantId: rid, locationId: lid } = await signUp(h, owner, name);
  const c = await h.call(owner, "POST", `/locations/${lid}/integrations/square/connect`, { environment: "SANDBOX" });
  await h.app.inject({ method: "GET", url: `/oauth/square/callback?code=good-code&state=${new URL(c.body.url).searchParams.get("state")}` });
  const put = await h.call(owner, "PUT", `/locations/${lid}/integrations/square/location`, { posLocationId: SAMPLE_SQUARE_LOCATION });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  await h.jobs.drain();
  const ordering = mode === "SQUARE"
    ? { mode, feasibility: "VERIFIED_NATIVE", note: "Sandbox test passed." }
    : { mode, feasibility: "FALLBACK_APPROVED", note: "Approved in writing." };
  const set = await h.call(owner, "PATCH", `/locations/${lid}/ordering`, ordering);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const menu = await withSystem(h.db, (tx) => loadMenu(tx, lid));
  return { rid, lid, menu };
}

type Opts = { posMode?: PosMode; isTest?: boolean; read?: boolean };

/** An order the caller has confirmed, ready for submit_confirmed_order. */
export async function confirmedOrder(h: Harness, r: Ready, o: Opts = {}): Promise<Order> {
  const posMode = o.posMode ?? "SQUARE";
  const tenant = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(h.db, { restaurantId: r.rid, actorType: "AI" }, fn);
  let order = await tenant((tx) => createOrder(tx, { restaurantId: r.rid, locationId: r.lid, callId: null, isTest: o.isTest ?? false, posMode, currency: "USD" }, AI));
  order = await tenant((tx) => updateDraft(tx, order.id, { op: "add", line: lineFrom(r.menu, "Latte", "Small", { Milk: ["Oat milk"] }) }, AI));
  order = await tenant((tx) => updateDraft(tx, order.id, { op: "customer", customer: { name: "Priya", phone: "+12125550101", phoneSource: "SPOKEN" } }, AI));
  const priced = await priceOrder(h.deps, order);
  assert.ok(priced.ok, JSON.stringify(priced));
  order = await tenant((tx) => transition(tx, order.id, (x) => readyForConfirmation(x, priced.totals, 0, { actor: "AI", at: at() }), AI));
  void subtotal;
  return tenant((tx) => transition(tx, order.id, (x) => confirm(x, x.version, { actor: "AI", at: at() }), AI));
}
