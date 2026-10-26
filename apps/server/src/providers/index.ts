// The outside world, behind small interfaces. Production wires real clients (Twilio, Square, OpenAI,
// Resend); development and tests wire fakes. A provider that isn't configured is simply absent, and
// the routes that need it answer "isn't set up on this server yet".
import type { ChatModel } from "./chat.ts";
import type { EmailSender } from "./email.ts";
import type { SpeechToText, TextToSpeech } from "./speech.ts";
import type { RealtimeConnector } from "./realtime.ts";
import type { SquareApiFactory } from "./square.ts";
import type { TwilioApi } from "./twilio.ts";

export type Providers = {
  email: EmailSender | null;
  twilio: TwilioApi | null;
  square: SquareApiFactory | null;
  realtime: RealtimeConnector | null;
  /** The text model behind the dashboard's test chat. */
  chat: ChatModel | null;
  /** Hears the dashboard's voice test (calling the AI from the browser). */
  stt: SpeechToText | null;
  /** Speaks the AI's replies on a browser call (a human-sounding voice instead of the browser's own). */
  tts: TextToSpeech | null;
};
