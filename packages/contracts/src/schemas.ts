// Input schemas for every write the API accepts. The server parses with these on every route; the
// dashboard may reuse them to check a form before sending it. Messages are written for a person,
// because they are shown next to the field.
import { z } from "zod";

export const uuid = z.uuid("That isn't a valid id.");

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour times like 07:30.");
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
export const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use the full number with country code, like +1 212 555 0142.");
export const isoInstant = z.string().datetime({ offset: true, message: "Use a full date and time." });

export const ianaTimeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Pick a time zone from the list.");

/* Restaurant and location ------------------------------------------------------------------ */

export const address = z.object({
  line1: z.string().trim().min(1, "Add the street address.").max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1, "Add the city.").max(80),
  region: z.string().trim().min(1, "Add the state.").max(40),
  postalCode: z.string().trim().min(3, "Add the ZIP code.").max(12),
  country: z.string().length(2, "Use the two-letter country code."),
});

export const createRestaurantInput = z.object({
  name: z.string().trim().min(1, "Give the restaurant a name.").max(120),
  location: z.object({ name: z.string().trim().min(1, "Give the location a name.").max(120), timezone: ianaTimeZone, address }),
});

export const updateLocationInput = z
  .object({
    name: z.string().trim().min(1, "Give the location a name.").max(120),
    timezone: ianaTimeZone,
    address,
    directions: z.string().trim().max(500),
    publicPhone: e164.nullable(),
    website: z.url("Use a full web address, like https://example.com.").max(300).nullable(),
  })
  .partial()
  .strict();

export const orderingInput = z.object({
  mode: z.enum(["DISABLED", "DASHBOARD_TICKET", "SQUARE"]),
  feasibility: z.enum(["UNVERIFIED", "VERIFIED_NATIVE", "FALLBACK_APPROVED", "BLOCKED"]),
  note: z.string().trim().max(1000).nullable(),
});

/* Agent settings -------------------------------------------------------------------------- */

const lang = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "Use a language code like en or es.");

export const settingsInput = z
  .object({
    greeting: z.string().trim().min(10, "The greeting needs at least 10 characters.").max(400, "Keep the greeting under 400 characters."),
    voice: z.string().trim().min(1).max(40),
    primaryLanguage: lang,
    extraLanguages: z.array(lang).max(1, "Use at most one extra language; more makes the AI less accurate."),
    orderingEnabled: z.boolean(),
    pickupNotesEnabled: z.boolean(),
    scheduledPickupEnabled: z.boolean(),
    pickupPolicy: z.string().trim().max(1000),
    pickupEstimateMinutes: z.number().int().min(1).max(240).nullable(),
    afterHoursMode: z.enum(["INFO_ONLY", "TAKE_CALLBACK", "TRANSFER_FALLBACK"]),
    ringStaffFirst: z.boolean(),
    ringStaffSeconds: z.number().int().min(5).max(60),
    transferStrategy: z.enum(["DIRECT", "WARM"]),
    transferTimeoutSeconds: z.number().int().min(10).max(60),
    maxTransferAttempts: z.number().int().min(1).max(5),
    maxCallSeconds: z.number().int().min(120).max(3600),
    silenceTimeoutSeconds: z.number().int().min(5).max(60),
    maxClarificationRetries: z.number().int().min(1).max(5),
    menuStaleMaxAgeSeconds: z.number().int().min(60),
    recordingEnabled: z.boolean(),
    transcriptEnabled: z.boolean(),
    retentionDays: z.number().int().min(1).max(730),
  })
  .partial()
  .strict();

/** Settings only an owner may change (recording, transcripts, retention). */
export const PRIVACY_SETTINGS = ["recordingEnabled", "transcriptEnabled", "retentionDays"] as const;

export const transferTargetInput = z.object({
  label: z.string().trim().min(1, "Give this number a name staff will recognise.").max(60),
  e164,
  priority: z.number().int().min(1).max(9),
  intent: z.enum(["GENERAL", "CATERING", "LARGE_PARTY", "COMPLAINT", "ALLERGEN"]),
  activeHours: z.enum(["ALWAYS", "BUSINESS_HOURS"]),
  smsAlertOnMiss: z.boolean(),
  enabled: z.boolean(),
});

export const searchNumbersQuery = z.object({ areaCode: z.string().regex(/^[2-9]\d{2}$/, "Enter a three-digit US area code.") });
export const buyNumberInput = z.object({ e164: z.string().regex(/^\+1\d{10}$/, "Pick a number from the list.") });
export const updatePhoneNumberInput = z.object({ fallbackE164: e164.nullable().optional(), enabled: z.boolean().optional() }).strict();

/* Hours ----------------------------------------------------------------------------------- */

export const shift = z
  .object({ weekday: z.number().int().min(0).max(6), opens: hhmm, closes: hhmm })
  .refine((s) => s.opens !== s.closes, "A shift can't open and close at the same time.");

export const hoursInput = z.object({ store: z.array(shift).max(28), ordering: z.array(shift).max(28) });

