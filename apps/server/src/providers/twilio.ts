// Twilio behind a small interface: number search and purchase, redirecting a live call (transfers),
// SMS, the browser test-call token and webhook signature checks. The real client uses Twilio's own
// SDK with the account's credentials; tests use FakeTwilio.
import twilio from "twilio";

export type AvailableNumber = { e164: string; locality: string };
export type NumberHooks = { voiceUrl: string; statusCallbackUrl: string; fallbackUrl: string | null };

export interface TwilioApi {
  searchNumbers(areaCode: string): Promise<AvailableNumber[]>;
  buyNumber(e164: string, hooks: NumberHooks): Promise<{ sid: string; e164: string }>;
  configureNumber(sid: string, hooks: NumberHooks): Promise<void>;
  releaseNumber(sid: string): Promise<void>;
  /** Replaces what a live call is doing with new TwiML (used for transfers). */
  redirectCall(callSid: string, twiml: string): Promise<void>;
  hangUp(callSid: string): Promise<void>;
  sendSms(to: string, body: string): Promise<void>;
  voiceAccessToken(identity: string, ttlSeconds: number): string;
  validateSignature(signature: string, url: string, params: Record<string, string>): boolean;
}

export type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  twimlAppSid?: string;
  messagingServiceSid?: string;
};

export function createTwilio(creds: TwilioCredentials, options: { httpClient?: unknown } = {}): TwilioApi {
  const client = twilio(creds.accountSid, creds.authToken, options.httpClient ? ({ httpClient: options.httpClient } as never) : undefined);
  return {
    async searchNumbers(areaCode) {
      const list = await client.availablePhoneNumbers("US").local.list({ areaCode: Number(areaCode), voiceEnabled: true, limit: 10 });
      return list.map((n) => ({ e164: n.phoneNumber, locality: [n.locality, n.region].filter(Boolean).join(", ") }));
    },
    async buyNumber(e164, hooks) {
      const n = await client.incomingPhoneNumbers.create({
        phoneNumber: e164,
        voiceUrl: hooks.voiceUrl,
        voiceMethod: "POST",
        statusCallback: hooks.statusCallbackUrl,
        statusCallbackMethod: "POST",
        ...(hooks.fallbackUrl ? { voiceFallbackUrl: hooks.fallbackUrl, voiceFallbackMethod: "POST" } : {}),
      });
      return { sid: n.sid, e164: n.phoneNumber };
    },
    async configureNumber(sid, hooks) {
      await client.incomingPhoneNumbers(sid).update({
        voiceUrl: hooks.voiceUrl,
        voiceMethod: "POST",
        statusCallback: hooks.statusCallbackUrl,
        statusCallbackMethod: "POST",
        voiceFallbackUrl: hooks.fallbackUrl ?? "",
        voiceFallbackMethod: "POST",
      });
    },
    async releaseNumber(sid) {
      await client.incomingPhoneNumbers(sid).remove();
    },
    async redirectCall(callSid, twiml) {
      await client.calls(callSid).update({ twiml });
    },
    async hangUp(callSid) {
      await client.calls(callSid).update({ status: "completed" });
    },
    async sendSms(to, body) {
      if (!creds.messagingServiceSid) throw new Error("No Twilio messaging service is configured.");
      await client.messages.create({ to, body, messagingServiceSid: creds.messagingServiceSid });
    },
    voiceAccessToken(identity, ttlSeconds) {
      if (!creds.apiKeySid || !creds.apiKeySecret || !creds.twimlAppSid) throw new Error("Twilio Voice SDK credentials are not configured.");
      const token = new twilio.jwt.AccessToken(creds.accountSid, creds.apiKeySid, creds.apiKeySecret, { identity, ttl: ttlSeconds });
      token.addGrant(new twilio.jwt.AccessToken.VoiceGrant({ outgoingApplicationSid: creds.twimlAppSid, incomingAllow: false }));
      return token.toJwt();
    },
    validateSignature(signature, url, params) {
      return twilio.validateRequest(creds.authToken, signature, url, params);
    },
  };
}
