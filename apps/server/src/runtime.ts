// Builds the production dependencies from configuration. Shared by the web process and the worker.
import { createPool } from "@receptionist/db";
import { AccessService } from "./auth/access.ts";
import { createJwtVerifier, remoteJwks } from "./auth/jwt.ts";
import { jwksUrl, type Config } from "./config.ts";
import { keyringFrom, TokenCipher } from "./crypto.ts";
import type { Deps } from "./deps.ts";
import type { JobQueue } from "./jobs/queue.ts";
import { LiveBus } from "./live.ts";
import { buildProviders } from "./providers/build.ts";

export function buildDeps(config: Config, jobs: JobQueue, bus: LiveBus, opts: { poolSize: number; name: string }): Deps {
  const db = createPool(config.DATABASE_URL, { max: opts.poolSize, applicationName: opts.name });
  return {
    config,
    db,
    bus,
    jobs,
    access: new AccessService(db),
    verify: createJwtVerifier({ keys: remoteJwks(jwksUrl(config)), issuer: `${config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`, audience: config.SUPABASE_JWT_AUDIENCE }),
    cipher: new TokenCipher(keyringFrom(config)),
    providers: buildProviders(config),
    now: () => new Date(),
  };
}
