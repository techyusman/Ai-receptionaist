"use server";

import { z } from "zod";
import { run } from "@/server/action";
import * as api from "@/server/api";

// The test chat keeps its own conversation on screen, so none of these re-render the page.
const chatId = z.uuid();
const MAX_AUDIO = 2_000_000; // about 30 seconds of speech; the browser stops a turn there

export async function chatStart(mode: "chat" | "voice" = "chat") {
  return run(() => api.startTestChat(z.enum(["chat", "voice"]).parse(mode)), { refresh: false });
}

export async function chatSend(id: string, text: string) {
  return run(() => api.sendTestChat(chatId.parse(id), z.string().trim().min(1, "Type a message first.").max(500, "Keep a message under 500 characters.").parse(text)), { refresh: false });
}

/** One spoken turn of a browser call, as recorded by the microphone. */
export async function chatHear(id: string, form: FormData) {
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return { ok: false as const, message: "Nothing was recorded. Check the microphone." };
  if (audio.size > MAX_AUDIO) return { ok: false as const, message: "That turn was too long. Keep each turn under 30 seconds." };
  return run(async () => api.sendTestChatAudio(chatId.parse(id), new Uint8Array(await audio.arrayBuffer()), audio.type || "audio/webm"), { refresh: false });
}

export async function chatEnd(id: string) {
  return run(() => api.endTestChat(chatId.parse(id)), { refresh: false });
}
