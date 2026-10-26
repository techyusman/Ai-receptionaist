import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// In development, a phone on the same Wi-Fi can open the dashboard at this computer's network address
// (http://10.x.x.x:3000) and call the AI with its microphone. Next only serves its dev files to addresses
// it's told about, so these are this computer's own current Wi-Fi/LAN addresses. Not used in production.
const lanAddresses =
  process.env.NODE_ENV === "production"
    ? []
    : Object.values(networkInterfaces())
        .flat()
        .filter((a) => a && a.family === "IPv4" && !a.internal)
        .map((a) => a!.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses,
  cacheComponents: true,
  partialPrefetching: true,
  // The domain package ships TypeScript source (shared with the API and voice tools).
  transpilePackages: ["@receptionist/domain", "@receptionist/contracts"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
