// npm run migrate -w apps/server
// Applies the SQL migrations, installs or upgrades the job queue, and grants the application role what it
// needs. Uses DATABASE_MIGRATE_URL (the table owner); the running app never has these rights.
import { createPool, migrate } from "@receptionist/db";
import { grantQueueAccess, PgBossQueue } from "../src/jobs/pgboss.ts";

const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_MIGRATE_URL (or DATABASE_URL) to the database owner's connection string.");
  process.exit(2);
}
const pool = createPool(url, { max: 2, applicationName: "migrate" });
try {
  const r = await migrate(pool);
  console.log(r.applied.length ? `Applied migrations: ${r.applied.join(", ")}` : "Migrations: up to date.");
  const queue = new PgBossQueue(url, "install");
  await queue.install();
  await queue.stop();
  await grantQueueAccess(pool);
  console.log("Job queue installed and granted to app_rw.");
  const login = process.env.APP_DB_ROLE;
  if (login) {
    // The login role the API and worker connect as becomes a member of app_rw (and nothing more).
    await pool.query(`grant app_rw to ${login.replace(/[^a-z0-9_]/gi, "")}`);
    console.log(`Granted app_rw to ${login}.`);
  }
} finally {
  await pool.end();
}
