import { memberChangeInput, PAGE_SIZE, supportGrantInput, type AuditEntry, type Page } from "@receptionist/contracts";
import { many, maybeOne, one, withSystem } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { notFound, rule } from "../errors.ts";
import { idParam, meta, parse, ridParam, who } from "../http.ts";
import { tenant } from "./util.ts";

export function registerAdminRoutes(api: FastifyInstance, deps: Deps) {
  api.patch("/restaurants/:rid/members/:mid", async (req) => {
    const { rid } = parse(ridParam, req.params);
    const { mid } = parse(z.object({ mid: z.uuid() }), req.params);
    const a = await deps.access.forRestaurant(who(req), rid, "members.manage");
    const change = parse(memberChangeInput, req.body);
    return tenant(deps, a, async (tx) => {
      const m = await maybeOne<{ user_id: string; role: string; name: string }>(
        tx,
        "select m.user_id, m.role, coalesce(u.display_name, u.email) as name from memberships m join users u on u.id = m.user_id where m.id = $1 and m.restaurant_id = $2",
        [mid, rid],
      );
      if (!m) throw notFound("That person isn't on the team.");
      if (m.user_id === a.userId) throw rule("You can't change your own access. Ask another owner.");
      if (m.role === "OWNER") throw rule("Ownership moves through support, not here.");
      if (change.revoke) {
        await tx.query("update memberships set status = 'REVOKED', revoked_at = now() where id = $1", [mid]);
        await audit(tx, a, meta(req), { action: "members.revoke", targetType: "membership", targetId: mid, target: m.name, summary: `Removed ${m.name}'s access.` });
      } else if (change.role) {
        await tx.query("update memberships set role = $2 where id = $1", [mid, change.role]);
        await audit(tx, a, meta(req), { action: "members.role", targetType: "membership", targetId: mid, target: m.name, summary: `Made ${m.name} ${change.role.toLowerCase()}.` });
      }
      return { ok: true };
    });
  });

  api.get("/restaurants/:rid/audit-log", async (req): Promise<Page<AuditEntry>> => {
    const { rid } = parse(ridParam, req.params);
    const a = await deps.access.forRestaurant(who(req), rid, "audit.view");
    const { cursor } = parse(z.object({ cursor: z.string().max(40).nullish() }), req.query);
    const offset = Math.max(0, Number(cursor) || 0);
    return tenant(deps, a, async (tx) => {
      const total = await one<{ n: number }>(tx, "select count(*)::int as n from audit_logs where restaurant_id = $1", [rid]);
      const rows = await many<{ id: string; occurred_at: string; actor_type: AuditEntry["actorType"]; action: string; target_type: string; actor_name: string | null; after_redacted: { target?: string; summary?: string } | null }>(
        tx,
        `select l.id, l.occurred_at, l.actor_type, l.action, l.target_type, coalesce(u.display_name, u.email) as actor_name, l.after_redacted
           from audit_logs l left join users u on u.id = l.actor_user_id
          where l.restaurant_id = $1 order by l.occurred_at desc, l.id limit ${PAGE_SIZE} offset ${offset}`,
        [rid],
      );
      return {
        items: rows.map((r) => ({
          id: r.id, at: r.occurred_at, actorName: r.actor_name ?? "System", actorType: r.actor_type, action: r.action,
          target: r.after_redacted?.target ?? r.target_type, summary: r.after_redacted?.summary ?? r.action,
        })),
        total: total.n,
        nextCursor: offset + PAGE_SIZE < total.n ? String(offset + PAGE_SIZE) : null,
      };
    });
  });

  // Support staff see a restaurant only while an owner has granted it, for a set time, with a reason on record.
  api.post("/restaurants/:rid/support-grants", async (req, reply) => {
    const { rid } = parse(ridParam, req.params);
    const a = await deps.access.forRestaurant(who(req), rid, "members.manage");
    const input = parse(supportGrantInput, req.body);
    const grant = await tenant(deps, a, async (tx) => {
      const support = await withSystem(deps.db, (sys) => maybeOne<{ id: string }>(sys, "select id from users where lower(email) = lower($1)", [input.supportEmail]));
      if (!support) throw rule("That person hasn't signed in yet, so there is no account to give access to.", "supportEmail");
      const expires = new Date(deps.now().getTime() + input.hours * 3_600_000).toISOString();
      const r = await one<{ id: string }>(
        tx,
        `insert into support_access_grants (restaurant_id, support_user_id, granted_by, reason, scope, expires_at)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [rid, support.id, a.userId, input.reason, input.scope, expires],
      );
      await audit(tx, a, meta(req), { action: "support.grant", targetType: "support_grant", targetId: r.id, target: input.supportEmail, summary: `Gave ${input.supportEmail} ${input.scope.toLowerCase().replaceAll("_", " ")} access for ${input.hours} hours.` });
      return { id: r.id, expiresAt: expires };
    });
    return reply.status(201).send(grant);
  });

  api.delete("/support-grants/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const g = await withSystem(deps.db, (tx) => maybeOne<{ restaurant_id: string }>(tx, "select restaurant_id from support_access_grants where id = $1", [id]));
    if (!g) throw notFound();
    const a = await deps.access.forRestaurant(who(req), g.restaurant_id, "members.manage");
    await tenant(deps, a, async (tx) => {
      await tx.query("update support_access_grants set revoked_at = now() where id = $1 and revoked_at is null", [id]);
      await audit(tx, a, meta(req), { action: "support.revoke", targetType: "support_grant", targetId: id, target: "Support access", summary: "Ended a support access grant." });
    });
    return reply.status(204).send();
  });
}
