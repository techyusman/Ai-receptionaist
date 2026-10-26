"use server";

import { z } from "zod";
import { run } from "@/server/action";
import * as api from "@/server/api";

// The test chat keeps its own conversation on screen, so none of these re-render the page.
const chatId = z.uuid();

export async function chatStart() {
  return run(() => api.startTestChat(), { refresh: false });
}

export async function chatSend(id: string, text: string) {
  return run(() => api.sendTestChat(chatId.parse(id), z.string().trim().min(1, "Type a message first.").max(500, "Keep a message under 500 characters.").parse(text)), { refresh: false });
}

export async function chatEnd(id: string) {
  return run(() => api.endTestChat(chatId.parse(id)), { refresh: false });
}
