// In-memory stand-ins used by tests and by the local dev stack. They record what they were asked to do.
import twilio from "twilio";
import type { EmailMessage, EmailSender } from "./email.ts";
import type { AvailableNumber, NumberHooks, TwilioApi } from "./twilio.ts";

export class FakeEmail implements EmailSender {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

export class FakeTwilio implements TwilioApi {
  readonly authToken: string;
  readonly bought: { sid: string; e164: string; hooks: NumberHooks }[] = [];
  readonly released: string[] = [];
  readonly redirects: { callSid: string; twiml: string }[] = [];
  readonly hangups: string[] = [];
  readonly sms: { to: string; body: string }[] = [];
  /** Numbers the pretend carrier will offer for any area code. */
  inventory = (areaCode: string): AvailableNumber[] => [37, 58, 64].map((n) => ({ e164: `+1${areaCode}555${String(n).padStart(4, "0")}`, locality: "Sample City, NY" }));

  constructor(authToken = "test-auth-token") {
    this.authToken = authToken;
  }

  async searchNumbers(areaCode: string) {
    return this.inventory(areaCode);
  }
  async buyNumber(e164: string, hooks: NumberHooks) {
    const sid = `PN${String(this.bought.length + 1).padStart(32, "0")}`;
    this.bought.push({ sid, e164, hooks });
    return { sid, e164 };
  }
  async configureNumber(sid: string, hooks: NumberHooks) {
    const n = this.bought.find((b) => b.sid === sid);
    if (n) n.hooks = hooks;
  }
  async releaseNumber(sid: string) {
    this.released.push(sid);
  }
  async redirectCall(callSid: string, twiml: string) {
    this.redirects.push({ callSid, twiml });
  }
  async hangUp(callSid: string) {
    this.hangups.push(callSid);
  }
  async sendSms(to: string, body: string) {
    this.sms.push({ to, body });
  }
  voiceAccessToken(identity: string, ttlSeconds: number) {
    return `fake-voice-token:${identity}:${ttlSeconds}`;
  }
  validateSignature(signature: string, url: string, params: Record<string, string>) {
    return twilio.validateRequest(this.authToken, signature, url, params);
  }
  /** What Twilio would put in X-Twilio-Signature for this request. */
  sign(url: string, params: Record<string, string>) {
    return twilio.getExpectedTwilioSignature(this.authToken, url, params);
  }
}
