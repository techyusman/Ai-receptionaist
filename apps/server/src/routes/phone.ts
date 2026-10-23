import { buyNumberInput, searchNumbersQuery, updatePhoneNumberInput, type PhoneNumber } from "@receptionist/contracts";
import { many, maybeOne, one } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { conflict, notConfigured, notFound } from "../errors.ts";
import { idParam, lidParam, meta, parse, who } from "../http.ts";
import type { NumberHooks, TwilioApi } from "../providers/twilio.ts";
import { tenant } from "./util.ts";

const MAX_NUMBERS_PER_LOCATION = 3;

type NumberRow = { id: string; e164: string; purpose: PhoneNumber["purpose"]; enabled: boolean; fallback_e164: string | null; provider_sid: string };
const toNumber = (r: NumberRow): PhoneNumber => ({ id: r.id, e164: r.e164, purpose: r.purpose, enabled: r.enabled, fallbackE164: r.fallback_e164 });

/** Where Twilio sends a call to this number. The fallback is a Twilio-hosted bin that dials a human if we are down. */
export function numberHooks(deps: Deps, fallbackE164: string | null): NumberHooks {
  const base = deps.config.PUBLIC_API_BASE_URL.replace(/\/$/, "");
  const bin = deps.config.TWILIO_FALLBACK_TWIML_URL;
  return {
    voiceUrl: `${base}/webhooks/twilio/voice`,
    statusCallbackUrl: `${base}/webhooks/twilio/status`,
    fallbackUrl: bin && fallbackE164 ? `${bin}${bin.includes("?") ? "&" : "?"}dial=${encodeURIComponent(fallbackE164)}` : null,
  };
}

function twilioOrThrow(deps: Deps): TwilioApi {
  if (!deps.providers.twilio) throw notConfigured("Phone numbers");
  return deps.providers.twilio;
}

export function registerPhoneRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/phone-numbers", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) =>
      (await many<NumberRow>(tx, "select id, e164, purpose, enabled, fallback_e164, provider_sid from phone_numbers where location_id = $1 and released_at is null order by created_at", [lid])).map(toNumber),
    );
  });

  api.get("/locations/:lid/phone-numbers/available", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "numbers.buy");
    const { areaCode } = parse(searchNumbersQuery, req.query);
    const found = await twilioOrThrow(deps).searchNumbers(areaCode);
    // Numbers this restaurant already owns never appear as choices.
    const owned = await tenant(deps, a, (tx) => many<{ e164: string }>(tx, "select e164 from phone_numbers where location_id = $1 and released_at is null", [lid]));
    const have = new Set(owned.map((o) => o.e164));
    return found.filter((n) => !have.has(n.e164));
  });

  api.post("/locations/:lid/phone-numbers", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "numbers.buy");
    const { e164 } = parse(buyNumberInput, req.body);
    const twilio = twilioOrThrow(deps);
    const location = await tenant(deps, a, async (tx) => {
      const count = await one<{ n: number }>(tx, "select count(*)::int as n from phone_numbers where location_id = $1 and released_at is null", [lid]);
      if (count.n >= MAX_NUMBERS_PER_LOCATION) throw conflict(`A location can have up to ${MAX_NUMBERS_PER_LOCATION} AI numbers.`);
      if (await maybeOne(tx, "select 1 as x from phone_numbers where e164 = $1 and enabled", [e164])) throw conflict("You already have that number.", "e164");
      return one<{ public_phone_e164: string | null }>(tx, "select public_phone_e164 from locations where id = $1", [lid]);
    });
    const fallback = location.public_phone_e164;
    const bought = await twilio.buyNumber(e164, numberHooks(deps, fallback));
    try {
      const row = await tenant(deps, a, async (tx) => {
        const r = await one<NumberRow>(
          tx,
          `insert into phone_numbers (restaurant_id, location_id, provider_sid, e164, fallback_e164) values ($1, $2, $3, $4, $5)
           returning id, e164, purpose, enabled, fallback_e164, provider_sid`,
          [a.restaurantId, lid, bought.sid, bought.e164, fallback],
        );
        await audit(tx, a, meta(req), { action: "numbers.buy", targetType: "phone_number", targetId: r.id, target: bought.e164, summary: "Added an AI phone number." });
        return r;
      });
      return reply.status(201).send(toNumber(row));
    } catch (e) {
      // Never leave a paid number that no restaurant owns.
      await twilio.releaseNumber(bought.sid).catch((err) => req.log.error({ err }, "could not release an orphaned number"));
      throw e;
    }
  });

  // A short-lived token for a test call from the browser (Twilio Voice SDK). The client name carries the
  // location, and the voice webhook only accepts it for that location's own number; such calls are tests.
  api.post("/locations/:lid/test-call/token", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const twilio = twilioOrThrow(deps);
    const ttl = 600;
    try {
      return { token: twilio.voiceAccessToken(`test-${a.userId}-${lid}`, ttl), ttlSeconds: ttl };
    } catch {
      throw notConfigured("Browser test calls");
    }
  });

  api.patch("/phone-numbers/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "phoneNumber", id, "numbers.buy");
    const patch = parse(updatePhoneNumberInput, req.body);
    return tenant(deps, a, async (tx) => {
      const current = await maybeOne<NumberRow>(tx, "select id, e164, purpose, enabled, fallback_e164, provider_sid from phone_numbers where id = $1", [id]);
      if (!current) throw notFound();
      const fallback = patch.fallbackE164 === undefined ? current.fallback_e164 : patch.fallbackE164;
      const enabled = patch.enabled ?? current.enabled;
      if (fallback !== current.fallback_e164 && deps.providers.twilio) await deps.providers.twilio.configureNumber(current.provider_sid, numberHooks(deps, fallback));
      const r = await one<NumberRow>(
        tx,
        "update phone_numbers set fallback_e164 = $2, enabled = $3 where id = $1 returning id, e164, purpose, enabled, fallback_e164, provider_sid",
        [id, fallback, enabled],
      );
      await audit(tx, a, meta(req), { action: "numbers.update", targetType: "phone_number", targetId: id, target: r.e164, summary: `Updated ${r.e164}.` });
      return toNumber(r);
    });
  });
}
