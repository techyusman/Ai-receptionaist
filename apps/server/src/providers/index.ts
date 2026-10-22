// The outside world, behind small interfaces. Production wires real clients (Twilio, Square, OpenAI,
// Resend); development and tests wire fakes. A provider that isn't configured is simply absent, and
// the routes that need it answer "isn't set up on this server yet".
import type { EmailSender } from "./email.ts";

export type Providers = {
  email: EmailSender | null;
};
