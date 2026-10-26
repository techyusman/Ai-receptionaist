// The test chat (S22b): text the AI the way a customer would, through the same tools as a phone call.
// See chat/test-chat.ts. Owners and managers only, like the test call.
import { testChatMessageInput } from "@receptionist/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TestChats } from "../chat/test-chat.ts";
import type { Deps } from "../deps.ts";
import { lidParam, parse, who } from "../http.ts";

const chatParam = z.object({ lid: z.uuid("That isn't a valid id."), cid: z.uuid("That chat has ended. Start a new one.") });

export function registerTestChatRoutes(api: FastifyInstance, deps: Deps) {
  const chats = new TestChats(deps);
  api.addHook("onClose", async () => chats.close());

  api.get("/locations/:lid/test-chat", async (req) => {
    const { lid } = parse(lidParam, req.params);
    await deps.access.forLocation(who(req), lid, "agent.test");
    return { configured: chats.model !== null, model: chats.model };
  });

  api.post("/locations/:lid/test-chat", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    return reply.status(201).send(await chats.start(a, lid));
  });

  api.post("/locations/:lid/test-chat/:cid/messages", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { lid, cid } = parse(chatParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    const { text } = parse(testChatMessageInput, req.body);
    return chats.send(a, lid, cid, text);
  });

  api.post("/locations/:lid/test-chat/:cid/end", async (req, reply) => {
    const { lid, cid } = parse(chatParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "agent.test");
    await chats.end(a, lid, cid);
    return reply.status(204).send();
  });
}
