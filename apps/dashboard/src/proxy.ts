import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, decodeSession, encodeSession, needsRefresh, refreshSession, SESSION_COOKIE } from "@/server/session-codec";

// Two jobs, both before any page renders: send people without a session to sign in, and renew a session
// that is about to expire (pages can't set cookies while rendering, so renewal has to happen here).
// Whether the session is valid, and what the person may see, is still decided by the API on every call.

// /api routes answer for themselves (the live stream returns 401 rather than a sign-in page).
const PUBLIC = ["/login", "/design", "/invite", "/api"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const session = decodeSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (isPublic) return NextResponse.next();
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (needsRefresh(session)) {
    const renewed = await refreshSession(session.refresh_token);
    if (!renewed) {
      if (isPublic) return NextResponse.next();
      const res = NextResponse.redirect(new URL("/login", request.url));
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    const value = encodeSession(renewed);
    // The page rendering now must see the new token too, not only the browser's next request.
    request.cookies.set(SESSION_COOKIE, value);
    const res = NextResponse.next({ request: { headers: request.headers } });
    res.cookies.set(SESSION_COOKIE, value, cookieOptions());
    return res;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
