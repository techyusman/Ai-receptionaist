// Shared by the proxy and the server: how the Supabase session is stored in its cookie, and how it is
// renewed. No "server-only" import here, because the proxy is bundled without React's server condition.

export type AuthSession = { access_token: string; refresh_token: string; expires_at: number };

export const SESSION_COOKIE = "rcpt_session";
export const LOCATION_COOKIE = "rcpt_location";
const MAX_AGE = 60 * 60 * 24 * 30;

export const cookieOptions = () => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });

export function encodeSession(s: AuthSession): string {
  return Buffer.from(JSON.stringify(s)).toString("base64url");
}

export function decodeSession(raw: string | undefined): AuthSession | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as AuthSession;
    return typeof s.access_token === "string" && typeof s.refresh_token === "string" ? s : null;
  } catch {
    return null;
  }
}

export function toSession(j: { access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number }): AuthSession | null {
  if (!j.access_token || !j.refresh_token) return null;
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600) };
}

/** Spends the refresh token for a new session. Supabase refresh tokens are single-use. */
export async function refreshSession(refreshToken: string): Promise<AuthSession | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? toSession(await res.json()) : null;
  } catch {
    return null;
  }
}

/** Renew a little early, so a page that takes a few seconds never sends an expired token to the API. */
export const needsRefresh = (s: AuthSession, nowSeconds = Date.now() / 1000) => s.expires_at - nowSeconds < 120;
