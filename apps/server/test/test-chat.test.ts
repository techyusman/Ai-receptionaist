import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { maybeOne, withSystem } from "@receptionist/db";
import { buildApp } from "../src/app.ts";
import { forModel, plain, redact } from "../src/chat/test-chat.ts";
import { ChatModelError, createChatModel, waitFrom, type ChatMessage, type ChatModel, type ChatReply } from "../src/providers/chat.ts";
import type { SpeechToText, TextToSpeech } from "../src/providers/speech.ts";
import { squareReady, type Ready } from "./fixtures.ts";
import { newUser, signUp, startHarness, type Harness, type TestUser } from "./harness.ts";

type J = any; // tool results are plain JSON
type Step = (messages: ChatMessage[]) => ChatReply;

/** A model that follows a script, one step per call, and keeps what it was sent. */
class ScriptModel implements ChatModel {
  readonly label = "Script";
  steps: Step[] = [];
  seen: ChatMessage[][] = [];
  failNext: Error | null = null;
  async complete(messages: ChatMessage[]): Promise<ChatReply> {
    this.seen.push(structuredClone(messages));
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const step = this.steps.shift();
    if (!step) throw new Error("the script ran out");
    return step(messages);
  }
}

let n = 0;
const call = (name: string, args: Record<string, unknown>): ChatReply => ({ content: null, toolCalls: [{ id: `c${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const say = (content: string): ChatReply => ({ content, toolCalls: [] });
const lastResult = (m: ChatMessage[]): J => JSON.parse((m.at(-1) as { content: string }).content);

/** Hears whatever the test says was said, and keeps what it was given. */
class FakeEars implements SpeechToText {
  readonly label = "Ears";
  next = "";
  got: { bytes: number; mimeType: string; hints?: string }[] = [];
  async transcribe(audio: Uint8Array, mimeType: string, hints?: string) {
    this.got.push({ bytes: audio.length, mimeType, hints });
    return this.next;
  }
}

/** Speaks by returning the text as bytes; can be told to refuse like Groq before its terms are accepted. */
class FakeVoice implements TextToSpeech {
  readonly label = "Voice";
  refuse = false;
  asked: string[] = [];
  async speak(text: string) {
    this.asked.push(text);
    if (this.refuse) throw new ChatModelError("auth", "The human-sounding voice needs a one-time OK from the Groq account owner: open https://console.groq.com/playground and accept the terms.");
    return { audio: new TextEncoder().encode(`RIFF:${text}`), mimeType: "audio/wav" };
  }
}

let h: Harness;
let r: Ready;
const model = new ScriptModel();
const ears = new FakeEars();
const voice = new FakeVoice();
const maya = newUser("Maya Owner");
const sam = newUser("Sam Staff");
const jordan = newUser("Jordan Manager");

async function join(who: TestUser, role: "MANAGER" | "STAFF") {
  assert.equal((await h.call(maya, "POST", `/restaurants/${r.rid}/invitations`, { email: who.email, role })).status, 201);
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(h.email.sent.at(-1)!.text)![1]!);
  assert.equal((await h.call(who, "POST", "/invitations/accept", { token })).status, 200);
}

before(async () => {
  h = await startHarness({ square: true, chat: model, stt: ears, tts: voice });
  r = await squareReady(h, maya, "Chat Cafe", "DASHBOARD_TICKET");
  await h.call(maya, "PATCH", `/locations/${r.lid}/settings`, { orderingEnabled: true, transcriptEnabled: true });
  await join(sam, "STAFF");
  await join(jordan, "MANAGER");
});
after(async () => {
  await h.stop();
});

const start = async (who: TestUser = maya) => {
  const res = await h.call(who, "POST", `/locations/${r.lid}/test-chat`, {});
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { chatId: string; greeting: string; model: string };
};
const send = async (cid: string, text: string, who: TestUser = maya) => {
  const res = await h.call(who, "POST", `/locations/${r.lid}/test-chat/${cid}/messages`, { text });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { replies: string[]; steps: string[]; order: J; notice: string | null; ended: boolean };
};

describe("the test chat", () => {
  test("a whole pickup order by chat, through the same tools as a phone call, flagged as a test", async () => {
    const chat = await start();
    assert.match(chat.greeting, /\b(AI|assistant)\b/i);
    assert.equal(chat.model, "Script");

    let latte: J, version = 0;
    model.steps = [
      () => call("search_menu", { query: "latte" }),
      (m) => {
        latte = lastResult(m).matches.find((x: J) => x.name === "Latte");
        return call("get_item_options", { item: latte.item });
      },
      (m) => {
        const o = lastResult(m);
        const milk = o.choices.find((c: J) => c.name === "Milk");
        const oat = milk.options.find((x: J) => x.name === "Oat milk");
        const small = o.variations.find((v: J) => v.name === "Small");
        return call("update_order_draft", { op: "add_item", item: latte.item, variation: small.variation, quantity: 1, choices: [{ list: milk.list, option: oat.option }] });
      },
      () => say("One small oat latte. What name and number should I put it under?"),
    ];
    const t1 = await send(chat.chatId, "A small latte with oat milk please");
    assert.deepEqual(t1.replies, ["One small oat latte. What name and number should I put it under?"]);
    assert.equal(t1.order.lines[0].itemName, "Latte");
    assert.ok(t1.steps.some((s) => s.startsWith("Searched the menu for “latte”")), t1.steps.join(" | "));
    assert.ok(t1.steps.includes("Order draft: add item."), t1.steps.join(" | "));

    // The model saw the chat version of the rules, and every tool result came back under its call's id.
    const sent = model.seen.at(-1)!;
    assert.match((sent[0] as { content: string }).content, /text chat/);
    const asked = sent.filter((x) => x.role === "assistant" && x.tool_calls).flatMap((x) => (x as J).tool_calls.map((c: J) => c.id));
    const answered = sent.filter((x) => x.role === "tool").map((x) => (x as J).tool_call_id);
    assert.deepEqual(answered, asked);

    model.steps = [
      () => call("set_customer_details", { name: "Priya", phone: "212 555 0101", phone_source: "spoken" }),
      () => call("calculate_order_total", {}),
      (m) => {
        const priced = lastResult(m);
        version = priced.version;
        return say(`That's 1 small Latte with oat milk, for Priya at 212 555 0101. Your total is ${priced.total}. Is that all correct?`);
      },
    ];
    const t2 = await send(chat.chatId, "Priya, 212 555 0101");
    assert.equal(t2.order.status, "READY_FOR_CONFIRMATION");
    assert.ok(version > 0);

    model.steps = [
      () => call("mark_customer_confirmation", { version, confirmed: true }),
      () => call("submit_confirmed_order", {}),
      (m) => say(String(lastResult(m).say)),
    ];
    const t3 = await send(chat.chatId, "Yes, that's right");
    assert.equal(t3.order.status, "SUBMITTED_TO_POS");
    assert.equal(t3.order.isTest, true);
    assert.equal(t3.ended, false);

    assert.equal((await h.call(maya, "POST", `/locations/${r.lid}/test-chat/${chat.chatId}/end`, {})).status, 204);
    const kept = await withSystem(h.db, (tx) => maybeOne<{ segments: { speaker: string; text: string }[] }>(tx, "select segments from call_transcripts where call_id = $1", [chat.chatId]));
    assert.deepEqual(kept!.segments.map((x) => x.speaker), ["AI", "CALLER", "AI", "CALLER", "AI", "CALLER", "AI"]);
    assert.equal(kept!.segments[3]!.text, "Priya, •••0101", "the number is masked in the transcript");
    const row = await withSystem(h.db, (tx) => maybeOne<{ status: string; is_test: boolean; provider_call_sid: string; from_e164: string | null }>(tx, "select status, is_test, provider_call_sid, from_e164 from calls where id = $1", [chat.chatId]));
    assert.equal(row?.status, "ENDED");
    assert.equal(row?.is_test, true);
    assert.match(row!.provider_call_sid, /^CHAT-/);
    assert.equal(row?.from_e164, null, "a chat has no caller ID");
    assert.equal((await h.call(maya, "POST", `/locations/${r.lid}/test-chat/${chat.chatId}/messages`, { text: "hello?" })).status, 404, "an ended chat is gone");
  });

  test("the AI can't save a phone number the caller never said; once they say it, even in words, it goes through", async () => {
    const chat = await start();
    let first: J, second: J;
    model.steps = [
      () => call("set_customer_details", { name: "Customer", phone: "212 555 0199", phone_source: "spoken" }),
      (m) => {
        first = lastResult(m);
        return say("What name and number should I put it under?");
      },
    ];
    const t1 = await send(chat.chatId, "A small latte please");
    assert.equal(first.ok, false);
    assert.equal(first.reason, "NOT_SAID");
    assert.match(first.say, /Ask/);
    assert.ok(t1.steps.includes("Customer details refused (NOT_SAID)."), t1.steps.join(" | "));

    model.steps = [
      () => call("request_callback", { name: "Priya", phone: "212 555 0199", consent: true }),
      (m) => {
        second = lastResult(m);
        return say("Thanks, Priya.");
      },
    ];
    await send(chat.chatId, "Priya. Two one two, five five five, zero one nine nine");
    assert.notEqual(second.reason, "NOT_SAID", JSON.stringify(second));
  });

  test("the AI can't confirm the order for the customer: a yes counts only if it came after the read-back", async () => {
    const chat = await start();
    let latte: J, refused: J, version = 0;
    model.steps = [
      () => call("search_menu", { query: "latte" }),
      (m) => {
        latte = lastResult(m).matches.find((x: J) => x.name === "Latte");
        return call("get_item_options", { item: latte.item });
      },
      (m) => {
        const o = lastResult(m);
        const milk = o.choices.find((c: J) => c.name === "Milk");
        const small = o.variations.find((v: J) => v.name === "Small");
        return call("update_order_draft", { op: "add_item", item: latte.item, variation: small.variation, quantity: 1, choices: [{ list: milk.list, option: milk.options[0].option }] });
      },
      () => call("set_customer_details", { name: "Priya", phone: "212 555 0101", phone_source: "spoken" }),
      () => call("calculate_order_total", {}),
      (m) => {
        version = lastResult(m).version;
        return call("mark_customer_confirmation", { version, confirmed: true });
      },
      (m) => {
        refused = lastResult(m);
        return say("That's one small latte for Priya. Is that all correct?");
      },
    ];
    const t1 = await send(chat.chatId, "A small latte for Priya, 212 555 0101");
    assert.equal(refused.reason, "NOT_ASKED", JSON.stringify(refused));
    assert.equal(t1.order.status, "READY_FOR_CONFIRMATION", "not confirmed on the AI's own say-so");
    assert.ok(t1.steps.includes("Confirmation refused (NOT_ASKED)."), t1.steps.join(" | "));

    model.steps = [() => call("mark_customer_confirmation", { version, confirmed: true }), (m) => say(lastResult(m).ok ? "Great, sending it now." : "Hmm.")];
    const t2 = await send(chat.chatId, "Yes, that's right");
    assert.deepEqual(t2.replies, ["Great, sending it now."]);
  });

  test("stage directions and answers the AI writes for the customer are never shown or spoken", () => {
    assert.equal(plain("May I have your name, please?(Waiting for response)(Note: awaiting user input)"), "May I have your name, please?");
    assert.equal(plain("The total is PKR 1,798. Is that all correct?Yes, that's correct."), "The total is PKR 1,798. Is that all correct?");
    assert.equal(plain("Is that a large (12 inch)? Yes, we have it."), "Is that a large (12 inch)? Yes, we have it.", "ordinary text is left alone");
    // Turns run together with no space after the punctuation, the customer's side included: only the first is its own.
    assert.equal(
      plain("Great. May I have your name, please?And your phone number?Please read it back.Sure, it's 03 1234 5678? My name is Ali."),
      "Great. May I have your name, please?",
    );
    assert.equal(plain("The total is PKR 1,798.Is that all correct?"), "The total is PKR 1,798.");
    assert.equal(plain("We open at 12 P.M. today, and a large is Rs. 1,550.50."), "We open at 12 P.M. today, and a large is Rs. 1,550.50.", "abbreviations and decimals are left alone");
  });

  test("a line the AI already said this turn isn't said again", async () => {
    const chat = await start();
    model.steps = [
      () => ({ content: "Sure. May I have your name, please?", toolCalls: [{ id: `c${++n}`, type: "function", function: { name: "search_menu", arguments: JSON.stringify({ query: "latte" }) } }] }),
      () => say("May I have your name, please?"),
    ];
    const t = await send(chat.chatId, "A latte please");
    assert.deepEqual(t.replies, ["Sure. May I have your name, please?"]);
  });

  test("a transfer can't happen in a chat: it's closed, the chat says where a call would have gone, and ends", async () => {
    const added = await h.call(maya, "POST", `/locations/${r.lid}/transfer-targets`, { label: "Front counter", e164: "+12125550177", priority: 1, intent: "GENERAL", activeHours: "ALWAYS", enabled: true, smsAlertOnMiss: false });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    const chat = await start();
    model.steps = [() => call("request_human_transfer", { reason: "caller_request" }), () => say("Of course, connecting you now.")];
    const t = await send(chat.chatId, "Can I talk to a person?");
    assert.equal(t.ended, true);
    assert.match(t.notice!, /put the caller through to Front counter/);
    const transfer = await withSystem(h.db, (tx) => maybeOne<{ result: string | null }>(tx, "select result from transfers where call_id = $1", [chat.chatId]));
    assert.equal(transfer?.result, "CANCELED");
  });

  test("when the model is busy or failing, the chat says so and stays open", async () => {
    const chat = await start();
    model.failNext = new ChatModelError("rate_limited", "The free AI service is at its limit for the moment.");
    const t = await send(chat.chatId, "hello");
    assert.equal(t.notice, "The free AI service is at its limit for the moment.");
    assert.deepEqual(t.replies, []);
    model.steps = [() => say("Hi! What can I get you?")];
    assert.deepEqual((await send(chat.chatId, "hello again")).replies, ["Hi! What can I get you?"]);
  });

  test("only owners and managers can chat, and only in their own chats", async () => {
    assert.equal((await h.call(sam, "POST", `/locations/${r.lid}/test-chat`, {})).status, 403);
    const chat = await start();
    assert.equal((await h.call(jordan, "POST", `/locations/${r.lid}/test-chat/${chat.chatId}/messages`, { text: "hi" })).status, 404, "a manager can't write into the owner's chat");
    const rival = newUser("Rita Rival");
    const other = await signUp(h, rival, "Rival Cafe");
    assert.equal((await h.call(rival, "POST", `/locations/${other.locationId}/test-chat/${chat.chatId}/messages`, { text: "hi" })).status, 404);
    assert.equal((await h.call(maya, "POST", `/locations/${r.lid}/test-chat/${chat.chatId}/messages`, { text: "" })).status, 400);
  });

  test("without a model configured, the chat explains how to add a free key", async () => {
    const bare = await buildApp({ ...h.deps, providers: { ...h.deps.providers, chat: null } });
    const res = await bare.inject({ method: "POST", url: `/api/v1/locations/${r.lid}/test-chat`, headers: { authorization: `Bearer ${await h.token(maya)}`, "content-type": "application/json" }, payload: "{}" });
    const status = await bare.inject({ method: "GET", url: `/api/v1/locations/${r.lid}/test-chat`, headers: { authorization: `Bearer ${await h.token(maya)}` } });
    await bare.close();
    assert.equal(res.statusCode, 503);
    assert.match(JSON.parse(res.body).error.message, /console\.groq\.com\/keys/);
    assert.deepEqual(JSON.parse(status.body), { configured: false, model: null, voice: true, speech: "Voice" });
  });

  test("numbers are masked in what's kept", () => {
    assert.equal(redact("Priya, 212 555 0101"), "Priya, •••0101");
    assert.equal(redact("card 4242 4242 4242 4242 please"), "card •••4242 please");
    assert.equal(redact("2 large pizzas"), "2 large pizzas");
  });
});

