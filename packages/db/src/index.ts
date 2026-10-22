// Every query in the API and worker goes through withTenant() or withSystem(). Both open a
// transaction, switch to the app_rw role (so row level security applies even if the login role
// owns the tables) and set the context the policies and triggers read.
import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export type ActorType = "SYSTEM" | "AI" | "STAFF" | "SUPPORT" | "WEBHOOK";

export type TenantContext = {
  restaurantId: string;
  userId?: string | null;
  /** Who the order_events trigger records. Defaults to SYSTEM. */
  actorType?: ActorType;
  requestId?: string;
  /** Free text the order_events trigger copies onto a status change. */
  reason?: string;
};

export type SystemContext = Omit<TenantContext, "restaurantId"> & { restaurantId?: string };

// Money is bigint minor units: safe as a JS number far beyond any restaurant order. Timestamps leave
// as ISO strings and dates as plain "YYYY-MM-DD", so nothing depends on the server's time zone.
const INT8 = 20;
const TIMESTAMPTZ = 1184;
const TIMESTAMP = 1114;
const DATE = 1082;
const types = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === INT8) return (v: string) => Number(v);
    if (oid === TIMESTAMPTZ) return (v: string) => new Date(v).toISOString();
    if (oid === TIMESTAMP) return (v: string) => new Date(`${v}Z`).toISOString();
    if (oid === DATE) return (v: string) => v;
    return pg.types.getTypeParser(oid, format as "text");
  },
};

export function createPool(connectionString: string, options: { max?: number; applicationName?: string } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "receptionist",
    // A stuck query should fail, not hold a phone call open.
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    types,
  });
  pool.on("error", () => {
    // An idle client dropped (database restart). The pool replaces it on the next checkout.
  });
  return pool;
}

async function run<T>(db: Db, settings: Record<string, string | undefined>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query("set local role app_rw");
    const entries = Object.entries(settings).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== "");
    if (entries.length) {
      const sql = entries.map((_, i) => `set_config($${i * 2 + 1}, $${i * 2 + 2}, true)`).join(", ");
      await client.query(`select ${sql}`, entries.flat());
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      // the connection is gone; release() below discards it
    }
    throw e;
  } finally {
    client.release();
  }
}

/** One transaction scoped to a single restaurant. A forgotten WHERE can still only see this tenant. */
export function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!ctx.restaurantId) throw new Error("withTenant needs a restaurantId");
  return run(
    db,
    {
      "app.restaurant_id": ctx.restaurantId,
      "app.user_id": ctx.userId ?? undefined,
      "app.actor_type": ctx.actorType,
      "app.request_id": ctx.requestId,
      "app.reason": ctx.reason,
    },
    fn,
  );
}

/**
 * Cross-tenant work: resolving a tenant from a called number, webhook ingress, schedulers, signing up.
 * Keep the callbacks short and never hand a system transaction to code that takes ids from a caller.
 */
export function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>, ctx: SystemContext = {}): Promise<T> {
  return run(
    db,
    {
      "app.system": "on",
      "app.restaurant_id": ctx.restaurantId,
      "app.user_id": ctx.userId ?? undefined,
      "app.actor_type": ctx.actorType,
      "app.request_id": ctx.requestId,
      "app.reason": ctx.reason,
    },
    fn,
  );
}

/** A transaction where only the user is known: lists a person's own restaurants. */
export function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return run(db, { "app.user_id": userId }, fn);
}

type Queryable = Pick<Tx, "query">;

export async function one<T extends pg.QueryResultRow = Record<string, unknown>>(tx: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const r = await tx.query<T>(sql, params);
  const row = r.rows[0];
  if (!row) throw new NotFoundError();
  return row;
}

export async function maybeOne<T extends pg.QueryResultRow = Record<string, unknown>>(tx: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await tx.query<T>(sql, params)).rows[0] ?? null;
}

export async function many<T extends pg.QueryResultRow = Record<string, unknown>>(tx: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query<T>(sql, params)).rows;
}

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Postgres error codes the API turns into 4xx answers. */
export const PG = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  serializationFailure: "40001",
  deadlock: "40P01",
  notNullViolation: "23502",
} as const;

export function pgError(e: unknown): { code: string; constraint?: string; message: string } | null {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    const { code, constraint, message } = e as { code: string; constraint?: string; message: string };
    if (/^[0-9A-Z]{5}$/.test(code)) return { code, constraint, message };
  }
  return null;
}

export { migrate, type MigrateResult } from "./migrate.ts";
