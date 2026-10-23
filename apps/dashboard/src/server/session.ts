import "server-only";
import { cookies } from "next/headers";
import { cookieOptions, decodeSession, encodeSession, LOCATION_COOKIE, SESSION_COOKIE, type AuthSession } from "./session-codec";

// The Supabase session lives in one httpOnly cookie (never readable by page scripts). The proxy renews it
// shortly before it expires; Server Actions replace it on sign-in and clear it on sign-out.

export { SESSION_COOKIE };

export async function getAuth(): Promise<AuthSession | null> {
  return decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function startSession(s: AuthSession) {
  (await cookies()).set(SESSION_COOKIE, encodeSession(s), cookieOptions());
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(LOCATION_COOKIE);
}

export async function getChosenLocationId(): Promise<string | null> {
  return (await cookies()).get(LOCATION_COOKIE)?.value ?? null;
}

export async function chooseLocation(locationId: string) {
  (await cookies()).set(LOCATION_COOKIE, locationId, cookieOptions());
}
