// Row <-> contract mapping for a location and its agent settings.
import type { Location, Settings } from "@receptionist/contracts";
import { maybeOne, type Tx } from "@receptionist/db";
import { notFound } from "../errors.ts";

type LocationRow = {
  id: string; restaurant_id: string; name: string; timezone: string; currency: string; estimate_tax_rate_percent: number;
  address_line1: string | null; address_line2: string | null; city: string | null; region: string | null; postal_code: string | null;
  country: string | null; directions: string | null; public_phone_e164: string | null; website: string | null;
  status: Location["status"]; ordering_mode: Location["orderingMode"]; pos_feasibility: Location["feasibility"];
  pos_feasibility_note: string | null; signed_off_by_name: string | null; pos_feasibility_signed_off_at: string | null;
};

export async function getLocationRow(tx: Tx, id: string): Promise<Location> {
  const r = await maybeOne<LocationRow>(
    tx,
    `select l.*, coalesce(u.display_name, u.email) as signed_off_by_name
       from locations l left join users u on u.id = l.pos_feasibility_signed_off_by where l.id = $1`,
    [id],
  );
  if (!r) throw notFound();
  return {
    id: r.id,
    restaurantId: r.restaurant_id,
    name: r.name,
    timezone: r.timezone,
    currency: r.currency,
    taxRatePercent: r.estimate_tax_rate_percent,
    address: {
      line1: r.address_line1 ?? "",
      ...(r.address_line2 ? { line2: r.address_line2 } : {}),
      city: r.city ?? "",
      region: r.region ?? "",
      postalCode: r.postal_code ?? "",
      country: r.country ?? "US",
    },
    directions: r.directions ?? "",
    publicPhone: r.public_phone_e164,
    website: r.website,
    status: r.status,
    orderingMode: r.ordering_mode,
    feasibility: r.pos_feasibility,
    feasibilityNote: r.pos_feasibility_note,
    feasibilitySignedOffBy: r.signed_off_by_name,
    feasibilitySignedOffAt: r.pos_feasibility_signed_off_at,
  };
}

/** contract field -> column. The only way a settings key reaches SQL, so a request can't name a column. */
export const SETTINGS_COLUMNS = {
  greeting: "greeting", voice: "voice", primaryLanguage: "primary_language", extraLanguages: "extra_languages",
  orderingEnabled: "ordering_enabled", pickupNotesEnabled: "pickup_notes_enabled", scheduledPickupEnabled: "scheduled_pickup_enabled",
  pickupPolicy: "pickup_policy", pickupEstimateMinutes: "pickup_estimate_minutes", afterHoursMode: "after_hours_mode",
  ringStaffFirst: "ring_staff_first", ringStaffSeconds: "ring_staff_seconds", transferStrategy: "transfer_strategy",
  transferTimeoutSeconds: "transfer_timeout_seconds", maxTransferAttempts: "max_transfer_attempts", maxCallSeconds: "max_call_seconds",
  silenceTimeoutSeconds: "silence_timeout_seconds", maxClarificationRetries: "max_clarification_retries",
  menuStaleMaxAgeSeconds: "menu_stale_max_age_seconds", recordingEnabled: "recording_enabled", transcriptEnabled: "transcript_enabled",
  retentionDays: "retention_days",
} as const satisfies Record<Exclude<keyof Settings, "updatedAt">, string>;

export async function getSettingsRow(tx: Tx, locationId: string): Promise<Settings> {
  const r = await maybeOne<Record<string, unknown>>(tx, "select * from location_settings where location_id = $1", [locationId]);
  if (!r) throw notFound();
  const out: Record<string, unknown> = {};
  for (const [field, col] of Object.entries(SETTINGS_COLUMNS)) out[field] = r[col];
  out.pickupPolicy = (r.pickup_policy as string | null) ?? "";
  out.updatedAt = r.updated_at;
  return out as Settings;
}
