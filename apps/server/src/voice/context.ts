// Everything a tool needs to know about the call it is serving. Built from the trusted `calls` row when
// the stream opens: tools never accept a restaurant, location or call id from the model.
import type { Settings } from "@receptionist/contracts";
import { maybeOne, withSystem } from "@receptionist/db";
import type { Deps } from "../deps.ts";
import { getSettingsRow } from "../routes/location-data.ts";

export type CallContext = {
  callId: string;
  callSid: string;
  restaurantId: string;
  locationId: string;
  isTest: boolean;
  fromE164: string | null;
  restaurantName: string;
  locationName: string;
  timezone: string;
  currency: string;
  address: string;
  directions: string;
  publicPhone: string | null;
  fallbackE164: string | null;
  orderingMode: "DISABLED" | "DASHBOARD_TICKET" | "SQUARE";
  settings: Settings;
  handles: Handles;
};

/** Short opaque names the model uses instead of real ids ("m3" for an item). Real ids never leave the server. */
export class Handles {
  readonly #byHandle = new Map<string, string>();
  readonly #byId = new Map<string, string>();
  #n = 0;
  for(kind: "m" | "v" | "o" | "l", id: string): string {
    const key = `${kind}:${id}`;
    const known = this.#byId.get(key);
    if (known) return known;
    const handle = `${kind}${++this.#n}`;
    this.#byId.set(key, handle);
    this.#byHandle.set(handle, id);
    return handle;
  }
  resolve(kind: "m" | "v" | "o" | "l", handle: string | undefined): string | null {
    if (!handle || handle[0] !== kind) return null;
    return this.#byHandle.get(handle) ?? null;
  }
}

export async function loadCallContext(deps: Deps, callId: string): Promise<CallContext | null> {
  return withSystem(deps.db, async (tx) => {
    const c = await maybeOne<{
      id: string; provider_call_sid: string; restaurant_id: string; location_id: string; is_test: boolean; from_e164: string | null; status: string;
      restaurant_name: string; location_name: string; timezone: string; currency: string; address_line1: string | null; city: string | null; region: string | null;
      postal_code: string | null; directions: string | null; public_phone_e164: string | null; ordering_mode: CallContext["orderingMode"]; fallback_e164: string | null;
    }>(
      tx,
      `select c.id, c.provider_call_sid, c.restaurant_id, c.location_id, c.is_test, c.from_e164, c.status, r.name as restaurant_name, l.name as location_name,
              l.timezone, l.currency, l.address_line1, l.city, l.region, l.postal_code, l.directions, l.public_phone_e164, l.ordering_mode, p.fallback_e164
         from calls c join locations l on l.id = c.location_id join restaurants r on r.id = c.restaurant_id left join phone_numbers p on p.id = c.phone_number_id
        where c.id = $1 and c.status in ('IN_PROGRESS','TRANSFERRING')`,
      [callId],
    );
    if (!c) return null;
    const settings = await getSettingsRow(tx, c.location_id);
    return {
      callId: c.id, callSid: c.provider_call_sid, restaurantId: c.restaurant_id, locationId: c.location_id, isTest: c.is_test, fromE164: c.from_e164,
      restaurantName: c.restaurant_name, locationName: c.location_name, timezone: c.timezone, currency: c.currency,
      address: [c.address_line1, c.city, [c.region, c.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", "), directions: c.directions ?? "",
      publicPhone: c.public_phone_e164, fallbackE164: c.fallback_e164, orderingMode: c.ordering_mode, settings, handles: new Handles(),
    };
  });
}
