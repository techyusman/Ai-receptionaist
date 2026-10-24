// The one-time pass that lets Twilio open the media stream for exactly one call. The voice webhook
// issues it inside the TwiML; the stream endpoint accepts a connection only with a valid, unexpired
// pass whose call id exists. Signed with a server secret, so nobody can open a stream for a call
// they invented or reuse one after it has expired.
import { createHmac, timingSafeEqual } from "node:crypto";

export type StreamClaim = { callId: string; exp: number; resume: boolean; /** Spent when the stream opens, so a pass works once. */ nonce: string };

const b64 = (s: string) => Buffer.from(s).toString("base64url");

export function signStreamToken(secret: string, claim: StreamClaim): string {
  const body = b64(JSON.stringify(claim));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyStreamToken(secret: string, token: string | undefined, now = Date.now()): StreamClaim | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url"));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StreamClaim;
    if (typeof claim.callId !== "string" || typeof claim.nonce !== "string" || typeof claim.exp !== "number" || claim.exp < now) return null;
    return claim;
  } catch {
    return null;
  }
}
