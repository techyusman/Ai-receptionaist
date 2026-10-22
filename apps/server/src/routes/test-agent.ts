// S22, the test call from the dashboard. It walks an order through exactly the steps the voice agent
// uses (same menu checks, same pricing, same state machine, same submit) without a phone, so a restaurant
// can try its menu before a caller does. Everything it creates is flagged as a test: it never reaches
// Square, and it never raises a kitchen alert.
import { testConfirmInput, testCustomerInput, testLineInput, testSearchQuery } from "@receptionist/contracts";
import { confirm, readyForConfirmation, searchMenu, toOrderLine, validateSelection, abandon, IN_PROGRESS } from "@receptionist/domain";
import { maybeOne, one, type Tx } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import parsePhone from "libphonenumber-js";
import { z } from "zod";
import { endCall } from "../calls/outcome.ts";
import { addEvent } from "../calls/service.ts";
import type { Deps } from "../deps.ts";
import { notFound, rule } from "../errors.ts";
import { lidParam, parse, who } from "../http.ts";
import { signal } from "../live.ts";
import { loadMenu } from "../menu/read.ts";
import { loadOrder } from "../orders/repo.ts";
import { revalidate } from "../orders/revalidate.ts";
import { getSettingsRow } from "./location-data.ts";
import { createOrder, transition, updateDraft } from "../orders/service.ts";
import { priceOrder } from "../pos/pricing.ts";
import { submitConfirmedOrder } from "../pos/submit.ts";
import { whatToSay } from "../pos/speech.ts";
import { tenant } from "./util.ts";

const AI = { actor: "AI" as const };
const orderParam = z.object({ lid: z.uuid(), oid: z.uuid() });

async function testOrder(tx: Tx, lid: string, oid: string) {
  const o = await loadOrder(tx, oid);
  if (!o || !o.isTest || o.locationId !== lid) throw notFound("That test order has ended. Start a new one.");
  return o;
}

