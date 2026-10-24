// End-to-end tests against the clone, never the original. Playwright starts its own copy of the backend
// (the dev stack: real Postgres, stand-ins for Supabase sign-in and Square, freshly seeded each run, on
// ports that don't clash with a dev stack you may have open) and the built dashboard, then drives Edge.
//   npm run e2e            build the dashboard, then run everything
//   npx playwright test -c e2e f03     run one flow (after a build)
//   E2E_SLOT=2 npx playwright test -c e2e f08   a second copy on other ports, beside a running one
import { defineConfig } from "@playwright/test";
import { E2E } from "./ports";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1, // one seeded café, shared: tests run in order and leave it usable for the next
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: E2E.outputDir,
  reporter: [["list"], ["json", { outputFile: `${E2E.outputDir}/results.json` }]],
  use: {
    baseURL: E2E.web,
    channel: "msedge",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node apps/server/scripts/dev-stack.ts",
      cwd: "..",
      url: `${E2E.api}/healthz`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: process.env.E2E_SERVER_LOG ? "pipe" : "ignore", // E2E_SERVER_LOG=1 shows the API's request log
      env: {
        DEV_DATA_DIR: E2E.dataDir,
        DEV_FRESH: "1",
        DEV_PG_PORT: String(E2E.ports.pg),
        DEV_AUTH_PORT: String(E2E.ports.auth),
        DEV_SQUARE_PORT: String(E2E.ports.square),
        PORT: String(E2E.ports.api),
        DASHBOARD_ORIGIN: E2E.web,
      },
    },
    {
      command: `node node_modules/next/dist/bin/next start apps/dashboard -p ${E2E.ports.web}`,
      cwd: "..",
      url: `${E2E.web}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { API_BASE_URL: E2E.api, SUPABASE_URL: E2E.auth, SUPABASE_ANON_KEY: "dev", DEV_SIGN_IN_HINT: "1" },
    },
  ],
});
