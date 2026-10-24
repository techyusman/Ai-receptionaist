// The TwiML (Twilio's call-control XML) this server returns. Built with Twilio's own builder so
// escaping is never done by hand.
import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

/** Hands the call's audio to our media stream. The one-time token proves this call is ours. */
export function connectStream(streamUrl: string, token: string, extra: Record<string, string> = {}): string {
  const r = new VoiceResponse();
  const stream = r.connect().stream({ url: streamUrl });
  stream.parameter({ name: "token", value: token });
  for (const [name, value] of Object.entries(extra)) stream.parameter({ name, value });
  return r.toString();
}

export function sayAndHangUp(message: string): string {
  const r = new VoiceResponse();
  r.say({ voice: "Polly.Joanna" }, message);
  r.hangup();
  return r.toString();
}

/** Ring the store's own line first. If nobody answers in time, Twilio asks us (action) what to do next. */
export function ringStaffFirst(opts: { number: string; seconds: number; actionUrl: string }): string {
  const r = new VoiceResponse();
  r.dial({ timeout: opts.seconds, action: opts.actionUrl, method: "POST", answerOnBridge: true }).number(opts.number);
  return r.toString();
}

/** Bridge the caller to a person. The whisper plays to the person who answers, before they hear the caller. */
export function transferTo(opts: { number: string; seconds: number; actionUrl: string; whisperUrl: string }): string {
  const r = new VoiceResponse();
  r.dial({ timeout: opts.seconds, action: opts.actionUrl, method: "POST", answerOnBridge: true }).number({ url: opts.whisperUrl, method: "POST" }, opts.number);
  return r.toString();
}

export function dialFallback(number: string | null, message: string): string {
  const r = new VoiceResponse();
  r.say({ voice: "Polly.Joanna" }, message);
  if (number) r.dial(number);
  else r.hangup();
  return r.toString();
}

export function whisper(summary: string): string {
  const r = new VoiceResponse();
  r.say({ voice: "Polly.Joanna" }, summary);
  return r.toString();
}

export function hangUp(): string {
  const r = new VoiceResponse();
  r.hangup();
  return r.toString();
}