export function registerTestAgentRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/test-agent/search", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const { q } = parse(testSearchQuery, req.query);
    return tenant(deps, a, async (tx) => {
      const menu = await loadMenu(tx, lid);
      return searchMenu(menu, q, deps.now()).map((c) => ({
        itemId: c.item.id, name: c.item.name, matched: c.matched,
        variations: c.item.variations.filter((v) => !v.deleted && !v.soldOut && v.priceMinor !== null).map((v) => ({ id: v.id, name: v.name, priceMinor: v.priceMinor! })),
      }));
    });
  });

  api.post("/locations/:lid/test-agent/calls", async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const created = await tenant(deps, a, async (tx) => {
      const loc = await one<{ currency: string }>(tx, "select currency from locations where id = $1", [lid]);
      const number = await maybeOne<{ e164: string }>(tx, "select e164 from phone_numbers where location_id = $1 and released_at is null order by created_at limit 1", [lid]);
      const call = await one<{ id: string }>(
        tx,
        `insert into calls (restaurant_id, location_id, provider_call_sid, is_test, from_e164, to_e164, started_at, answered_at, status, summary)
         values ($1, $2, $3, true, '+12125550100', $4, now(), now(), 'IN_PROGRESS', 'Test call from the dashboard.') returning id`,
        [a.restaurantId, lid, `TEST-${randomUUID()}`, number?.e164 ?? "+15550000000"],
      );
      await addEvent(tx, call.id, a.restaurantId, "call.started", "SYSTEM", `Test call started by ${a.name ?? a.email}.`);
      const order = await createOrder(tx, { restaurantId: a.restaurantId, locationId: lid, callId: call.id, isTest: true, posMode: "DASHBOARD_TICKET", currency: loc.currency }, AI);
      await signal(tx, lid, { type: "call", id: call.id });
      return { orderId: order.id, callId: call.id };
    });
    return reply.status(201).send(created);
  });

  api.post("/locations/:lid/test-agent/orders/:oid/lines", async (req) => {
    const { lid, oid } = parse(orderParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const sel = parse(testLineInput, req.body);
    return tenant(deps, a, async (tx) => {
      const order = await testOrder(tx, lid, oid);
      const menu = await loadMenu(tx, lid);
      const problems = validateSelection(menu, sel, deps.now());
      if (problems.length) return { problems };
      const line = toOrderLine(menu, sel);
      await updateDraft(tx, order.id, { op: "add", line }, AI, order.version);
      if (order.callId) await addEvent(tx, order.callId, a.restaurantId, "tool.update_order_draft", "AI", `Added ${line.quantity} × ${line.itemName} (${line.variationName}).`);
      return { problems: [] };
    });
  });

  api.delete("/locations/:lid/test-agent/orders/:oid/lines/:n", async (req, reply) => {
    const { lid, oid } = parse(orderParam, req.params);
    const { n } = parse(z.object({ n: z.coerce.number().int().min(1).max(100) }), req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    await tenant(deps, a, async (tx) => {
      await testOrder(tx, lid, oid);
      await updateDraft(tx, oid, { op: "remove", lineNo: n }, AI);
    });
    return reply.status(204).send();
  });

  api.put("/locations/:lid/test-agent/orders/:oid/customer", async (req) => {
    const { lid, oid } = parse(orderParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const { name, phone } = parse(testCustomerInput, req.body);
    const p = parsePhone(phone, "US");
    if (!p?.isValid()) throw rule("That isn't a 10-digit US number. Read it back digit by digit.", "phone");
    return tenant(deps, a, async (tx) => {
      await testOrder(tx, lid, oid);
      await updateDraft(tx, oid, { op: "customer", customer: { name, phone: p.number, phoneSource: "SPOKEN" } }, AI);
      return { ok: true };
    });
  });

  // The read-back: price the order (Square if connected, otherwise a labelled estimate for tests) and move it to "ready".
  api.post("/locations/:lid/test-agent/orders/:oid/read-back", async (req) => {
    const { lid, oid } = parse(orderParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const order = await tenant(deps, a, (tx) => testOrder(tx, lid, oid));
    const check = await tenant(deps, a, async (tx) => {
      const settings = await getSettingsRow(tx, lid);
      return revalidate(order, await loadMenu(tx, lid), settings.menuStaleMaxAgeSeconds, deps.now());
    });
    if (!check.ok) throw rule(check.reason === "STALE_MENU" ? "The menu is out of date, so the AI won't take orders until it syncs." : `${check.problems[0]!.message} Remove it and offer something else.`);
    if (!order.customer.name || !order.customer.phone) throw rule("Ask for the caller's name and phone number first.");
    const priced = await priceOrder(deps, order);
    if (!priced.ok) throw rule(priced.message);
    return tenant(deps, a, async (tx) => {
      const ready = await transition(tx, oid, (o) => readyForConfirmation(o, { ...priced.totals, version: o.version }, 0, { actor: "AI", at: deps.now().toISOString() }), AI);
      if (ready.callId) await addEvent(tx, ready.callId, a.restaurantId, "tool.calculate_order_total", "AI", "Read the order back with the total.");
      return { version: ready.version, totals: priced.totals };
    });
  });

  api.post("/locations/:lid/test-agent/orders/:oid/confirm", async (req) => {
    const { lid, oid } = parse(orderParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const { version } = parse(testConfirmInput, req.body);
    return tenant(deps, a, async (tx) => {
      await testOrder(tx, lid, oid);
      const done = await transition(tx, oid, (o) => confirm(o, version, { actor: "AI", at: deps.now().toISOString() }), AI);
      if (done.callId) await addEvent(tx, done.callId, a.restaurantId, "tool.mark_customer_confirmation", "AI", `The caller confirmed version ${version}.`);
      return { ok: true };
    });
  });

  api.post("/locations/:lid/test-agent/orders/:oid/submit", async (req) => {
    const { lid, oid } = parse(orderParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    await tenant(deps, a, (tx) => testOrder(tx, lid, oid));
    const res = await submitConfirmedOrder(deps, oid);
    if (res.order.callId) {
      await tenant(deps, a, async (tx) => {
        await addEvent(tx, res.order.callId!, a.restaurantId, "tool.submit_confirmed_order", "AI", `Sent the order (${res.claim.toLowerCase().replace(/_/g, " ")}).`);
        await tx.query("update calls set caller_name = coalesce(caller_name, $2) where id = $1", [res.order.callId, res.order.customer.name ?? null]);
      });
    }
    return { claim: res.claim, say: whatToSay(res.claim, res.order) };
  });

  api.post("/locations/:lid/test-agent/orders/:oid/hang-up", async (req) => {
    const { lid, oid } = parse(orderParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    return tenant(deps, a, async (tx) => {
      const o = await testOrder(tx, lid, oid);
      if (IN_PROGRESS.has(o.status) && o.status !== "SUBMISSION_PENDING" && o.status !== "SUBMISSION_UNKNOWN") {
        await transition(tx, oid, (x) => abandon(x, { actor: "SYSTEM", at: deps.now().toISOString(), reason: "Test caller hung up" }), { actor: "SYSTEM" });
      }
      if (o.callId) {
        const done = await endCall(tx, o.callId, "completed", null);
        if (done.ended) await addEvent(tx, o.callId, a.restaurantId, "call.ended", "SYSTEM", "Test call ended.");
        await signal(tx, lid, { type: "call", id: o.callId });
      }
      return { ok: true };
    });
  });

  api.get("/locations/:lid/test-agent/orders/:oid", async (req) => {
    const { lid, oid } = parse(orderParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    return tenant(deps, a, (tx) => testOrder(tx, lid, oid));
  });
}
