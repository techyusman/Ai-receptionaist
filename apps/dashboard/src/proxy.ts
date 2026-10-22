import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: no session cookie means "go sign in". Whether the cookie is valid, and what
// the person may see, is decided in the data layer (src/server/auth.ts) on every read and action.

const SESSION_COOKIE = "rcpt_session";
const PUBLIC = ["/login", "/design"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico).*)"],
};
