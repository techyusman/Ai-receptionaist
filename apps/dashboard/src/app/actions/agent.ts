"use server";

import { z } from "zod";
import { run } from "@/server/action";
import * as api from "@/server/api";

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use the full number with country code, like +1 212 555 0142.");

const settingsPatch = z
  .object({
    greeting: z.string().trim().min(10, "The greeting needs at least 10 characters.").max(400, "Keep the greeting under 400 characters."),
    voice: z.string().max(40),
    primaryLanguage: z.string().max(8),
    extraLanguages: z.array(z.string().max(8)).max(1, "Use at most one extra language."),
    orderingEnabled: z.boolean(),
    pickupNotesEnabled: z.boolean(),
    scheduledPickupEnabled: z.boolean(),
    pickupPolicy: z.string().max(1000),
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
    recordingEnabled: z.boolean(),
    transcriptEnabled: z.boolean(),
    retentionDays: z.number().int().min(1).max(730),
  })
  .partial()
  .strict();

export async function updateSettings(patch: z.input<typeof settingsPatch>) {
  return run(() => api.updateSettings(settingsPatch.parse(patch)));
}

const ordering = z.object({
  mode: z.enum(["DISABLED", "DASHBOARD_TICKET", "SQUARE"]),
  feasibility: z.enum(["UNVERIFIED", "VERIFIED_NATIVE", "FALLBACK_APPROVED", "BLOCKED"]),
  note: z.string().trim().max(500).nullable(),
});

export async function setOrdering(input: z.input<typeof ordering>) {
  return run(() => api.setOrdering(ordering.parse(input)));
}

const target = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, "Give this number a name staff will recognise.").max(60),
  e164,
  priority: z.number().int().min(1).max(9),
  intent: z.enum(["GENERAL", "CATERING", "LARGE_PARTY", "COMPLAINT", "ALLERGEN"]),
  activeHours: z.enum(["ALWAYS", "BUSINESS_HOURS"]),
  smsAlertOnMiss: z.boolean(),
  enabled: z.boolean(),
});

export async function saveTransferTarget(input: z.input<typeof target>) {
  return run(() => api.saveTransferTarget(target.parse(input)));
}

export async function deleteTransferTarget(id: string) {
  return run(() => api.deleteTransferTarget(z.string().parse(id)));
}

export async function searchNumbers(areaCode: string) {
  return run(() => api.searchNumbers(z.string().trim().parse(areaCode)));
}

export async function buyNumber(number: string) {
  return run(() => api.buyNumber(e164.parse(number)));
}

export async function addPronunciation(term: string, spokenAs: string) {
  return run(() => api.addPronunciation(z.string().max(80).parse(term), z.string().max(120).parse(spokenAs)));
}

export async function deletePronunciation(id: string) {
  return run(() => api.deletePronunciation(z.string().parse(id)));
}