export const specialHoursInput = z
  .object({
    date: localDate,
    closed: z.boolean(),
    opens: hhmm.nullable().optional(),
    closes: hhmm.nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => v.closed || (!!v.opens && !!v.closes && v.opens !== v.closes), {
    message: "Add opening and closing times, or mark the day closed.",
    path: ["opens"],
  });

export const noticeInput = z
  .object({ message: z.string().trim().min(1, "Write the notice.").max(500), startsAt: isoInstant, endsAt: isoInstant })
  .refine((n) => Date.parse(n.endsAt) > Date.parse(n.startsAt), { message: "The notice must end after it starts.", path: ["endsAt"] });

/* Knowledge ------------------------------------------------------------------------------- */

export const faqInput = z
  .object({
    question: z.string().trim().min(3, "Write the question the way a caller would ask it.").max(300),
    answer: z.string().trim().min(1, "Add the answer the AI should give.").max(2000, "Keep answers under 2,000 characters."),
    aliases: z.array(z.string().trim().min(1).max(120)).max(10, "Ten other phrasings at most."),
    active: z.boolean(),
    validFrom: isoInstant.nullable(),
    validUntil: isoInstant.nullable(),
  })
  .refine((f) => !f.validFrom || !f.validUntil || Date.parse(f.validUntil) > Date.parse(f.validFrom), {
    message: "The end date must be after the start date.",
    path: ["validUntil"],
  });

export const pronunciationInput = z.object({
  term: z.string().trim().min(1, "Fill in the word.").max(80),
  spokenAs: z.string().trim().min(1, "Say how to pronounce it.").max(120),
});

/* Menu ------------------------------------------------------------------------------------ */

export const overlayInput = z.object({ aiHidden: z.boolean().optional(), aiUnavailableUntil: isoInstant.nullable().optional() }).strict();
export const aliasInput = z.object({ itemId: uuid, phrase: z.string().trim().min(2, "Use 2 to 80 characters.").max(80, "Use 2 to 80 characters.") });
export const aliasRemoveQuery = z.object({ itemId: uuid, phrase: z.string().min(1).max(80) });

export const squareConnectInput = z.object({ environment: z.enum(["SANDBOX", "PRODUCTION"]) });
export const squareLocationInput = z.object({ posLocationId: z.string().min(1).max(64) });

/* Orders, calls, callbacks ----------------------------------------------------------------- */

export const cancelOrderInput = z.object({ reason: z.string().trim().min(3, "Say why, so the team knows later.").max(300) });
export const callbackUpdateInput = z.object({ status: z.enum(["OPEN", "DONE", "CANCELLED"]) });

export const listOrdersQuery = z.object({
  view: z.enum(["open", "accepted", "attention", "all"]).default("all"),
  range: z.enum(["today", "7d", "30d", "all"]).default("all"),
  cursor: z.string().max(40).nullish(),
});

export const listCallsQuery = z.object({
  outcome: z.enum(["INFO_RESOLVED", "ORDER_SUBMITTED", "TRANSFERRED", "CALLER_HUNG_UP", "FAILED", "CALLBACK_REQUESTED", "STAFF_ANSWERED", "all"]).default("all"),
  transferred: z.enum(["true", "false"]).optional(),
  range: z.enum(["today", "7d", "30d", "all"]).default("all"),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(40).nullish(),
});

export const analyticsQuery = z.object({ range: z.enum(["7d", "30d"]).default("7d") });

/* Team ------------------------------------------------------------------------------------ */

export const inviteInput = z.object({
  email: z.email("Enter a valid email address.").max(200),
  role: z.enum(["MANAGER", "STAFF"]),
  locationId: uuid.nullish(),
});
export const acceptInviteInput = z.object({ token: z.string().min(20).max(200) });
export const memberChangeInput = z.object({ role: z.enum(["MANAGER", "STAFF"]).optional(), revoke: z.boolean().optional() }).strict();
export const supportGrantInput = z.object({
  supportEmail: z.email("Enter a valid email address."),
  scope: z.enum(["READ_METADATA", "READ_CALL_CONTENT", "WRITE_CONFIG"]),
  hours: z.number().int().min(1).max(72),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(300),
});

/* Test agent (S22) -------------------------------------------------------------------------- */

export const testSearchQuery = z.object({ q: z.string().trim().min(1).max(80) });
export const testChatMessageInput = z.object({ text: z.string().trim().min(1, "Type a message first.").max(500, "Keep a message under 500 characters.") });
export const testLineInput = z.object({
  itemId: uuid,
  variationId: uuid.optional(),
  quantity: z.number().int().min(1).max(99),
  modifiers: z.array(z.object({ listId: uuid, optionId: uuid, quantity: z.number().int().min(1).max(20).optional(), parentOptionId: uuid.optional() })).max(40),
});
export const testCustomerInput = z.object({ name: z.string().trim().min(1, "Ask for the caller's name.").max(80), phone: z.string().trim().min(7).max(20) });
export const testConfirmInput = z.object({ version: z.number().int().min(1) });

export const eraseInput = z.object({ phone: z.string().trim().min(7).max(25) });

export const PAGE_SIZE = 25;
