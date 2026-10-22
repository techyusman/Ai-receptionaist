import { aliasInput, aliasRemoveQuery, overlayInput, type MenuStatus } from "@receptionist/contracts";
import { maybeOne, one } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { conflict, notFound } from "../errors.ts";
import { idParam, lidParam, meta, parse, who } from "../http.ts";
import { signal } from "../live.ts";
import { loadMenu } from "../menu/read.ts";
import { tenant } from "./util.ts";

export function registerMenuRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/menu", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, (tx) => loadMenu(tx, lid));
  });

  api.get("/locations/:lid/menu/status", async (req): Promise<MenuStatus> => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) => {
      const s = await maybeOne<{ last_success_at: string | null; last_status: string | null; last_error_code: string | null; is_stale: boolean }>(
        tx, "select last_success_at, last_status, last_error_code, is_stale from location_menu_status where location_id = $1", [lid]);
      const items = await one<{ n: number }>(tx, "select count(*)::int as n from menu_items where location_id = $1 and not is_deleted", [lid]);
      const connected = await maybeOne(tx, "select 1 as x from pos_integrations where location_id = $1 and status = 'CONNECTED' and pos_location_id is not null", [lid]);
      let state: MenuStatus["state"] = "fresh";
      if (s?.last_status === "RUNNING") state = "running";
      else if (!connected || !s?.last_success_at || s.last_status === "FAILED") state = "failed";
      else if (s.is_stale) state = "stale";
      return {
        state,
        lastSuccessAt: s?.last_success_at ?? null,
        lastErrorCode: !connected ? "NOT_CONNECTED" : s?.last_status === "FAILED" ? s.last_error_code : null,
        itemCount: items.n,
      };
    });
  });

  // The restaurant's own overlay on top of Square: hide an item from the AI, or 86 it until a time.
  api.patch("/menu-items/:id/overlay", async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "menuItem", id, "menu.overlay");
    const patch = parse(overlayInput, req.body);
    return tenant(deps, a, async (tx) => {
      const item = await maybeOne<{ name: string }>(tx, "select name from menu_items where id = $1 and not is_deleted", [id]);
      if (!item) throw notFound("That item isn't on the menu any more.");
      await tx.query(
        `update menu_items set ai_hidden = coalesce($2, ai_hidden),
                ai_unavailable_until = case when $3 then $4::timestamptz else ai_unavailable_until end,
                overlay_updated_by = $5 where id = $1`,
        [id, patch.aiHidden ?? null, "aiUnavailableUntil" in patch, patch.aiUnavailableUntil ?? null, a.userId],
      );
      const what = patch.aiHidden !== undefined ? (patch.aiHidden ? "Hid from the AI" : "Showed to the AI") : patch.aiUnavailableUntil ? "Marked unavailable" : "Marked available";
      await audit(tx, a, meta(req), { action: "menu.overlay", targetType: "menu_item", targetId: id, target: item.name, summary: `${what}: ${item.name}.` });
      await signal(tx, a.locationId, { type: "menu" });
      return { ok: true };
    });
  });

  api.post("/locations/:lid/menu/aliases", async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "menu.overlay");
    const { itemId, phrase } = parse(aliasInput, req.body);
    await tenant(deps, a, async (tx) => {
      const item = await maybeOne<{ name: string }>(tx, "select name from menu_items where id = $1 and location_id = $2 and not is_deleted", [itemId, lid]);
      if (!item) throw notFound("That item isn't on the menu any more.");
      const clash = await maybeOne<{ item_id: string; item_name: string }>(
        tx,
        `select i.id as item_id, i.name as item_name from menu_items i
          where i.location_id = $1 and not i.is_deleted and lower(i.name) = lower($2)
         union all
         select i.id, i.name from menu_aliases al join menu_items i on i.id = al.item_id
          where al.location_id = $1 and lower(al.phrase) = lower($2)`,
        [lid, phrase],
      );
      if (clash) throw conflict(clash.item_id === itemId ? "That's already on this item." : `“${phrase}” already means ${clash.item_name}.`, "phrase");
      await tx.query("insert into menu_aliases (restaurant_id, location_id, item_id, phrase, created_by) values ($1, $2, $3, $4, $5)", [a.restaurantId, lid, itemId, phrase, a.userId]);
      await audit(tx, a, meta(req), { action: "menu.alias", targetType: "menu_item", targetId: itemId, target: item.name, summary: `Callers can say “${phrase}” for ${item.name}.` });
      await signal(tx, lid, { type: "menu" });
    });
    return reply.status(201).send({ ok: true });
  });

  api.delete("/locations/:lid/menu/aliases", async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "menu.overlay");
    const { itemId, phrase } = parse(aliasRemoveQuery, req.query);
    await tenant(deps, a, async (tx) => {
      await tx.query("delete from menu_aliases where location_id = $1 and item_id = $2 and phrase = $3", [lid, itemId, phrase]);
      await signal(tx, lid, { type: "menu" });
    });
    return reply.status(204).send();
  });
}
