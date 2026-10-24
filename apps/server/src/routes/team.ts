import { acceptInviteInput, inviteInput, type Invitation, type Member } from "@receptionist/contracts";
import { many, maybeOne, one, withSystem } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { audit, auditSystem } from "../audit.ts";
import { randomToken, sha256 } from "../crypto.ts";
import type { Deps } from "../deps.ts";
import { conflict, forbidden, notFound } from "../errors.ts";
import { idParam, meta, parse, ridParam, who } from "../http.ts";
import { tenant } from "./util.ts";

const INVITE_DAYS = 7;

export function registerTeamRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/restaurants/:rid/members", async (req): Promise<{ members: Member[]; invitations: Invitation[] }> => {
    const { rid } = parse(ridParam, req.params);
    const a = await deps.access.forRestaurant(who(req), rid, "members.view");
    return tenant(deps, a, async (tx) => {
      const members = await many<{ id: string; user_id: string; name: string | null; email: string; role: Member["role"]; status: Member["status"]; location_name: string | null; last_seen_at: string | null }>(
        tx,
        `select m.id, m.user_id, u.display_name as name, u.email, m.role, m.status, l.name as location_name, u.last_seen_at
           from memberships m join users u on u.id = m.user_id left join locations l on l.id = m.location_id
          where m.restaurant_id = $1 order by (m.status = 'ACTIVE') desc, m.created_at`,
        [rid],
      );
      const invites = await many<{ id: string; email: string; role: Invitation["role"]; invited_by_name: string; expires_at: string; created_at: string }>(
        tx,
        `select i.id, i.email, i.role, coalesce(u.display_name, u.email) as invited_by_name, i.expires_at, i.created_at
           from invitations i join users u on u.id = i.invited_by
          where i.restaurant_id = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() order by i.created_at desc`,
        [rid],
      );
      return {
        members: members.map((m) => ({
          membershipId: m.id, userId: m.user_id, name: m.name ?? m.email.split("@")[0]!, email: m.email, role: m.role,
          scope: m.location_name ?? "ALL_LOCATIONS", status: m.status, lastSeenAt: m.last_seen_at,
        })),
        invitations: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, invitedBy: i.invited_by_name, expiresAt: i.expires_at, createdAt: i.created_at })),
      };
    });
  });

  api.post("/restaurants/:rid/invitations", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { rid } = parse(ridParam, req.params);
    const a = await deps.access.forRestaurant(who(req), rid, "members.manage");
    const input = parse(inviteInput, req.body);
    const email = input.email.trim().toLowerCase();
    const token = randomToken();
    const created = await tenant(deps, a, async (tx) => {
      const already = await maybeOne(tx, "select 1 as x from memberships m join users u on u.id = m.user_id where m.restaurant_id = $1 and lower(u.email) = $2 and m.status = 'ACTIVE'", [rid, email]);
      if (already) throw conflict("That person is already on the team.", "email");
      if (input.locationId && !(await maybeOne(tx, "select 1 as x from locations where id = $1", [input.locationId]))) throw notFound("That location doesn't exist.");
      const expires = new Date(deps.now().getTime() + INVITE_DAYS * 86_400_000).toISOString();
      const r = await one<{ id: string }>(
        tx,
        `insert into invitations (restaurant_id, location_id, email, role, token_hash, invited_by, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [rid, input.locationId ?? null, email, input.role, sha256(token), a.userId, expires],
      );
      const restaurant = await one<{ name: string }>(tx, "select name from restaurants where id = $1", [rid]);
      await audit(tx, a, meta(req), { action: "members.invite", targetType: "invitation", targetId: r.id, target: email, summary: `Invited ${email} as ${input.role.toLowerCase()}.` });
      return { id: r.id, restaurantName: restaurant.name };
    });
    // The link is only ever emailed, never returned, so a leaked API response can't be used to join.
    const link = `${deps.config.DASHBOARD_ORIGIN.replace(/\/$/, "")}/invite?token=${encodeURIComponent(token)}`;
    await deps.providers.email?.send({
      to: email,
      subject: `You're invited to ${created.restaurantName}`,
      text: `${a.name ?? a.email} invited you to help manage ${created.restaurantName}'s phone orders.\n\nAccept the invitation: ${link}\n\nThe link works for ${INVITE_DAYS} days. If you weren't expecting this, you can ignore it.`,
    });
    return reply.status(201).send({ id: created.id });
  });

  api.delete("/invitations/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const inv = await withSystem(deps.db, (tx) => maybeOne<{ restaurant_id: string; email: string }>(tx, "select restaurant_id, email from invitations where id = $1", [id]));
    if (!inv) throw notFound();
    const a = await deps.access.forRestaurant(who(req), inv.restaurant_id, "members.manage");
    await tenant(deps, a, async (tx) => {
      await tx.query("update invitations set revoked_at = now() where id = $1 and accepted_at is null and revoked_at is null", [id]);
      await audit(tx, a, meta(req), { action: "members.invite_revoke", targetType: "invitation", targetId: id, target: inv.email, summary: `Cancelled the invite for ${inv.email}.` });
    });
    return reply.status(204).send();
  });

  // The signed-in person's email must match the invited address, so a forwarded link can't be used by someone else.
  api.post("/invitations/accept", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const id = who(req);
    const { token } = parse(acceptInviteInput, req.body);
    return withSystem(deps.db, async (tx) => {
      const inv = await maybeOne<{ id: string; restaurant_id: string; location_id: string | null; email: string; role: "MANAGER" | "STAFF" }>(
        tx,
        `select id, restaurant_id, location_id, email, role from invitations
          where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update`,
        [sha256(token)],
      );
      if (!inv) throw notFound("That invitation has expired or was cancelled. Ask for a new one.");
      if (inv.email.toLowerCase() !== id.email) throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
      await tx.query(
        `insert into memberships (restaurant_id, user_id, location_id, role, invited_by)
         select $1, $2, $3, $4, invited_by from invitations where id = $5
         on conflict do nothing`,
        [inv.restaurant_id, id.userId, inv.location_id, inv.role, inv.id],
      );
      await tx.query("update invitations set accepted_at = now() where id = $1", [inv.id]);
      await auditSystem(tx, inv.restaurant_id, { action: "members.accept", targetType: "invitation", targetId: inv.id, target: id.email, summary: `${id.email} joined as ${inv.role.toLowerCase()}.` });
      return { restaurantId: inv.restaurant_id, locationId: inv.location_id };
    });
  });
}
