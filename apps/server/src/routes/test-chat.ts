// The test chat (S22b): text the AI the way a customer would, through the same tools as a phone call.
// See chat/test-chat.ts. Owners and managers only, like the test call.
import { testChatMessageInput } from "@receptionist/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TestChats } from "../chat/test-chat.ts";
import type { Deps } from "../deps.ts";
import { invalid } from "../errors.ts";
import { lidParam, parse, who } from "../http.ts";

const chatParam = z.object({ lid: z.uuid("That isn't a valid id."), cid: z.uuid("That chat has ended. Start a new one.") });
const startInput = z.object({ mode: z.enum(["chat", "voice"]).default("chat") });
const AUDIO_LIMIT = 2 * 1024 * 1024; // a spoken turn is capped at 30 s by the dashboard; about 4 KB a second

export function registerTestChatRoutes(api: FastifyInstance, deps: Deps) {
  const chats = new TestChats(deps);
  api.addHook("onClose", async () => chats.close());
  // A browser call sends each spoken turn as raw audio (webm or ogg from the microphone).
  api.addContentTypeParser(/^audio\//, { parseAs: "buffer", bodyLimit: AUDIO_LIMIT }, (_req, body, done) => done(null, body));

  api.get("/locations/:lid/test-chat", async (req) => {
    const { lid } = parse(lidParam, req.params);
    await deps.access.forLocation(who(req), lid, "agent.test");
    return { configured: chats.model !== null, model: chats.model, voice: deps.providers.stt !== null };
  });

  api.post("/locations/:lid/test-chat", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const { mode } = parse(startInput, req.body ?? {});
    return reply.status(201).send(await chats.start(a, lid, mode));
  });

  api.post("/locations/:lid/test-chat/:cid/messages", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { lid, cid } = parse(chatParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const { text } = parse(testChatMessageInput, req.body);
    return chats.send(a, lid, cid, text);
  });

  api.post("/locations/:lid/test-chat/:cid/audio", { bodyLimit: AUDIO_LIMIT, config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (req) => {
    const { lid, cid } = parse(chatParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const audio = req.body;
    if (!(audio instanceof Buffer) || audio.length === 0) throw invalid("Send the recording as audio.");
    return chats.hear(a, lid, cid, new Uint8Array(audio), String(req.headers["content-type"] ?? "audio/webm"));
  });

  api.post("/locations/:lid/test-chat/:cid/end", async (req, reply) => {
    const { lid, cid } = parse(chatParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    await chats.end(a, lid, cid);
    return reply.status(204).send();
  });
}
