import { NextResponse } from "next/server";
import { LOCATION_COOKIE, SESSION_COOKIE } from "@/server/session-codec";

// Where the dashboard sends someone whose session the API refused (it expired early, the account was
// deleted, the sign-in keys changed). Pages can't change cookies while rendering, so this route removes the
// dead one before the sign-in page loads; otherwise the sign-in page would keep finding it and loop.
export function GET(request: Request) {
  const res = NextResponse.redirect(new URL("/login", request.url));
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(LOCATION_COOKIE);
  return res;
}
