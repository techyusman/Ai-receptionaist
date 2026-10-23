// Starts a real, throw-away Postgres 18 for tests (the embedded-postgres package ships the binaries,
// so there is no Docker and no install). Every test file gets its own server on a free port.
import { createServer } from "node:net";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { createPool, migrate, type Db } from "./index.ts";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

export type TestDatabase = {
  /** Connects as the superuser; withTenant and withSystem switch to app_rw inside each transaction. */
  pool: Db;
  url: string;
  stop(): Promise<void>;
};

const PREFIX = "receptionist-pg-";

/** Folders left by a run that crashed or was killed: anything of ours older than two hours. */
function sweepStale() {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(PREFIX)) continue;
    const path = join(tmpdir(), name);
    try {
      if (Date.now() - statSync(path).mtimeMs > 2 * 3_600_000) rmSync(path, { recursive: true, force: true });
    } catch {
      // still in use by another run
    }
  }
}

async function removeWhenReleased(dir: string) {
  // Windows keeps files locked for a moment after Postgres exits; keep trying for a few seconds.
  for (let i = 0; i < 25; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export async function startTestDatabase(options: { migrate?: boolean } = {}): Promise<TestDatabase> {
  sweepStale();
  const dir = mkdtempSync(join(tmpdir(), PREFIX));
  const port = await freePort();
  // Throwaway data: small WAL segments and no fsync keep each test database to a few megabytes and fast.
  const server = new EmbeddedPostgres({
    databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, onLog: () => {}, onError: () => {},
    initdbFlags: ["--wal-segsize=1", "--no-sync"],
    postgresFlags: ["-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off", "-c", "max_wal_size=8MB", "-c", "min_wal_size=2MB"],
  });
  await server.initialise();
  await server.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  const pool = createPool(url, { max: 6, applicationName: "test" });
  if (options.migrate !== false) await migrate(pool);
  return {
    pool,
    url,
    async stop() {
      await pool.end().catch(() => {});
      await server.stop().catch(() => {});
      await removeWhenReleased(dir);
    },
  };
}
