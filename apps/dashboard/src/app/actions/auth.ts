"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/server/action";
import { readSession } from "@/server/auth";
import { store } from "@/server/fake/store";
import { chooseLocation, endSession, startSession } from "@/server/session";

// Fake sign-in for the fake data layer: any seeded email, and the one-time code below. Supabase
// Auth replaces this with real emailed codes and Google sign-in (architecture.md, "auth").
const FAKE_CODE = "246810";

const email = z.string().trim().toLowerCase().email("Enter the email you were invited with.");

export async function requestCode(input: { email: string }): Promise<ActionResult<{ email: string }>> {
  const parsed = email.safeParse(input.email);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message, field: "email" };
  // Same answer whether or not the email exists, so the form doesn't reveal who has an account.
  return { ok: true, data: { email: parsed.data } };
}

export async function verifyCode(input: { email: string; code: string }): Promise<ActionResult> {
  const parsedEmail = email.safeParse(input.email);
  const code = input.code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, message: "Enter the 6-digit code.", field: "code" };
  const user = parsedEmail.success ? store().state.users.find((u) => u.email === parsedEmail.data) : undefined;
  const member = user && store().state.memberships.find((m) => m.userId === user.id && m.status === "ACTIVE");
  if (!user || !member || code !== FAKE_CODE) {
    return { ok: false, message: "That code didn't work. Check the latest email, or send a new code.", field: "code" };
  }
  user.lastSeenAt = new Date().toISOString();
  await startSession(user.id);
  redirect(member.role === "STAFF" ? "/live" : "/");
}

export async function signOut() {
  await endSession();
  redirect("/login");
}

export async function switchLocation(locationId: string) {
  const session = await readSession();
  if (!session?.locations.some((l) => l.id === locationId)) return;
  await chooseLocation(locationId);
  redirect("/");
}
