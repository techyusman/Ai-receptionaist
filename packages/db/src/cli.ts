// npm run migrate -w packages/db   (uses DATABASE_MIGRATE_URL: the table owner, not the login role the API uses)
import { createPool, migrate } from "./index.ts";

const [command] = process.argv.slice(2);
const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
if (command !== "migrate" || !url) {
  console.error("Usage: DATABASE_MIGRATE_URL=postgres://... node src/cli.ts migrate");
  process.exit(2);
}
const pool = createPool(url, { max: 1, applicationName: "migrate" });
try {
  const r = await migrate(pool);
  console.log(r.applied.length ? `Applied: ${r.applied.join(", ")}` : "Nothing to apply.");
} finally {
  await pool.end();
}
