"use server";

import { createRestaurantInput } from "@receptionist/contracts";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/server/action";
import * as api from "@/server/api";
import { InputError } from "@/server/api";
import { ForbiddenError, NotFoundError } from "@/server/http/client";
import { chooseLocation } from "@/server/session";

// Becoming part of a restaurant: starting a new one, or accepting an invitation to an existing one.

export async function createRestaurant(input: z.input<typeof createRestaurantInput>): Promise<ActionResult> {
  const parsed = createRestaurantInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? "Check the form.", field: issue?.path.at(-1)?.toString() };
  }
  try {
    const r = await api.createRestaurant(parsed.data);
    await chooseLocation(r.locationId);
  } catch (e) {
    if (e instanceof InputError) return { ok: false, message: e.message, field: e.field };
    throw e;
  }
  redirect("/setup");
}

export async function acceptInvitation(token: string): Promise<ActionResult> {
  try {
    const r = await api.acceptInvitation(z.string().min(20).max(200).parse(token));
    if (r.locationId) await chooseLocation(r.locationId);
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof ForbiddenError || e instanceof InputError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: "That invitation link is incomplete. Open it again from the email." };
    throw e;
  }
  redirect("/");
}
