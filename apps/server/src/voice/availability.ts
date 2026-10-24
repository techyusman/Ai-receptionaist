// Can the AI take an order right now? Asked before an order is started and again before it is priced
// or sent, because hours end, the kitchen switches ordering off, and menus go stale mid-call.
import { freshness, isOpenAt, type Menu } from "@receptionist/domain";
import { many, type Tx } from "@receptionist/db";
import type { Deps } from "../deps.ts";
import { readHours, readSpecialHours } from "../routes/hours.ts";
import type { CallContext } from "./context.ts";

export type Availability = { available: true } | { available: false; reason: "ORDERING_OFF" | "CLOSED" | "MENU_STALE" | "NO_MENU"; say: string };

export async function orderingAvailability(deps: Deps, tx: Tx, ctx: CallContext, menu: Menu): Promise<Availability> {
  // Re-read the location's mode: a manager may have switched ordering off since this call began.
  const live = await many<{ ordering_mode: string; ordering_enabled: boolean; stale: number }>(
    tx,
    `select l.ordering_mode, s.ordering_enabled, s.menu_stale_max_age_seconds as stale
       from locations l join location_settings s on s.location_id = l.id where l.id = $1`,
    [ctx.locationId],
  );
  const row = live[0];
  if (!row || row.ordering_mode === "DISABLED" || !row.ordering_enabled) {
    return { available: false, reason: "ORDERING_OFF", say: "I can't take orders by phone right now, but I can answer questions or pass you to someone." };
  }
  const [hours, specials] = await Promise.all([readHours(tx, ctx.locationId), readSpecialHours(tx, ctx.locationId)]);
  const shifts = hours.ordering.length ? hours.ordering : hours.store;
  // A test call from the dashboard can order any time; a real caller only while the hours say open (no hours set means closed).
  if (!ctx.isTest && (!shifts.length || !isOpenAt(shifts, specials, deps.now(), ctx.timezone))) {
    return { available: false, reason: "CLOSED", say: "We're not taking orders right now. I can tell you our hours, or take a message for a call back." };
  }
  if (!menu.items.length) return { available: false, reason: "NO_MENU", say: "I don't have the menu available right now. I can pass you to someone." };
  if (freshness(menu.syncedAt, row.stale, deps.now()) === "stale") {
    return { available: false, reason: "MENU_STALE", say: "I can't be sure the menu is up to date right now, so I shouldn't take an order. I can pass you to someone." };
  }
  return { available: true };
}
