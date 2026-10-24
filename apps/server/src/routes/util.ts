import { withTenant, type Tx } from "@receptionist/db";
import type { Access } from "../auth/access.ts";
import type { Deps } from "../deps.ts";

/** Runs a transaction as the caller's restaurant. Staff actions show up as STAFF in order history. */
export function tenant<T>(deps: Deps, a: Access, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(deps.db, { restaurantId: a.restaurantId, userId: a.userId, actorType: a.actorType === "SUPPORT" ? "SUPPORT" : "STAFF" }, fn);
}

/** "HH:MM:SS" from a Postgres time column to the "HH:MM" the contracts use. */
export const hm = (t: string): string => t.slice(0, 5);

export const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
