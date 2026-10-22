import { noticeInput, type Notice } from "@receptionist/contracts";
import { many, maybeOne, one } from "@receptionist/db";
import { isOpenAt, localClock } from "@receptionist/domain";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { notFound } from "../errors.ts";
import { idParam, lidParam, meta, parse, who } from "../http.ts";
import { signal } from "../live.ts";
import { readHours, readSpecialHours } from "./hours.ts";
import { tenant } from "./util.ts";

type NoticeRow = { id: string; message: string; starts_at: string; ends_at: string };
const toNotice = (r: NoticeRow): Notice => ({ id: r.id, message: r.message, startsAt: r.starts_at, endsAt: r.ends_at });

export function registerNoticeRoutes(api: FastifyInstance, deps: Deps) {
  // Notices that are showing now or coming up; expired ones drop off the list.
  api.get("/locations/:lid/notices", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) =>
      (await many<NoticeRow>(tx, "select id, message, starts_at, ends_at from notices where location_id = $1 and ends_at > now() order by starts_at", [lid])).map(toNotice),
    );
  });

  api.post("/locations/:lid/notices", async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "settings.edit");
    const input = parse(noticeInput, req.body);
    const notice = await tenant(deps, a, async (tx) => {
      const r = await one<NoticeRow>(
        tx,
        `insert into notices (restaurant_id, location_id, message, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id, message, starts_at, ends_at`,
        [a.restaurantId, lid, input.message, input.startsAt, input.endsAt, a.userId],
      );
      await audit(tx, a, meta(req), { action: "notices.create", targetType: "notice", targetId: r.id, target: "Notice", summary: `Added a notice: “${input.message.slice(0, 80)}”.` });
      await signal(tx, lid, { type: "settings" });
      return toNotice(r);
    });
    return reply.status(201).send(notice);
  });

  api.delete("/notices/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "notice", id, "settings.edit");
    await tenant(deps, a, async (tx) => {
      const gone = await maybeOne(tx, "delete from notices where id = $1 returning id", [id]);
      if (!gone) throw notFound();
      await audit(tx, a, meta(req), { action: "notices.delete", targetType: "notice", targetId: id, target: "Notice", summary: "Removed a notice." });
      await signal(tx, a.locationId, { type: "settings" });
    });
    return reply.status(204).send();
  });

  // Is the location open for the store, and for orders, right now in its own time zone?
  api.get("/locations/:lid/open-state", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) => {
      const { timezone } = await one<{ timezone: string }>(tx, "select timezone from locations where id = $1", [lid]);
      const [hours, specials] = await Promise.all([readHours(tx, lid), readSpecialHours(tx, lid)]);
      const at = deps.now();
      return {
        storeOpen: isOpenAt(hours.store, specials, at, timezone),
        orderingOpen: isOpenAt(hours.ordering.length ? hours.ordering : hours.store, specials, at, timezone),
        today: localClock(at, timezone).date,
      };
    });
  });
}
