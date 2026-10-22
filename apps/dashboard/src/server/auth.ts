import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "@/data/types";
import { can, type Capability } from "@/lib/permissions";
import { store } from "./fake/store";
import { getChosenLocationId, getSessionUserId } from "./session";

export class Forbidden extends Error {
  constructor(capability: Capability) {
    super(`Your role can't do this (${capability}).`);
    this.name = "Forbidden";
  }
}

/** The signed-in person, their role and the location they're working in, or null. */
export async function readSession(): Promise<Session | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  const { state } = store();
  const user = state.users.find((u) => u.id === userId);
  const membership = state.memberships.find((m) => m.userId === userId && m.status === "ACTIVE");
  if (!user || !membership) return null;
  const allowed = state.locations.filter(
    (l) => l.restaurantId === membership.restaurantId && (membership.locationId === null || membership.locationId === l.id),
  );
  const chosen = await getChosenLocationId();
  const location = allowed.find((l) => l.id === chosen) ?? allowed[0];
  if (!location) return null;
  return {
    user: { id: user.id, email: user.email, name: user.name },
    role: membership.role,
    restaurant: state.restaurant,
    location: { id: location.id, name: location.name },
    locations: allowed.map((l) => ({ id: l.id, name: l.name })),
  };
}

/** Sends the person to sign in if there's no valid session. */
export async function requireSession(): Promise<Session> {
  const session = await readSession();
  if (!session) redirect("/login");
  return session;
}

/** For server actions and data reads: throws Forbidden instead of rendering a page. */
export async function requireCan(capability: Capability): Promise<Session> {
  const session = await requireSession();
  if (!can(session.role, capability)) throw new Forbidden(capability);
  return session;
}
