import { hoursInput, noticeInput, specialHoursInput, type Hours, type Notice, type SpecialHours } from "@receptionist/contracts";
import { many, maybeOne, type Tx } from "@receptionist/db";
import { findOverlaps, isOpenAt, localClock, type Shift } from "@receptionist/domain";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { conflict, notFound, rule } from "../errors.ts";
import { idParam, lidParam, meta, parse, who } from "../http.ts";
import { signal } from "../live.ts";
import { hm, tenant } from "./util.ts";

export async function readHours(tx: Tx, locationId: string): Promise<Hours> {
  const rows = await many<{ kind: "STORE" | "ORDERING"; weekday: number; opens_at: string; closes_at: string }>(
    tx,
    "select kind, weekday, opens_at, closes_at from business_hours where location_id = $1 order by weekday, opens_at",
    [locationId],
  );
  const shift = (r: (typeof rows)[number]): Shift => ({ weekday: r.weekday, opens: hm(r.opens_at), closes: hm(r.closes_at) });
  return { store: rows.filter((r) => r.kind === "STORE").map(shift), ordering: rows.filter((r) => r.kind === "ORDERING").map(shift) };
}

export async function readSpecialHours(tx: Tx, locationId: string): Promise<SpecialHours[]> {
  const rows = await many<{ id: string; on_date: string; closed: boolean; opens_at: string | null; closes_at: string | null; note: string | null }>(
    tx,
    "select id, on_date, closed, opens_at, closes_at, note from special_hours where location_id = $1 order by on_date, opens_at",
    [locationId],
  );
  return rows.map((r) => ({
    id: r.id, date: r.on_date, closed: r.closed, note: r.note,
    ...(r.opens_at ? { opens: hm(r.opens_at) } : {}), ...(r.closes_at ? { closes: hm(r.closes_at) } : {}),
  }));
}

export function registerHoursRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/hours", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, (tx) => readHours(tx, lid));
  });

  // Replaces the whole week in one transaction: either all of it saves or none of it.
  api.put("/locations/:lid/hours", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "settings.edit");
    const input = parse(hoursInput, req.body);
    for (const kind of ["store", "ordering"] as const) {
      const overlaps = findOverlaps(input[kind]);
      if (overlaps.length) throw rule(overlaps[0]!.message, kind);
    }
    return tenant(deps, a, async (tx) => {
      await tx.query("delete from business_hours where location_id = $1", [lid]);
      for (const kind of ["store", "ordering"] as const) {
        for (const s of input[kind]) {
          await tx.query(
            "insert into business_hours (restaurant_id, location_id, kind, weekday, opens_at, closes_at) values ($1, $2, $3, $4, $5, $6)",
            [a.restaurantId, lid, kind.toUpperCase(), s.weekday, s.opens, s.closes],
          );
        }
      }
      await audit(tx, a, meta(req), { action: "hours.update", targetType: "location", targetId: lid, target: "Opening hours", summary: "Updated the weekly hours." });
      await signal(tx, lid, { type: "settings" });
      return readHours(tx, lid);
    });
  });

  api.get("/locations/:lid/special-hours", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, (tx) => readSpecialHours(tx, lid));
  });

  api.post("/locations/:lid/special-hours", async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "settings.edit");
    const input = parse(specialHoursInput, req.body);
    return tenant(deps, a, async (tx) => {
      // A day is either closed or has hours. Both at once would list hours on screen while callers
      // are told "closed" (a closure wins), so the second one is refused, not stored.
      await tx.query("select 1 from locations where id = $1 for update", [lid]);
      const sameDay = await many<{ closed: boolean }>(tx, "select closed from special_hours where location_id = $1 and on_date = $2", [lid, input.date]);
      if (!input.closed && sameDay.some((d) => d.closed)) throw conflict("That day is marked closed. Remove the closure first to add hours.", "date");
      if (input.closed && sameDay.some((d) => d.closed)) throw conflict("That day is already marked closed.", "date");
      if (input.closed && sameDay.some((d) => !d.closed)) throw conflict("That day already has special hours. Remove them first to mark it closed.", "date");
      await tx.query(
        `insert into special_hours (restaurant_id, location_id, on_date, closed, opens_at, closes_at, note, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [a.restaurantId, lid, input.date, input.closed, input.closed ? null : input.opens, input.closed ? null : input.closes, input.note ?? null, a.userId],
      );
      await audit(tx, a, meta(req), {
        action: "hours.special", targetType: "location", targetId: lid, target: input.date,
        summary: input.closed ? `Closed on ${input.date}.` : `Special hours on ${input.date}.`,
      });
      await signal(tx, lid, { type: "settings" });
      void reply.status(201);
      return readSpecialHours(tx, lid);
    });
  });

  api.delete("/special-hours/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "specialHours", id, "settings.edit");
    await tenant(deps, a, async (tx) => {
      await tx.query("delete from special_hours where id = $1", [id]);
      await signal(tx, a.locationId, { type: "settings" });
    });
    return reply.status(204).send();
  });
}
