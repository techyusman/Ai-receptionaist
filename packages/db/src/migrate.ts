import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type pg from "pg";

export const MIGRATIONS_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "migrations");

export type MigrateResult = { applied: string[]; skipped: string[] };

/**
 * Applies migrations/NNNN_name.sql in order, each in its own transaction, once. A migration that was
 * applied and later edited fails loudly: write a new migration instead. Safe to run from two machines
 * at once (advisory lock).
 */
export async function migrate(pool: pg.Pool, dir: string = MIGRATIONS_DIR): Promise<MigrateResult> {
  const files = readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const result: MigrateResult = { applied: [], skipped: [] };
  try {
    await client.query("select pg_advisory_lock(727274)");
    await client.query(
      `create table if not exists schema_migrations (
         version text primary key, checksum text not null, applied_at timestamptz not null default now())`,
    );
    const done = new Map<string, string>(
      (await client.query<{ version: string; checksum: string }>("select version, checksum from schema_migrations")).rows.map((r) => [r.version, r.checksum]),
    );
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const known = done.get(file);
      if (known) {
        if (known !== checksum) throw new Error(`Migration ${file} was changed after it was applied. Add a new migration instead.`);
        result.skipped.push(file);
        continue;
      }
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into schema_migrations (version, checksum) values ($1, $2)", [file, checksum]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
      result.applied.push(file);
    }
  } finally {
    await client.query("select pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
  return result;
}
