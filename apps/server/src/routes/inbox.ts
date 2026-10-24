// The small queues staff work from: callbacks the AI promised, and alerts that need a person.
import { callbackUpdateInput, can, type Alert, type Callback } from "@receptionist/contracts";
import { many, maybeOne } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import { notFound } from "../errors.ts";
import { idParam, lidParam, parse, who } from "../http.ts";
import { signal } from "../live.ts";
import { mask } from "./calls.ts";
import { tenant } from "./util.ts";

type CallbackRow = {
  id: string; call_id: string | null; customer_name: string; phone_e164: string; preferred_window: string | null; reason: string | null;
  status: Callback["status"]; created_at: string; handled_by_name: string | null; handled_at: string | null;
};
const CALLBACK_SELECT = `cb.id, cb.call_id, cb.customer_name, cb.phone_e164, cb.preferred_window, cb.reason, cb.status, cb.created_at,
  coalesce(u.display_name, u.email) as handled_by_name, cb.handled_at`;

export function registerInboxRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/callbacks", async (req): Promise<Callback[]> => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "calls.view");
    const { status } = parse(z.object({ status: z.enum(["OPEN", "DONE", "all"]).default("OPEN") }), req.query);
    const rows = await tenant(deps, a, (tx) =>
      many<CallbackRow>(
        tx,
        `select ${CALLBACK_SELECT} from callback_requests cb left join users u on u.id = cb.handled_by
          where cb.location_id = $1 and ($2 = 'all' or cb.status = $2) order by cb.created_at desc`,
        [lid, status],
      ),
    );
    // An open callback shows the full number to anyone who has to ring it; closed ones follow the usual masking.
    return rows.map((r) => ({
      id: r.id, callId: r.call_id, customerName: r.customer_name,
      phone: can(a.role, "calls.fullPhone") || r.status === "OPEN" ? r.phone_e164 : (mask(r.phone_e164) ?? ""),
      preferredWindow: r.preferred_window, reason: r.reason, status: r.status, createdAt: r.created_at, handledBy: r.handled_by_name, handledAt: r.handled_at,
    }));
  });

  api.patch("/callbacks/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "callback", id, "callbacks.handle");
    const { status } = parse(callbackUpdateInput, req.body);
    return tenant(deps, a, async (tx) => {
      const r = await maybeOne(
        tx,
        `update callback_requests set status = $2, handled_by = case when $2 = 'OPEN' then null else $3::uuid end,
                handled_at = case when $2 = 'OPEN' then null else now() end where id = $1 returning id`,
        [id, status, a.userId],
      );
      if (!r) throw notFound();
      await signal(tx, a.locationId, { type: "callback", id });
      return { ok: true };
    });
  });

  api.get("/locations/:lid/alerts", async (req): Promise<Alert[]> => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    const rows = await tenant(deps, a, (tx) =>
      many<{ id: string; kind: Alert["kind"]; severity: Alert["severity"]; message: string; order_id: string | null; call_id: string | null; created_at: string }>(
        tx,
        "select id, kind, severity, message, order_id, call_id, created_at from alerts where location_id = $1 and acknowledged_at is null order by created_at desc",
        [lid],
      ),
    );
    return rows.map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, message: r.message, orderId: r.order_id, callId: r.call_id, createdAt: r.created_at, acknowledgedAt: null }));
  });

  api.post("/alerts/:id/ack", async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "alert", id, "callbacks.handle");
    return tenant(deps, a, async (tx) => {
      await tx.query("update alerts set acknowledged_at = now(), acknowledged_by = $2 where id = $1 and acknowledged_at is null", [id, a.userId]);
      await signal(tx, a.locationId, { type: "alert", id });
      return { ok: true };
    });
  });
}
