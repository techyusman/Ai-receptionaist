import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import type { Role, Session } from "@/data/types";
import { can, type Capability } from "@/lib/permissions";
import { ForbiddenError, get } from "./http/client";
import { getAuth, getChosenLocationId } from "./session";

export { ForbiddenError as Forbidden };

export type Me = {
  user: { id: string; email: string; name: string };
  memberships: { restaurant: { id: string; name: string; slug: string }; role: Role; locations: { id: string; name: string }[] }[];
  pendingInvites: { id: string; restaurantName: string; role: string; expiresAt: string }[];
};

/** Who is signed in, asked of the API once per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  // Everything that depends on who is signed in renders per request, never ahead of time: say so before
  // anything else runs, so nothing on the way (the API call, its timers) counts as prerendering.
  await connection();
  if (!(await getAuth())) return null;
  return get<Me>("/me");
});

/** The signed-in person, their role and the location they're working in, or null. */
export async function readSession(): Promise<Session | null> {
  const me = await getMe();
  if (!me || me.memberships.length === 0) return null;
  const chosen = await getChosenLocationId();
  const membership = me.memberships.find((m) => m.locations.some((l) => l.id === chosen)) ?? me.memberships[0]!;
  const location = membership.locations.find((l) => l.id === chosen) ?? membership.locations[0];
  if (!location) return null;
  return { user: me.user, role: membership.role, restaurant: membership.restaurant, location, locations: membership.locations };
}

/** Sends the person to sign in, or to set up a restaurant if they have none yet. */
export async function requireSession(): Promise<Session> {
  const session = await readSession();
  if (session) return session;
  redirect((await getAuth()) ? "/welcome" : "/login");
}

/** For server actions and data reads: throws Forbidden instead of rendering a page. */
export async function requireCan(capability: Capability): Promise<Session> {
  const session = await requireSession();
  if (!can(session.role, capability)) throw new ForbiddenError();
  return session;
}
