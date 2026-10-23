import "server-only";
import { refreshSession, toSession, type AuthSession } from "./session-codec";

// Supabase Auth, through its public REST endpoints with the project's publishable (anon) key. Sign-in is
// an emailed one-time code. Only this server talks to Supabase; the browser never holds a token.

export type { AuthSession };

function base(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
  return { url: url.replace(/\/$/, ""), key };
}

async function call(path: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const { url, key } = base();
  return fetch(`${url}/auth/v1${path}`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", ...extra },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

export class AuthRateLimited extends Error {}

/** Emails a sign-in code. New addresses get an account, so a new restaurant can sign up the same way. */
export async function sendCode(email: string): Promise<void> {
  const res = await call("/otp", { email, create_user: true });
  if (res.status === 429) throw new AuthRateLimited("Too many codes were sent. Wait a minute, then try again.");
  // Any other failure is swallowed on purpose: the form answers the same either way.
}

export async function verifyCode(email: string, token: string): Promise<AuthSession | null> {
  const res = await call("/verify", { type: "email", email, token });
  if (res.status === 429) throw new AuthRateLimited("Too many tries. Wait a minute, then send a new code.");
  if (!res.ok) return null;
  return toSession(await res.json());
}

export const refresh = refreshSession;

/** Ends the session at Supabase too, so a copied token stops working. */
export async function revoke(accessToken: string): Promise<void> {
  await call("/logout", {}, { authorization: `Bearer ${accessToken}` }).catch(() => undefined);
}
