// Builds the real provider clients from configuration. Anything without credentials is left out, and
// the routes that need it say so plainly instead of failing in the middle of a request.
import type { Config } from "../config.ts";
import { createChatModel, fallbackModels } from "./chat.ts";
import { createOpenAiRealtime } from "./realtime-openai.ts";
import { createSpeechToText, createTextToSpeech } from "./speech.ts";
import { createResend } from "./resend.ts";
import type { Providers } from "./index.ts";
import { createSquareFactory, type SquareCredentials } from "./square-http.ts";
import { createTwilio } from "./twilio.ts";

export function buildProviders(config: Config, overrides: Partial<Providers> = {}): Providers {
  const credentials: Record<string, SquareCredentials> = {};
  if (config.SQUARE_APPLICATION_ID_SANDBOX && config.SQUARE_APPLICATION_SECRET_SANDBOX) {
    credentials.SANDBOX = { applicationId: config.SQUARE_APPLICATION_ID_SANDBOX, applicationSecret: config.SQUARE_APPLICATION_SECRET_SANDBOX };
  }
  if (config.SQUARE_APPLICATION_ID_PRODUCTION && config.SQUARE_APPLICATION_SECRET_PRODUCTION) {
    credentials.PRODUCTION = { applicationId: config.SQUARE_APPLICATION_ID_PRODUCTION, applicationSecret: config.SQUARE_APPLICATION_SECRET_PRODUCTION };
  }
  return {
    email: config.RESEND_API_KEY ? createResend(config.RESEND_API_KEY, config.EMAIL_FROM) : null,
    twilio:
      config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN
        ? createTwilio({
            accountSid: config.TWILIO_ACCOUNT_SID, authToken: config.TWILIO_AUTH_TOKEN, apiKeySid: config.TWILIO_API_KEY_SID,
            apiKeySecret: config.TWILIO_API_KEY_SECRET, twimlAppSid: config.TWILIO_TWIML_APP_SID, messagingServiceSid: config.TWILIO_MESSAGING_SERVICE_SID,
          })
        : null,
    square: Object.keys(credentials).length ? createSquareFactory({ apiVersion: config.SQUARE_API_VERSION, credentials }) : null,
    realtime: config.OPENAI_API_KEY ? createOpenAiRealtime({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_REALTIME_MODEL, url: config.OPENAI_REALTIME_URL }) : null,
    chat: config.CHAT_AI_API_KEY
      ? createChatModel({ baseUrl: config.CHAT_AI_BASE_URL, apiKey: config.CHAT_AI_API_KEY, model: config.CHAT_AI_MODEL, fallbacks: fallbackModels(config.CHAT_AI_BASE_URL, config.CHAT_AI_FALLBACK_MODELS) })
      : null,
    stt: config.CHAT_AI_API_KEY ? createSpeechToText({ baseUrl: config.CHAT_AI_BASE_URL, apiKey: config.CHAT_AI_API_KEY, model: config.CHAT_AI_STT_MODEL }) : null,
    tts: config.CHAT_AI_API_KEY ? createTextToSpeech({ baseUrl: config.CHAT_AI_BASE_URL, apiKey: config.CHAT_AI_API_KEY, model: config.CHAT_AI_TTS_MODEL, voice: config.CHAT_AI_TTS_VOICE }) : null,
    ...overrides,
  };
}
