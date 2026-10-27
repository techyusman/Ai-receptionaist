"use client";

import { formatMoney } from "@receptionist/domain";
import { CheckCheck, Hand, MessageCircle, Mic, MicOff, Phone, PhoneOff, RotateCcw, SendHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { chatEnd, chatHear, chatSend, chatStart } from "@/app/actions/test-chat";
import { Button, IconButton } from "@/components/ui/button";
import { RadioGroup } from "@/components/ui/controls";
import { Card, StatusPill } from "@/components/ui/display";
import type { OrderSummary } from "@/data/types";
import type { ChatTurn } from "@/server/http/api";
import { cn } from "@/lib/cn";
import { useVoiceCall, type CallState, type VoiceChoice } from "./use-voice-call";

type Message = { id: number; from: "customer" | "ai" | "system"; text: string; at: Date };

const STAND_IN = /^Scripted stand-in/;
const SENT_STATUSES = new Set(["SUBMITTED_TO_POS", "RECEIVED_BY_RESTAURANT", "POS_VISIBILITY_UNVERIFIED"]);
const time = (d: Date) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const CALL_STATUS: Record<CallState, string> = {
  off: "",
  connecting: "Calling…",
  listening: "Listening… speak any time",
  hearing: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};
/**
 * A slow answer gets a short "one moment" after this long, so the caller isn't left in silence. Not sooner:
 * most answers take about 2 s, and one that arrives while "one moment" is playing waits for it to finish.
 */
const HOLD_ON_MS = 3_000;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const initials = (name: string) => name.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** " (Hannah, Orpheus)" from the server's "Groq · canopylabs/orpheus-v1-english (hannah)". */
function speechName(label: string | null) {
  const voiceName = label?.match(/\(([^)]+)\)$/)?.[1];
  const engine = /orpheus/i.test(label ?? "") ? "Orpheus" : null;
  const parts = [voiceName && voiceName[0]!.toUpperCase() + voiceName.slice(1), engine].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** How to switch the chat from the scripted stand-in (or nothing) to a real, free AI. */
export function GroqKeySteps() {
  return (
    <ol className="flex list-decimal flex-col gap-1 pl-5 text-left text-sm text-fg">
      <li>
        Get a free key at{" "}
        <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
          console.groq.com/keys
        </a>
        .
      </li>
      <li>
        Put it in <code className="font-mono text-xs">apps/server/.env.local</code> as <code className="font-mono text-xs">CHAT_AI_API_KEY=your-key</code>.
      </li>
      <li>
        Restart <code className="font-mono text-xs">npm run dev:stack</code>.
      </li>
    </ol>
  );
}

/**
 * S22b. A chat drawn like a phone messaging app, with what the AI did and the order beside it. With `voice`
 * it can also be a call from the browser: you talk, the AI answers out loud, and the transcript fills in.
 */
export function ChatWindow({
  restaurant,
  model,
  voice,
  speech,
  country,
  locationId,
}: {
  restaurant: string;
  model: string;
  voice: boolean;
  /** The server's human-sounding voice, or null when only the browser's voice can speak. */
  speech: string | null;
  country: string;
  locationId: string;
}) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [ended, setEnded] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [inCall, setInCall] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [voiceChoice, setVoiceChoice] = useState<VoiceChoice>(speech ? "human" : "browser");
  const [timings, setTimings] = useState<ChatTurn["timings"] | null>(null);
  const nextId = useRef(0);
  const chatIdRef = useRef<string | null>(null);
  /** The greeting of the chat just started, so a call can say it out loud. */
  const messagesGreeting = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = (from: Message["from"], text: string) => setMessages((m) => [...m, { id: ++nextId.current, from, text, at: new Date() }]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, pending]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    if (!inCall) return;
    const started = Date.now();
    const timer = setInterval(() => setCallSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [inCall]);

  // One spoken turn: the server hears it and answers; the answer is spoken, then the call listens again.
  const call = useVoiceCall({
    country,
    locationId,
    voice: voiceChoice,
    onTurn: (audio: Blob) => void heardTurn(audio),
    onNotice: (message: string) => add("system", message),
  });

  async function heardTurn(audio: Blob) {
    const id = chatIdRef.current;
    if (!id) return;
    const form = new FormData();
    form.append("audio", audio, "speech.webm");
    // No dead air: a slow answer gets a short "one moment" first, as a person would say.
    let holding = Promise.resolve();
    const hold = setTimeout(() => (holding = call.holdOn()), HOLD_ON_MS);
    const r = await chatHear(id, form);
    clearTimeout(hold);
    await holding;
    if (!r.ok) {
      add("system", r.message);
      if (/has ended/.test(r.message)) return hangUp(false);
      return call.listen();
    }
    const { heard, turn } = r.data;
    if (turn.timings) setTimings(turn.timings);
    if (heard) add("customer", heard);
    for (const reply of turn.replies) add("ai", reply);
    if (turn.steps.length) setSteps((s) => [...s, ...turn.steps]);
    if (turn.order) setOrder(turn.order);
    if (turn.notice) add("system", turn.notice);
    if (turn.replies.length) await call.speak(turn.replies.join(" "));
    if (turn.ended) return hangUp(false);
    call.listen();
  }

  const startCall = () =>
    start(async () => {
      if (chatId && !ended) await chatEnd(chatId);
      setMessages([]);
      const problem = await call.open();
      if (problem) {
        add("system", problem);
        return;
      }
      const id = await begin("voice");
      if (!id) {
        call.close();
        return;
      }
      call.attach(id);
      setCallSeconds(0);
      setInCall(true);
      const greeting = messagesGreeting.current;
      if (greeting) await call.speak(greeting);
      call.listen();
    });

  function hangUp(byYou = true) {
    call.close();
    setInCall(false);
    setEnded(true);
    const id = chatIdRef.current;
    if (byYou && id) void chatEnd(id);
    add("system", byYou ? "You hung up." : "The call ended.");
  }

  const begin = async (mode: "chat" | "voice" = "chat"): Promise<string | null> => {
    const r = await chatStart(mode);
    if (!r.ok) {
      add("system", r.message);
      return null;
    }
    setChatId(r.data.chatId);
    chatIdRef.current = r.data.chatId;
    messagesGreeting.current = r.data.greeting;
    setEnded(false);
    setSteps([]);
    setOrder(null);
    add("ai", r.data.greeting);
    return r.data.chatId;
  };

  const newChat = () =>
    start(async () => {
      if (chatId && !ended) await chatEnd(chatId);
      setMessages([]);
      await begin();
      input.current?.focus();
    });

  const endChat = () =>
    start(async () => {
      if (!chatId) return;
      await chatEnd(chatId);
      setEnded(true);
      add("system", "You ended the chat.");
    });

  const send = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    start(async () => {
      const id = chatId && !ended ? chatId : await begin();
      if (!id) return;
      add("customer", text);
      const r = await chatSend(id, text);
      if (!r.ok) {
        add("system", r.message);
        if (/has ended/.test(r.message)) setEnded(true);
        return;
      }
      for (const reply of r.data.replies) add("ai", reply);
      if (r.data.timings) setTimings(r.data.timings);
      if (r.data.steps.length) setSteps((s) => [...s, ...r.data.steps]);
      setOrder(r.data.order);
      if (r.data.notice) add("system", r.data.notice);
      if (r.data.ended) setEnded(true);
      input.current?.focus();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {STAND_IN.test(model) && (
        <Card role="status" className="flex flex-col gap-2 bg-accent-subtle">
          <p className="text-sm font-semibold text-fg">Replies come from a scripted stand-in, not a real AI</p>
          <p className="text-sm text-fg">It only answers hours, a few questions and menu searches. For the real AI on a free tier:</p>
          <GroqKeySteps />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <section aria-label={`Chat with ${restaurant}`} className="flex h-[70dvh] max-h-176 min-h-96 flex-col overflow-hidden rounded-lg border border-border shadow-card">
          <header className="flex items-center gap-3 bg-chat-header px-3 py-2 text-on-chat-header">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-pill bg-chat-in text-sm font-semibold text-fg">
              {initials(restaurant)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{restaurant}</p>
              <p className="truncate text-xs" aria-live="polite">
                {inCall ? `On a call · ${clock(callSeconds)}` : pending && chatId ? "typing…" : ended ? "chat ended" : chatId ? "AI assistant · online" : "AI assistant"}
              </p>
            </div>
            {voice && !inCall && (
              <IconButton label="Call the AI" size="sm" variant="ghost" className="text-on-chat-header hover:bg-chat-in/20" disabled={pending} onClick={startCall}>
                <Phone aria-hidden />
              </IconButton>
            )}
            <IconButton label="New chat" size="sm" variant="ghost" className="text-on-chat-header hover:bg-chat-in/20" disabled={pending || inCall} onClick={newChat}>
              <RotateCcw aria-hidden />
            </IconButton>
            <IconButton label="End chat" size="sm" variant="ghost" className="text-on-chat-header hover:bg-chat-in/20" disabled={pending || !chatId || ended || inCall} onClick={endChat}>
              <X aria-hidden />
            </IconButton>
          </header>

          {inCall && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-chat-in px-3 py-2">
              <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg" role="status">
                {/* How loud the microphone hears you, so you can tell it's working. */}
                <span aria-hidden className="h-2 w-12 shrink-0 overflow-hidden rounded-pill bg-surface-muted">
                  <span className="block h-full rounded-pill bg-chat-header" style={{ width: `${Math.round(call.level * 100)}%` }} />
                </span>
                <span className="truncate">{call.muted ? "Muted" : CALL_STATUS[call.state]}</span>
              </span>
              {call.state === "speaking" && (
                <Button size="sm" variant="secondary" onClick={call.interrupt}>
                  <Hand aria-hidden /> Let me speak
                </Button>
              )}
              <IconButton label={call.muted ? "Unmute" : "Mute"} size="sm" variant="secondary" aria-pressed={call.muted} onClick={call.toggleMute}>
                {call.muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
              </IconButton>
              <Button size="sm" variant="danger" onClick={() => hangUp(true)}>
                <PhoneOff aria-hidden /> Hang up
              </Button>
            </div>
          )}

          <div role="log" aria-label="Messages" className="flex flex-1 flex-col gap-2 overflow-y-auto bg-chat-wallpaper px-3 py-4">
            {messages.length === 0 && !pending && (
              <div className="m-auto flex max-w-xs flex-col items-center gap-3 rounded-lg bg-chat-in px-4 py-5 text-center shadow-card">
                <MessageCircle aria-hidden className="size-6 text-muted" />
                <p className="text-sm text-fg">Say hello, ask about the hours, or order something. You&apos;re the customer.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={newChat}>
                    Start chat
                  </Button>
                  {voice && (
                    <Button size="sm" variant="secondary" onClick={startCall}>
                      <Phone aria-hidden /> Call the AI
                    </Button>
                  )}
                </div>
                {voice && <p className="text-xs text-muted">A call uses your microphone and speakers; it works in Edge and Chrome.</p>}
              </div>
            )}
            {messages.map((m) =>
              m.from === "system" ? (
                <p key={m.id} className="mx-auto max-w-[85%] rounded-md bg-chat-in px-3 py-1.5 text-center text-xs text-muted shadow-card">
                  {m.text}
                </p>
              ) : (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm text-fg shadow-card",
                    m.from === "customer" ? "self-end rounded-br-xs bg-chat-out" : "self-start rounded-bl-xs bg-chat-in",
                  )}
                >
                  <span className="sr-only">{m.from === "customer" ? "You: " : "AI: "}</span>
                  <span className="whitespace-pre-wrap">{m.text}</span>
                  <span className="float-right mt-1 ml-3 flex items-center gap-1 text-xs text-muted">
                    {time(m.at)}
                    {m.from === "customer" && <CheckCheck aria-hidden className="size-3.5" />}
                  </span>
                </div>
              ),
            )}
            {pending && chatId && (
              <div className="self-start rounded-lg rounded-bl-xs bg-chat-in px-3 py-2 text-sm text-muted shadow-card" aria-hidden>
                <span className="animate-pulse motion-reduce:animate-none">typing…</span>
              </div>
            )}
            <div ref={bottom} />
          </div>

          <form
            className="flex items-center gap-2 border-t border-border bg-surface px-2 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label htmlFor="chat-message" className="sr-only">
              Message
            </label>
            <input
              id="chat-message"
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              autoComplete="off"
              disabled={inCall}
              placeholder={inCall ? "On a call: just speak" : ended ? "Chat ended. Type to start a new one" : "Type a message"}
              className="h-10 min-w-0 flex-1 rounded-pill border border-input bg-surface px-4 text-sm text-fg placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            />
            <IconButton label="Send" type="submit" disabled={pending || inCall || !draft.trim()} className="rounded-pill bg-chat-header text-on-chat-header hover:bg-chat-header">
              <SendHorizontal aria-hidden />
            </IconButton>
          </form>
        </section>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg text-fg">The order so far</h2>
              {order && <StatusPill domain="order" value={order.status} size="sm" />}
            </div>
            {!order || order.lines.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet. Order something in the chat.</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1">
                  {order.lines.map((l) => (
                    <li key={l.lineNo} className="text-sm text-fg">
                      {l.quantity} × {l.itemName} <span className="text-muted">({l.variationName})</span>
                      {l.modifiers.length > 0 && <span className="block text-xs text-muted">{l.modifiers.map((x) => x.name).join(", ")}</span>}
                    </li>
                  ))}
                </ul>
                {order.totals && <p className="text-sm font-semibold text-fg">Total {formatMoney(order.totals.totalMinor, order.currency)}, paid at pickup</p>}
                {SENT_STATUSES.has(order.status) && (
                  <Link href="/live" className="text-sm text-accent underline underline-offset-2">
                    See it on Live orders
                  </Link>
                )}
              </>
            )}
          </Card>

          <Card className="flex flex-col gap-2">
            <h2 className="text-lg text-fg">What the AI did</h2>
            {steps.length === 0 ? (
              <p className="text-sm text-muted">Each menu search, order change and lookup shows here, as on a call&apos;s timeline.</p>
            ) : (
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-fg">
                {steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            )}
            <p className="text-xs text-muted">Answering with {model}.</p>
          </Card>

          {voice && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg text-fg">On a call</h2>
              <RadioGroup
                legend="The AI's voice"
                value={voiceChoice}
                onValueChange={(v) => setVoiceChoice(v as VoiceChoice)}
                disabled={inCall}
                options={[
                  {
                    value: "human",
                    title: `Human-like${speechName(speech)}`,
                    description: "Sounds like a person. Free for about 100 replies a day; past that, the browser's voice takes over.",
                    disabledReason: speech ? undefined : "Not set up on this server: it needs CHAT_AI_API_KEY in apps/server/.env.local.",
                  },
                  {
                    value: "browser",
                    title: "This browser's voice",
                    description: "No limit. Microsoft Edge has the most natural ones, including Pakistani English.",
                  },
                ]}
              />
              <p className="text-sm text-fg" aria-live="polite">
                {call.timing
                  ? `Last reply started ${seconds(call.timing.gapMs)} after you stopped talking${timings?.hearMs !== undefined ? `: hearing you ${seconds(timings.hearMs)}, the AI ${seconds(timings.thinkMs)}` : ""}, voice ${seconds(call.timing.voiceMs)} (${call.timing.voice}).`
                  : timings
                    ? `Last answer took ${seconds((timings.hearMs ?? 0) + timings.thinkMs)}.`
                    : "Each reply's speed shows here."}
              </p>
              {timings && (
                <p className="text-xs text-muted">
                  {timings.modelCalls} AI {timings.modelCalls === 1 ? "step" : "steps"}
                  {timings.model ? ` on ${timings.model}` : ""}
                  {timings.tokens ? `, ${timings.tokens.toLocaleString("en-US")} tokens` : ""}.
                  {timings.waitedMs ? ` ${seconds(timings.waitedMs)} of that was waiting for Groq's free limit (8,000 tokens a minute per model).` : ""} Your
                  turn ends after 0.7 s of quiet.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
