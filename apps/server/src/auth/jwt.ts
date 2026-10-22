// Verifies the access token the dashboard forwards. Supabase signs it; this server only needs the
// public keys. Only asymmetric algorithms are accepted, so a token signed with a guessed shared
// secret (or "none") can never pass.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { unauthenticated } from "../errors.ts";

export type Identity = { userId: string; email: string; name: string | null };
export type JwtVerifier = (token: string) => Promise<Identity>;

export function remoteJwks(url: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, timeoutDuration: 5_000 });
}

export function createJwtVerifier(opts: { keys: JWTVerifyGetKey; issuer: string; audience: string }): JwtVerifier {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, opts.keys, {
        issuer: opts.issuer,
        audience: opts.audience,
        algorithms: ["ES256", "RS256", "EdDSA"],
        clockTolerance: 5,
      });
      const sub = payload.sub;
      const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
      if (!sub || !/^[0-9a-f-]{36}$/i.test(sub) || !email) throw new Error("missing subject or email");
      const meta = payload.user_metadata as { name?: unknown; full_name?: unknown } | undefined;
      const name = [meta?.name, meta?.full_name].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? null;
      return { userId: sub, email, name };
    } catch {
      throw unauthenticated("Your session has expired. Sign in again.");
    }
  };
}
