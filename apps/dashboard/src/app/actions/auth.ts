"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/server/action";
import { getMe, readSession } from "@/server/auth";
import { chooseLocation, endSession, getAuth, startSession } from "@/server/session";
import { AuthRateLimited, revoke, sendCode, verifyCode as verify } from "@/server/supabase";

// Sign-in is an emailed one-time code from Supabase Auth. The same answer is given whether or not an
// address has an account, so the form can't be used to find out who works where.

const email = z.string().trim().toLowerCase().email("Enter the email you were invited with.");

/** Only paths inside this app; anything else (another site, a protocol-relative URL) falls back to home. */
const safeNext = (next: string | undefined) => (next && /^\/(?!\/)[\w\-/?=&%.]*$/.test(next) ? next : null);

export async function requestCode(input: { email: string }): Promise<ActionResult<{ email: string }>> {
  const parsed = email.safeParse(input.email);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message, field: "email" };
  try {
    await sendCode(parsed.data);
  } catch (e) {
    if (e instanceof AuthRateLimited) return { ok: false, message: e.message, field: "email" };
    console.error(e);
  }
  return { ok: true, data: { email: parsed.data } };
}

export async function verifyCode(input: { email: string; code: string; next?: string }): Promise<ActionResult> {
  const parsedEmail = email.safeParse(input.email);
  const code = input.code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, message: "Enter the 6-digit code.", field: "code" };
  let session;
  try {
    session = parsedEmail.success ? await verify(parsedEmail.data, code) : null;
  } catch (e) {
    if (e instanceof AuthRateLimited) return { ok: false, message: e.message, field: "code" };
    throw e;
  }
  if (!session) return { ok: false, message: "That code didn't work. Check the latest email, or send a new code.", field: "code" };
  await startSession(session);
  const next = safeNext(input.next);
  if (next) redirect(next);
  const me = await getMe();
  if (!me?.memberships.length) redirect("/welcome");
  redirect(me.memberships[0]!.role === "STAFF" ? "/live" : "/");
}

export async function signOut() {
  const auth = await getAuth();
  if (auth) await revoke(auth.access_token);
  await endSession();
  redirect("/login");
}

export async function switchLocation(locationId: string) {
  const session = await readSession();
  if (!session?.locations.some((l) => l.id === locationId)) return;
  await chooseLocation(locationId);
  redirect("/");
}
