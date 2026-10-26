// Speech to text for the dashboard's voice test (calling the AI from the browser): OpenAI-compatible
// /audio/transcriptions, Groq's free Whisper by default. Hints (the restaurant's name and dishes) help it
// spell "karahi" and "zinger" the way the menu does.
import { ChatModelError, waitFrom } from "./chat.ts";

export interface SpeechToText {
  readonly label: string;
  transcribe(audio: Uint8Array, mimeType: string, hints?: string): Promise<string>;
}

export function createSpeechToText(o: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
}): SpeechToText {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxWait = o.maxWaitMs ?? 20_000;
  const url = `${o.baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
  const label = `${new URL(o.baseUrl).host === "api.groq.com" ? "Groq" : new URL(o.baseUrl).host} · ${o.model}`;
  const extension = (mime: string) => (/ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : /mp4|m4a/.test(mime) ? "m4a" : /mpeg|mp3/.test(mime) ? "mp3" : "webm");

  async function transcribe(audio: Uint8Array, mimeType: string, hints?: string): Promise<string> {
    let waited = 0;
    for (;;) {
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mimeType }), `speech.${extension(mimeType)}`);
      form.append("model", o.model);
      form.append("response_format", "json");
      form.append("temperature", "0");
      // Whisper takes a short prompt as vocabulary; it only biases spelling, it isn't an instruction.
      if (hints) form.append("prompt", hints.slice(0, 600));
      let res: Response;
      try {
        res = await doFetch(url, { method: "POST", headers: { authorization: `Bearer ${o.apiKey}` }, body: form, signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new ChatModelError("unavailable", `Couldn't reach ${label} to hear you. Check your internet connection.`);
      }
      if (res.ok) return String(((await res.json()) as { text?: string }).text ?? "").trim();
      if (res.status === 429) {
        const wait = Math.min(waitFrom(res.headers) ?? 3000, 15_000);
        if (waited + wait <= maxWait) {
          waited += wait;
          await sleep(wait);
          continue;
        }
        throw new ChatModelError("rate_limited", "The free speech service is at its limit for the moment. Wait a minute, then speak again.");
      }
      if (res.status === 401 || res.status === 403) throw new ChatModelError("auth", `${label} refused the key. Check CHAT_AI_API_KEY in apps/server/.env.local.`);
      throw new ChatModelError(res.status >= 500 ? "unavailable" : "bad_request", `${label} couldn't hear that (${res.status}). Try again.`);
    }
  }

  return { label, transcribe };
}

/** Speaks a short piece of text (Groq's Orpheus takes up to 200 characters at a time) as audio. */
export interface TextToSpeech {
  readonly label: string;
  speak(text: string): Promise<{ audio: Uint8Array; mimeType: string }>;
}

export const SPEECH_CHUNK = 200;

export function createTextToSpeech(o: { baseUrl: string; apiKey: string; model: string; voice: string; fetch?: typeof fetch }): TextToSpeech {
  const doFetch = o.fetch ?? fetch;
  const url = `${o.baseUrl.replace(/\/$/, "")}/audio/speech`;
  const label = `${new URL(o.baseUrl).host === "api.groq.com" ? "Groq" : new URL(o.baseUrl).host} · ${o.model} (${o.voice})`;

  async function speak(text: string) {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: o.model, voice: o.voice, input: text.slice(0, SPEECH_CHUNK), response_format: "wav" }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ChatModelError("unavailable", `Couldn't reach ${label}.`);
    }
    if (res.ok) return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/wav" };
    const body = await res.text().catch(() => "");
    if (/model_terms_required/.test(body)) {
      const link = /https:\/\/console\.groq\.com\/playground[^\s"]*/.exec(body)?.[0] ?? "https://console.groq.com/playground";
      throw new ChatModelError("auth", `The human-sounding voice needs a one-time OK from the Groq account owner: open ${link} and accept the terms.`);
    }
    if (res.status === 429) throw new ChatModelError("rate_limited", "The voice service is at its limit for the moment.");
    if (res.status === 401 || res.status === 403) throw new ChatModelError("auth", `${label} refused the key.`);
    throw new ChatModelError(res.status >= 500 ? "unavailable" : "bad_request", `${label} couldn't speak that (${res.status}${/voice/i.test(body) ? `: ${body.slice(0, 160)}` : ""}).`);
  }

  return { label, speak };
}