describe("calling the AI from the browser (voice test)", () => {
  const speak = async (cid: string, bytes = 2048) =>
    h.app.inject({
      method: "POST", url: `/api/v1/locations/${r.lid}/test-chat/${cid}/audio`,
      headers: { authorization: `Bearer ${await h.token(maya)}`, "content-type": "audio/webm;codecs=opus" }, payload: Buffer.alloc(bytes, 1),
    });

  test("a spoken turn is heard with the menu as hints, answered with the phone rules, and kept as plain text", async () => {
    const res = await h.call(maya, "POST", `/locations/${r.lid}/test-chat`, { mode: "voice" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const cid = res.body.chatId as string;
    ears.next = "Do you have lattes? How much?";
    model.steps = [() => say("Yes, a small Latte is **$4.50**.")];
    const turn = await speak(cid);
    assert.equal(turn.statusCode, 200, turn.body);
    const body = JSON.parse(turn.body);
    assert.equal(body.heard, "Do you have lattes? How much?");
    assert.deepEqual(body.turn.replies, ["Yes, a small Latte is $4.50."], "markdown stars are never spoken or shown");
    assert.equal(ears.got.at(-1)!.mimeType, "audio/webm;codecs=opus");
    assert.match(ears.got.at(-1)!.hints!, /^Chat Cafe, .*Latte/, "the restaurant and its dishes help it spell what it hears");
    assert.match((model.seen.at(-1)![0] as { content: string }).content, /You answer the phone/, "a browser call follows the phone rules");
    const call = await withSystem(h.db, (tx) => maybeOne<{ summary: string }>(tx, "select summary from calls where id = $1", [cid]));
    assert.equal(call?.summary, "Test call from the browser.");
  });

  test("silence or noise is ignored: the model isn't asked", async () => {
    const res = await h.call(maya, "POST", `/locations/${r.lid}/test-chat`, { mode: "voice" });
    const asked = model.seen.length;
    ears.next = "Thank you.";
    const body = JSON.parse((await speak(res.body.chatId)).body);
    assert.equal(body.heard, "");
    assert.deepEqual(body.turn.replies, []);
    assert.equal(model.seen.length, asked);
    assert.equal((await speak(res.body.chatId, 0)).statusCode, 400, "an empty recording is refused");
  });

  test("the AI's voice: each piece of a reply comes back as audio; a voice that isn't allowed yet says how to fix it", async () => {
    const res = await h.call(maya, "POST", `/locations/${r.lid}/test-chat`, { mode: "voice" });
    const cid = res.body.chatId as string;
    const say = (text: string) =>
      h.app.inject({ method: "POST", url: `/api/v1/locations/${r.lid}/test-chat/${cid}/speech`, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, payload: JSON.stringify({ text }) });
    const token = await h.token(maya);
    const ok = await say("Assalam-o-alaikum! What can I get you?");
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.headers["content-type"], "audio/wav");
    assert.equal(ok.body, "RIFF:Assalam-o-alaikum! What can I get you?");
    assert.equal((await say("x".repeat(201))).statusCode, 400, "Orpheus takes 200 characters at a time");
    voice.refuse = true;
    const refused = await say("Hello");
    voice.refuse = false;
    assert.equal(refused.statusCode, 503);
    assert.match(JSON.parse(refused.body).error.message, /accept the terms/);

    // Something said before comes from memory: the greeting repeats on every call, and the free voice allows about 100 a day.
    const before = voice.asked.length;
    assert.equal((await say("Assalam-o-alaikum! What can I get you?")).body, "RIFF:Assalam-o-alaikum! What can I get you?");
    assert.equal(voice.asked.length, before, "not asked of the voice service again");
    voice.refuse = true;
    assert.equal((await say("Hello")).statusCode, 503, "a refusal isn't remembered as audio");
    voice.refuse = false;
    assert.equal((await say("Hello")).statusCode, 200, "and is asked again next time");

    // The goodbye is spoken after the AI has ended the call, so a chat that just ended can still be voiced.
    assert.equal((await h.call(maya, "POST", `/locations/${r.lid}/test-chat/${cid}/end`, {})).status, 204);
    assert.equal((await say("Thanks for calling. Goodbye!")).statusCode, 200);
    const other = h.app.inject({ method: "POST", url: `/api/v1/locations/${r.lid}/test-chat/${cid}/speech`, headers: { authorization: `Bearer ${await h.token(jordan)}`, "content-type": "application/json" }, payload: JSON.stringify({ text: "Hi" }) });
    assert.equal((await other).statusCode, 404, "but only by the person whose chat it was");
  });

  test("without speech-to-text, a browser call explains how to add a free key", async () => {
    const bare = await buildApp({ ...h.deps, providers: { ...h.deps.providers, stt: null } });
    const auth = { authorization: `Bearer ${await h.token(maya)}`, "content-type": "application/json" };
    const start = await bare.inject({ method: "POST", url: `/api/v1/locations/${r.lid}/test-chat`, headers: auth, payload: JSON.stringify({ mode: "voice" }) });
    const status = await bare.inject({ method: "GET", url: `/api/v1/locations/${r.lid}/test-chat`, headers: auth });
    await bare.close();
    assert.equal(start.statusCode, 503);
    assert.match(JSON.parse(start.body).error.message, /console\.groq\.com\/keys/);
    assert.equal(JSON.parse(status.body).voice, false);
  });
});

describe("keeping each request small and fast", () => {
  test("old tool steps are dropped from what the model is sent; every line of the conversation stays", () => {
    const tool = (id: string) => ({ role: "tool" as const, tool_call_id: id, content: '{"matches":["a big list"]}' });
    const asked = (id: string) => ({ role: "assistant" as const, content: null, tool_calls: [{ id, type: "function" as const, function: { name: "search_menu", arguments: "{}" } }] });
    const history: ChatMessage[] = [
      { role: "system", content: "rules" }, { role: "assistant", content: "Hi!" },
      { role: "user", content: "zinger?" }, asked("1"), tool("1"), { role: "assistant", content: "Yes, Rs 650." },
      { role: "user", content: "a meal" }, asked("2"), tool("2"), { role: "assistant", content: "Which drink?" },
      { role: "user", content: "Coke" }, asked("3"), tool("3"),
    ];
    const sent = forModel(history);
    assert.equal(sent.filter((m) => m.role === "tool").length, 2, "the latest two turns keep their tool steps");
    assert.ok(!sent.some((m) => m.role === "tool" && m.tool_call_id === "1"), "the oldest search result is dropped");
    assert.deepEqual(sent.filter((m) => m.role === "user").map((m) => m.content), ["zinger?", "a meal", "Coke"]);
    assert.ok(sent.some((m) => m.role === "assistant" && m.content === "Yes, Rs 650."), "what the AI said stays");
  });
});

describe("the chat model client (OpenAI-compatible, Groq by default)", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const reply = { choices: [{ message: { content: "Hi!", tool_calls: [] } }] };

  test("sends the model, the messages and the tools, with the key", async () => {
    let sent: J = null;
    const m = createChatModel({
      baseUrl: "https://api.groq.com/openai/v1", apiKey: "gsk_test", model: "openai/gpt-oss-120b",
      fetch: async (url, init) => {
        sent = { url, auth: (init!.headers as Record<string, string>).authorization, body: JSON.parse(String(init!.body)) };
        return ok(reply);
      },
    });
    assert.equal(m.label, "Groq · openai/gpt-oss-120b");
    assert.deepEqual(await m.complete([{ role: "user", content: "hi" }], []), { content: "Hi!", toolCalls: [], model: "openai/gpt-oss-120b" });
    assert.equal(sent.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(sent.auth, "Bearer gsk_test");
    assert.equal(sent.body.model, "openai/gpt-oss-120b");
    assert.equal(sent.body.reasoning_effort, "low");
  });

  test("a rate limit is waited out when it's short, and explained when it isn't", async () => {
    const slept: number[] = [];
    let calls = 0;
    let clock = 0;
    const m = createChatModel({
      baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "llama-3.3-70b-versatile", now: () => clock, sleep: async (ms) => void (slept.push(ms), (clock += ms)),
      fetch: async () => (++calls === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "2" } }) : ok(reply)),
    });
    assert.equal((await m.complete([], [])).content, "Hi!");
    assert.deepEqual(slept, [2000]);

    const always = createChatModel({ baseUrl: "https://api.x.ai/v1", apiKey: "k", model: "grok", maxWaitMs: 5000, sleep: async () => {}, fetch: async () => new Response("{}", { status: 429, headers: { "x-ratelimit-reset-tokens": "1m2s" } }) });
    await assert.rejects(always.complete([], []), (e: unknown) => e instanceof ChatModelError && e.problem === "rate_limited");
  });

  test("a busy model hands over to the next one at once; it only waits when every model is busy", async () => {
    const tried: string[] = [];
    const slept: number[] = [];
    let clock = 0;
    const busy = new Set(["openai/gpt-oss-120b"]);
    const m = createChatModel({
      baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "openai/gpt-oss-120b", fallbacks: ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
      now: () => clock, sleep: async (ms) => void (slept.push(ms), (clock += ms)),
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init!.body));
        tried.push(body.model);
        if (busy.has(body.model)) return new Response("{}", { status: 429, headers: { "retry-after": "20" } });
        return ok({ choices: [{ message: { content: `from ${body.model}`, tool_calls: [] } }] });
      },
    });
    const first = await m.complete([], []);
    assert.equal(first.content, "from qwen/qwen3.8-27b");
    assert.deepEqual(slept, [], "no waiting while another model has room");
    assert.equal((await m.complete([], [])).model, "qwen/qwen3.8-27b", "the busy model is skipped until its limit resets");
    assert.deepEqual(tried, ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "qwen/qwen3.8-27b"]);
    busy.add("qwen/qwen3.8-27b");
    busy.add("openai/gpt-oss-20b");
    tried.length = 0;
    clock += 21_000; // the first model's limit has reset, but now every model is busy
    await assert.rejects(m.complete([], []), (e: unknown) => e instanceof ChatModelError && e.problem === "rate_limited");
    assert.ok(slept.length > 0, "with every model busy it waits, then gives up within its budget");
  });

  test("a refused key and a malformed tool call", async () => {
    const refused = createChatModel({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "bad", model: "m", fetch: async () => new Response("{}", { status: 401 }) });
    await assert.rejects(refused.complete([], []), (e: unknown) => e instanceof ChatModelError && e.problem === "auth" && /CHAT_AI_API_KEY/.test(e.message));
    let calls = 0;
    const flaky = createChatModel({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m", fetch: async () => (++calls === 1 ? new Response('{"error":{"code":"tool_use_failed"}}', { status: 400 }) : ok(reply)) });
    assert.equal((await flaky.complete([], [])).content, "Hi!");
    assert.equal(calls, 2);
  });

  test("reads Groq's and the standard wait headers", () => {
    assert.equal(waitFrom(new Headers({ "retry-after": "3" })), 3000);
    assert.equal(waitFrom(new Headers({ "x-ratelimit-reset-tokens": "7.66s" })), 7660);
    assert.equal(waitFrom(new Headers({ "x-ratelimit-reset-requests": "1m2.5s" })), 62500);
    assert.equal(waitFrom(new Headers()), null);
  });
});
