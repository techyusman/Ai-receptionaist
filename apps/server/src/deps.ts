// Everything a route or job needs from outside, passed in rather than imported, so tests hand in
// fakes (a local key set, a stubbed Twilio) and production hands in the real clients.
import type { Db } from "@receptionist/db";
import type { AccessService } from "./auth/access.ts";
import type { JwtVerifier } from "./auth/jwt.ts";
import type { Config } from "./config.ts";
import type { TokenCipher } from "./crypto.ts";
import type { JobQueue } from "./jobs/queue.ts";
import type { LiveBus } from "./live.ts";
import type { Providers } from "./providers/index.ts";

export type Deps = {
  config: Config;
  db: Db;
  access: AccessService;
  verify: JwtVerifier;
  bus: LiveBus;
  cipher: TokenCipher;
  providers: Providers;
  jobs: JobQueue;
  /** Injected so tests can freeze or move time. */
  now: () => Date;
};
