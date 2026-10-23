import { many, withSystem } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { auditSystem } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { conflict, notConfigured, upstream } from "../errors.ts";
import { who } from "../http.ts";

/** Removes the sign-in at Supabase, with the project's service key (server-side only). */
async function deleteAuthUser(deps: Deps, userId: string): Promise<void> {
  const key = deps.config.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw notConfigured("Account deletion");
  const res = await fetch(`${deps.config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && res.status !== 404) throw upstream("Your sign-in couldn't be removed right now. Nothing was deleted; try again shortly.");
}

export function registerAccountRoutes(api: FastifyInstance, deps: Deps) {
  // Deleting your own account deletes it: the sign-in at Supabase, then your user row and every
  // membership. Orders and calls you touched keep their history, without your name on it.
  api.delete("/me", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (req, reply) => {
    const id = who(req);
    const owned = await withSystem(deps.db, (tx) =>
      many<{ name: string }>(tx, "select r.name from memberships m join restaurants r on r.id = m.restaurant_id where m.user_id = $1 and m.role = 'OWNER' and m.status = 'ACTIVE'", [id.userId]),
    );
    if (owned.length) throw conflict(`You own ${owned.map((o) => o.name).join(" and ")}. Hand the restaurant to someone else or close it before deleting your account.`);
    await deleteAuthUser(deps, id.userId);
    await withSystem(deps.db, async (tx) => {
      const teams = await many<{ restaurant_id: string }>(tx, "select distinct restaurant_id from memberships where user_id = $1", [id.userId]);
      await tx.query("delete from users where id = $1", [id.userId]);
      for (const t of teams) {
        await auditSystem(tx, t.restaurant_id, { action: "members.account_deleted", targetType: "user", target: "Team member", summary: "A team member deleted their account." });
      }
    });
    return reply.status(204).send();
  });
}
