import { createRestaurantInput } from "@receptionist/contracts";
import { many, one, pgError, PG, withSystem } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { auditSystem } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { conflict } from "../errors.ts";
import { parse, ridParam, who } from "../http.ts";
import { z } from "zod";

const slugify = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "restaurant";

export function registerMeRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/me", async (req) => {
    const id = who(req);
    const [user, memberships, invites] = await Promise.all([
      deps.access.userRow(id.userId),
      deps.access.memberships(id.userId),
      withSystem(deps.db, (tx) =>
        many<{ id: string; restaurant_name: string; role: string; expires_at: string }>(
          tx,
          `select i.id, r.name as restaurant_name, i.role, i.expires_at from invitations i join restaurants r on r.id = i.restaurant_id
            where lower(i.email) = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`,
          [id.email],
        ),
      ),
    ]);
    return {
      user: { id: user.id, email: user.email, name: user.display_name ?? user.email.split("@")[0]! },
      memberships,
      pendingInvites: invites.map((i) => ({ id: i.id, restaurantName: i.restaurant_name, role: i.role, expiresAt: i.expires_at })),
    };
  });

  // Signing up: the first restaurant, its first location with default settings, and the owner seat,
  // all in one system transaction (a signed-in person has no restaurant to scope to yet).
  api.post("/restaurants", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const id = who(req);
    const input = parse(createRestaurantInput, req.body);
    const owned = await deps.access.memberships(id.userId);
    if (owned.filter((m) => m.role === "OWNER").length >= 5) throw conflict("You already own five restaurants. Contact support to add more.");
    const base = slugify(input.name);
    for (let attempt = 0; attempt < 6; attempt++) {
      const slug = attempt === 0 ? base : attempt < 5 ? `${base}-${attempt + 1}` : `${base}-${Math.random().toString(16).slice(2, 6)}`;
      try {
        const result = await withSystem(deps.db, async (tx) => {
          const r = await one<{ id: string }>(tx, "insert into restaurants (name, slug, created_by) values ($1, $2, $3) returning id", [input.name, slug, id.userId]);
          const a = input.location.address;
          const l = await one<{ id: string }>(
            tx,
            `insert into locations (restaurant_id, name, timezone, address_line1, address_line2, city, region, postal_code, country)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
            [r.id, input.location.name, input.location.timezone, a.line1, a.line2 ?? null, a.city, a.region, a.postalCode, a.country.toUpperCase()],
          );
          await tx.query("insert into location_settings (location_id, restaurant_id) values ($1, $2)", [l.id, r.id]);
          await tx.query("insert into memberships (restaurant_id, user_id, role) values ($1, $2, 'OWNER')", [r.id, id.userId]);
          await auditSystem(tx, r.id, { action: "restaurant.create", targetType: "restaurant", targetId: r.id, target: input.name, summary: `${id.email} created the restaurant.` });
          return { restaurantId: r.id, locationId: l.id, slug };
        });
        return reply.status(201).send(result);
      } catch (e) {
        if (pgError(e)?.code === PG.uniqueViolation && pgError(e)?.constraint === "restaurants_slug_key") continue;
        throw e;
      }
    }
    throw conflict("A restaurant with that name already exists. Try adding the town.");
  });

  api.get("/restaurants/:rid", async (req) => {
    const { rid } = parse(ridParam, req.params);
    const a = await deps.access.forRestaurant(who(req), rid);
    return withSystem(deps.db, async (tx) => {
      const r = await one<{ id: string; name: string; slug: string }>(tx, "select id, name, slug from restaurants where id = $1", [a.restaurantId]);
      const locations = await many<{ id: string; name: string }>(tx, "select id, name from locations where restaurant_id = $1 order by created_at", [a.restaurantId]);
      return { ...r, role: a.role, locations };
    });
  });

  api.patch("/restaurants/:rid", async (req) => {
    const { rid } = parse(ridParam, req.params);
    const a = await deps.access.forRestaurant(who(req), rid, "privacy.edit");
    const { name } = parse(z.object({ name: z.string().trim().min(1, "Give the restaurant a name.").max(120) }), req.body);
    return withSystem(deps.db, async (tx) => {
      await tx.query("update restaurants set name = $2 where id = $1", [a.restaurantId, name]);
      await auditSystem(tx, a.restaurantId, { action: "restaurant.rename", targetType: "restaurant", targetId: a.restaurantId, target: name, summary: `Renamed the restaurant to ${name}.` });
      return { id: a.restaurantId, name };
    });
  });
}
