// Every setting the server reads, validated once at boot. A missing required variable stops the
// process with a message that names it; optional integrations (Twilio, Square, OpenAI, Resend) can be
// absent in development and then their features answer "not configured" instead of crashing.
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  // Where this server is reachable from outside (Twilio and Square sign these URLs) and who may call it.
  PUBLIC_API_BASE_URL: z.url(),
  DASHBOARD_ORIGIN: z.url(),

  DATABASE_URL: z.string().min(1),

  // Supabase Auth issues the JWTs. The server only verifies them, against the project's public keys.
  SUPABASE_URL: z.url(),
  SUPABASE_JWKS_URL: optionalString,
  SUPABASE_JWT_AUDIENCE: z.string().default("authenticated"),
  // Server-side only, never sent to a browser: lets a person delete their own sign-in.
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  // 32 random bytes, base64. Square tokens are encrypted with it (AES-256-GCM).
  TOKEN_ENCRYPTION_KEY: z.string().min(40, "TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64 encoded."),
  TOKEN_KEY_VERSION: z.coerce.number().int().min(1).max(32000).default(1),
  // During a key rotation: the key for version TOKEN_KEY_VERSION - 1, so older tokens still decrypt.
  TOKEN_ENCRYPTION_KEY_PREVIOUS: optionalString,
  // The table owner, used only to run migrations and install the job queue. The API and worker use DATABASE_URL.
  DATABASE_MIGRATE_URL: optionalString,
  // How long a deploy waits for calls in progress to finish before the process exits.
  DRAIN_SECONDS: z.coerce.number().int().min(0).max(3600).default(900),
  // Signs the one-time token that lets Twilio open the media stream for exactly one call.
  VOICE_STREAM_SECRET: z.string().min(32),

  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_API_KEY_SID: optionalString,
  TWILIO_API_KEY_SECRET: optionalString,
  TWILIO_TWIML_APP_SID: optionalString,
  TWILIO_FALLBACK_TWIML_URL: optionalString,
  TWILIO_MESSAGING_SERVICE_SID: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime"),
  OPENAI_REALTIME_URL: z.string().default("wss://api.openai.com/v1/realtime"),

  // The dashboard's test chat: any OpenAI-compatible text model. Groq has a free tier (console.groq.com/keys).
  CHAT_AI_API_KEY: optionalString,
  CHAT_AI_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  CHAT_AI_MODEL: z.string().default("openai/gpt-oss-120b"),
  // Speech to text for calling the AI from the browser, on the same service and key.
  CHAT_AI_STT_MODEL: z.string().default("whisper-large-v3-turbo"),
  // Used while the main model is at its rate limit, in order (comma-separated). Empty means Groq's defaults.
  CHAT_AI_FALLBACK_MODELS: optionalString,
  // The AI's voice on a browser call. Orpheus sounds human; Groq asks the account owner to accept its terms once.
  CHAT_AI_TTS_MODEL: z.string().default("canopylabs/orpheus-v1-english"),
  CHAT_AI_TTS_VOICE: z.string().default("hannah"),

  SQUARE_API_VERSION: z.string().default("2026-08-19"),
  SQUARE_APPLICATION_ID_SANDBOX: optionalString,
  SQUARE_APPLICATION_SECRET_SANDBOX: optionalString,
  SQUARE_APPLICATION_ID_PRODUCTION: optionalString,
  SQUARE_APPLICATION_SECRET_PRODUCTION: optionalString,
  SQUARE_WEBHOOK_SIGNATURE_KEY: optionalString,
  // Square signs the URL you registered, not the one the request arrived on (Fly rewrites it).
  SQUARE_WEBHOOK_NOTIFICATION_URL: optionalString,

  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().default("Receptionist <no-reply@example.com>"),
  // A rough per-minute cost (in minor units) used to estimate what each call cost. 0 leaves costs unestimated.
  ESTIMATED_COST_PER_MINUTE_MINOR: z.coerce.number().int().min(0).default(0),
  SENTRY_DSN: optionalString,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    const missing = [
      ["SQUARE_WEBHOOK_NOTIFICATION_URL", c.SQUARE_WEBHOOK_NOTIFICATION_URL],
      ["TWILIO_AUTH_TOKEN", c.TWILIO_AUTH_TOKEN],
    ].filter(([, v]) => !v);
    if (missing.length) throw new Error(`Invalid configuration:\n  ${missing.map(([k]) => k).join(", ")} required in production.`);
  }
  return c;
}

export function jwksUrl(c: Config): string {
  return c.SUPABASE_JWKS_URL ?? `${c.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
}
