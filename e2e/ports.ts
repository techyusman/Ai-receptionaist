// Ports for the end-to-end stack, away from the dev stack's. E2E_SLOT=1..3 shifts every port (and the data
// and output folders) so several copies of the suite can run side by side.
const slot = Number(process.env.E2E_SLOT ?? 0);
const ports = { pg: 54339 + 10 * slot, auth: 54331 + 10 * slot, square: 54340 + 10 * slot, api: 4100 + slot, web: 3100 + slot };
const suffix = slot ? `-${slot}` : "";

export const E2E = {
  ports,
  api: `http://localhost:${ports.api}`,
  auth: `http://127.0.0.1:${ports.auth}`,
  web: `http://localhost:${ports.web}`,
  dataDir: `.e2e-data${suffix}`,
  outputDir: `../.e2e-output${suffix}`,
};
