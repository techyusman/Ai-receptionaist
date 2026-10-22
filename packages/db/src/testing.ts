// Starts a real, throw-away Postgres 18 for tests (the embedded-postgres package ships the binaries,
// so there is no Docker and no install). Every test file gets its own server on a free port.
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
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

export async function startTestDatabase(options: { migrate?: boolean } = {}): Promise<TestDatabase> {
  const dir = mkdtempSync(join(tmpdir(), "receptionist-pg-"));
  const port = await freePort();
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, onLog: () => {}, onError: () => {} });
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
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        // Windows can hold the folder a moment after Postgres exits; the OS temp cleaner takes it later.
      }
    },
  };
}
