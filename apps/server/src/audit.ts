// Every write leaves a line in audit_logs (append-only, outlives the tenant). The summary is the
// sentence the Audit log screen shows; before/after hold only what is safe to keep (never tokens).
import type { Tx } from "@receptionist/db";
import type { Access } from "./auth/access.ts";

export type RequestMeta = { requestId: string; ip: string | null; userAgent: string | null };

export async function audit(
  tx: Tx,
  who: Pick<Access, "userId" | "restaurantId" | "actorType">,
  meta: RequestMeta,
  entry: { action: string; targetType: string; targetId?: string | null; target: string; summary: string; before?: unknown; after?: unknown },
): Promise<void> {
  await tx.query(
    `insert into audit_logs (restaurant_id, actor_user_id, actor_type, action, target_type, target_id,
                             before_redacted, after_redacted, request_id, ip, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      who.restaurantId,
      who.userId,
      who.actorType,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      JSON.stringify({ target: entry.target, summary: entry.summary, ...(typeof entry.after === "object" && entry.after ? entry.after : {}) }),
      meta.requestId,
      meta.ip,
      meta.userAgent?.slice(0, 300) ?? null,
    ],
  );
}

/** For work done by the system itself (jobs, webhooks): no signed-in person. */
export async function auditSystem(
  tx: Tx,
  restaurantId: string | null,
  entry: { action: string; targetType: string; targetId?: string | null; target: string; summary: string },
): Promise<void> {
  await tx.query(
    `insert into audit_logs (restaurant_id, actor_user_id, actor_type, action, target_type, target_id, after_redacted)
     values ($1, null, 'SYSTEM', $2, $3, $4, $5)`,
    [restaurantId, entry.action, entry.targetType, entry.targetId ?? null, JSON.stringify({ target: entry.target, summary: entry.summary })],
  );
}
