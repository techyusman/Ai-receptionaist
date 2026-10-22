import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createOpenAiRealtime } from "../src/providers/realtime-openai.ts";
import { createTwilio } from "../src/providers/twilio.ts";

type Call = { method: string; uri: string; params?: Record<string, unknown>; data?: Record<string, unknown> };

function fakeTwilioHttp(replies: Record<string, unknown>) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      async request(opts: Call) {
        calls.push(opts);
        const key = Object.keys(replies).find((k) => opts.uri.includes(k));
        return { statusCode: key ? 200 : 404, body: key ? replies[key] : { message: "not found" }, headers: {} };
      },
    },
  };
}

const creds = { accountSid: "AC" + "1".repeat(32), authToken: "auth", apiKeySid: "SK" + "2".repeat(32), apiKeySecret: "secret", twimlAppSid: "AP" + "3".repeat(32), messagingServiceSid: "MG" + "4".repeat(32) };

test("Twilio: number search, purchase with our webhook URLs, redirecting a live call, and texting", async () => {
  const http = fakeTwilioHttp({
    "AvailablePhoneNumbers/US/Local": { available_phone_numbers: [{ phone_number: "+13475550142", locality: "Brooklyn", region: "NY" }] },
    "IncomingPhoneNumbers.json": { sid: "PN" + "5".repeat(32), phone_number: "+13475550142" },
    "Calls/": { sid: "CA" + "6".repeat(32) },
    "Messages.json": { sid: "SM" + "7".repeat(32) },
  });
  const t = createTwilio(creds, { httpClient: http.client });
  const found = await t.searchNumbers("347");
  assert.deepEqual(found, [{ e164: "+13475550142", locality: "Brooklyn, NY" }]);
  assert.equal(http.calls[0]!.method, "get");
  assert.equal(String(http.calls[0]!.params?.AreaCode), "347");

  const bought = await t.buyNumber("+13475550142", { voiceUrl: "https://api.example.test/webhooks/twilio/voice", statusCallbackUrl: "https://api.example.test/webhooks/twilio/status", fallbackUrl: "https://bin.example/f?dial=%2B1" });
  assert.equal(bought.e164, "+13475550142");
  const create = http.calls.find((c) => c.uri.includes("IncomingPhoneNumbers.json"))!;
  assert.equal(create.data?.VoiceUrl, "https://api.example.test/webhooks/twilio/voice");
  assert.equal(create.data?.VoiceFallbackUrl, "https://bin.example/f?dial=%2B1");
  assert.equal(create.data?.PhoneNumber, "+13475550142");

  await t.redirectCall("CA" + "6".repeat(32), "<Response><Hangup/></Response>");
  const redirect = http.calls.find((c) => c.uri.includes("/Calls/"))!;
  assert.equal(redirect.data?.Twiml, "<Response><Hangup/></Response>");
  await t.sendSms("+13475550101", "Missed transfer.");
  const sms = http.calls.find((c) => c.uri.includes("Messages.json"))!;
  assert.equal(sms.data?.MessagingServiceSid, creds.messagingServiceSid);
  assert.equal(sms.data?.To, "+13475550101");
});

test("Twilio: the browser test-call token is a JWT scoped to outgoing calls only, and signatures verify", () => {
  const t = createTwilio(creds, { httpClient: fakeTwilioHttp({}).client });
  const jwt = t.voiceAccessToken("test-user-loc", 600);
  const body = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"));
  assert.equal(body.iss, creds.apiKeySid);
  assert.equal(body.sub, creds.accountSid);
  assert.equal(body.grants.identity, "test-user-loc");
  assert.equal(body.grants.voice.outgoing.application_sid, creds.twimlAppSid);
  assert.ok(!body.grants.voice.incoming?.allow, "a test browser can place calls, not receive them");
  assert.ok(body.exp - body.iat <= 600);
  const sig = "invalid";
  assert.equal(t.validateSignature(sig, "https://api.example.test/x", { A: "1" }), false);
});

test("OpenAI: connects with the project's key and the pinned model, passes events both ways, and reports a close", async () => {
  const seen: { auth?: string; url?: string; got: unknown[] } = { got: [] };
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (ws, req) => {
    seen.auth = req.headers.authorization;
    seen.url = req.url;
    ws.on("message", (d) => {
      seen.got.push(JSON.parse(d.toString()));
      ws.send(JSON.stringify({ type: "session.updated" }));
    });
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as { port: number }).port;
  const connector = createOpenAiRealtime({ apiKey: "sk-test", model: "gpt-realtime-test", url: `ws://127.0.0.1:${port}/v1/realtime` });
  const session = await connector.connect();
  const received: unknown[] = [];
  session.onEvent((e) => received.push(e));
  let closedWith: number | null = null;
  session.onClose((c) => (closedWith = c));
  session.send({ type: "session.update", session: { type: "realtime" } });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(seen.auth, "Bearer sk-test");
  assert.match(seen.url!, /model=gpt-realtime-test/);
  assert.deepEqual(seen.got, [{ type: "session.update", session: { type: "realtime" } }]);
  assert.deepEqual(received, [{ type: "session.updated" }]);
  for (const c of wss.clients) c.close(1012);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(closedWith, 1012);
  wss.close();
  await new Promise<void>((r) => http.close(() => r()));
});

test("OpenAI: an unreachable or refused connection rejects instead of hanging", async () => {
  const connector = createOpenAiRealtime({ apiKey: "sk-test", model: "m", url: "ws://127.0.0.1:1/v1/realtime", connectTimeoutMs: 500 });
  await assert.rejects(connector.connect());
});
