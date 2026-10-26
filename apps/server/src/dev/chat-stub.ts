// A scripted stand-in for the test chat's AI, for the dev stack without a key and for end-to-end tests.
// No language model: it picks a tool from a few keywords, runs it through the real tool code, and turns
// the result into a reply. Good enough to check the screen and the plumbing; the real thing is a model.
import type { ChatMessage, ChatModel, ChatReply, ChatToolCall } from "../providers/chat.ts";

let n = 0;
const call = (name: string, args: Record<string, unknown>): ChatReply => ({
  content: null,
  toolCalls: [{ id: `stub_${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content: string): ChatReply => ({ content, toolCalls: [] });

function toolNameFor(messages: ChatMessage[], id: string): string | null {
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      const c = m.tool_calls.find((t: ChatToolCall) => t.id === id);
      if (c) return c.function.name;
    }
  }
  return null;
}

export class ScriptedChatModel implements ChatModel {
  readonly label = "Scripted stand-in (no AI key set)";

  async complete(messages: ChatMessage[]): Promise<ChatReply> {
    const last = messages.at(-1);
    if (last?.role === "tool") {
      const r = JSON.parse(last.content) as Record<string, any>;
      switch (toolNameFor(messages, last.tool_call_id)) {
        case "get_restaurant_info":
          if (Array.isArray(r.week)) return say(`${r.open_now ? "We're open now." : "We're closed right now."} ${(r.week as string[]).slice(0, 2).join(". ")}.`);
          if (Array.isArray(r.answers) && r.answers.length) return say(String(r.answers[0].answer));
          return say(String(r.say_if_unknown ?? "I don't have that information. I can pass you to someone."));
        case "search_menu": {
          const names = ((r.matches ?? []) as { name: string }[]).map((m) => m.name);
          return say(names.length ? `We have ${names.join(", ")}. Which would you like?` : "I can't find that on our menu. What else can I get you?");
        }
        case "end_call":
          return say("Thanks for chatting. Goodbye!");
        default:
          return say("Done.");
      }
    }
    const text = last?.role === "user" ? last.content.toLowerCase() : "";
    if (/\b(hours?|open|close[sd]?)\b/.test(text)) return call("get_restaurant_info", { topic: "hours" });
    if (/\b(bye|goodbye|that's all|thats all)\b/.test(text)) return call("end_call", { reason: "done" });
    if (/\b(halal|park|parking|deliver|delivery|vegetarian|pay|payment)\b/.test(text)) return call("get_restaurant_info", { topic: "other", question: last?.content });
    if (text.trim()) return call("search_menu", { query: last!.content as string });
    return say("I can help with our hours, our menu and pickup orders. What would you like?");
  }
}
