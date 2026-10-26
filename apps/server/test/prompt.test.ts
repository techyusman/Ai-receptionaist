import { test } from "node:test";
import assert from "node:assert/strict";
import type { CallContext } from "../src/voice/context.ts";
import { buildInstructions } from "../src/voice/prompt.ts";

const call = (fromE164: string | null) =>
  ({
    restaurantName: "Tandoor & Crust",
    locationName: "Gulberg",
    timezone: "Asia/Karachi",
    country: "PK",
    fromE164,
    settings: { primaryLanguage: "en", extraLanguages: [], pickupPolicy: null },
  }) as unknown as CallContext;
const extra = { openNow: true, pronunciations: [], now: new Date("2026-10-26T12:00:00Z"), channel: "phone" as const };

test("a call without caller ID asks for the number and never assumes one", () => {
  const text = buildInstructions(call(null), extra);
  assert.match(text, /no caller ID/);
  assert.match(text, /ask for their number/);
});

test("a call with caller ID names the number, to offer it, and asks before using it", () => {
  const text = buildInstructions(call("+923001234567"), extra);
  assert.match(text, /calling from \+92 300 123 4567/);
  assert.match(text, /only after they say yes/);
  assert.doesNotMatch(text, /no caller ID/);
});
