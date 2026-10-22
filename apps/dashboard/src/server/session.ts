import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Fake-layer session: an HMAC-signed user id in an httpOnly cookie. replica-backend replaces this
// with Supabase Auth (email code + Google), keeping getSessionUserId / startSession / endSession.

const COOKIE = "rcpt_session";
const LOCATION_COOKIE = "rcpt_location";
const MAX_AGE = 60 * 60 * 24 * 7;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production" && process.env.FAKE_DATA !== "1") {
    throw new Error("SESSION_SECRET (32+ characters) is required in production.");
  }
  return "dev-only-session-secret-not-for-production-use";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function verify(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const value = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(value));
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}

export async function getSessionUserId(): Promise<string | null> {
  return verify((await cookies()).get(COOKIE)?.value);
}

export async function startSession(userId: string) {
  (await cookies()).set(COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(LOCATION_COOKIE);
}

export async function getChosenLocationId(): Promise<string | null> {
  return (await cookies()).get(LOCATION_COOKIE)?.value ?? null;
}

export async function chooseLocation(locationId: string) {
  (await cookies()).set(LOCATION_COOKIE, locationId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE });
}

/** For the proxy's optimistic check only: is there a cookie at all (not whether it's valid). */
export const SESSION_COOKIE = COOKIE;
