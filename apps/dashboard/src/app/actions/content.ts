"use server";

import { z } from "zod";
import { run } from "@/server/action";
import * as api from "@/server/api";

// Every parse happens inside run(), so bad input comes back as a form message, not a crash.

/* Knowledge ------------------------------------------------------------------ */

const isoOrNull = z.string().datetime({ offset: true }).nullable();

const faq = z.object({
  id: z.string().optional(),
  question: z.string().trim().min(3, "Write the question the way a caller would ask it.").max(300),
  answer: z.string().trim().min(1, "Add the answer the AI should give.").max(2000, "Keep answers under 2,000 characters."),
  aliases: z.array(z.string().trim().min(1).max(120)).max(10),
  active: z.boolean(),
  validFrom: isoOrNull,
  validUntil: isoOrNull,
});

export async function saveFaq(input: z.input<typeof faq>) {
  return run(() => api.saveFaq(faq.parse(input)));
}

export async function deleteFaq(id: string) {
  return run(() => api.deleteFaq(z.string().parse(id)));
}

export async function addFaqTemplates() {
  return run(() => api.addFaqTemplates());
}

/* Menu and Square --------------------------------------------------------------- */

const overlay = z.object({ aiHidden: z.boolean().optional(), aiUnavailableUntil: isoOrNull.optional() }).strict();

export async function setItemOverlay(itemId: string, patch: z.input<typeof overlay>) {
  return run(() => api.setItemOverlay(z.string().parse(itemId), overlay.parse(patch)));
}

export async function addAlias(itemId: string, phrase: string) {
  return run(() => api.addAlias(z.string().parse(itemId), z.string().parse(phrase)));
}

export async function removeAlias(itemId: string, phrase: string) {
  return run(() => api.removeAlias(z.string().parse(itemId), z.string().parse(phrase)));
}

export async function resyncMenu() {
  return run(() => api.resyncMenu());
}

export async function connectSquare(environment: "SANDBOX" | "PRODUCTION") {
  return run(() => api.connectSquare(z.enum(["SANDBOX", "PRODUCTION"]).parse(environment)));
}

export async function chooseSquareLocation(id: string) {
  return run(() => api.chooseSquareLocation(z.string().parse(id)));
}

export async function disconnectSquare() {
  return run(() => api.disconnectSquare());
}

/* Location and hours --------------------------------------------------------------- */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour times like 07:30.");
const shift = z
  .object({ weekday: z.number().int().min(0).max(6), opens: hhmm, closes: hhmm })
  .refine((s) => s.opens !== s.closes, "A shift can't open and close at the same time.");
const hours = z.object({ store: z.array(shift).max(28), ordering: z.array(shift).max(28) });

export async function putHours(input: z.input<typeof hours>) {
  return run(() => api.putHours(hours.parse(input)));
}

const special = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  closed: z.boolean(),
  opens: hhmm.nullable().optional(),
  closes: hhmm.nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

export async function addSpecialHours(input: z.input<typeof special>) {
  return run(async () => {
    const parsed = special.parse(input);
    return api.addSpecialHours({ ...parsed, note: parsed.note ?? null });
  });
}

export async function deleteSpecialHours(id: string) {
  return run(() => api.deleteSpecialHours(z.string().parse(id)));
}

const locationDetails = z.object({
  name: z.string().trim().min(1, "Give the location a name.").max(120),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Pick a time zone from the list."),
  directions: z.string().trim().max(500),
  publicPhone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use the full number with country code, like +1 212 555 0142.").nullable(),
  website: z.string().trim().url("Use a full web address, like https://example.com.").nullable(),
  address: z.object({
    line1: z.string().trim().min(1, "Add the street address.").max(120),
    line2: z.string().trim().max(120).optional(),
    city: z.string().trim().min(1, "Add the city.").max(80),
    region: z.string().trim().min(1, "Add the state.").max(40),
    postalCode: z.string().trim().min(3, "Add the ZIP code.").max(12),
    country: z.string().length(2),
  }),
});

export async function updateLocation(input: z.input<typeof locationDetails>) {
  return run(() => api.updateLocation(locationDetails.parse(input)));
}

/* Team ---------------------------------------------------------------------------- */

const memberChange = z.object({ role: z.enum(["MANAGER", "STAFF"]).optional(), revoke: z.boolean().optional() }).strict();

export async function invite(email: string, role: "MANAGER" | "STAFF") {
  return run(() => api.invite(z.string().parse(email), z.enum(["MANAGER", "STAFF"]).parse(role)));
}

export async function revokeInvitation(id: string) {
  return run(() => api.revokeInvitation(z.string().parse(id)));
}

export async function changeMember(membershipId: string, change: z.input<typeof memberChange>) {
  return run(() => api.changeMember(z.string().parse(membershipId), memberChange.parse(change)));
}
