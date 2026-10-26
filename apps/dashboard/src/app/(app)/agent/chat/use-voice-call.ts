"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A phone-like call in the browser: the microphone is always recording while it listens, a level meter
// notices when you start and stop talking, and each turn is handed over as one recording. The AI's replies
// are spoken with the server's human-sounding voice (Groq's Orpheus) when there is one, and with the
// browser's own best voice when there isn't, or when that voice is slow, refused or at its free limit.
// While the AI speaks, the microphone is ignored so it doesn't hear itself (no headphones needed).

export type CallState = "off" | "connecting" | "listening" | "hearing" | "thinking" | "speaking";
/** Which voice speaks the AI's replies: the server's human-sounding one, or the browser's own. */
export type VoiceChoice = "human" | "browser";
/** How soon the last reply started after you stopped talking, and which voice said it. */
export type ReplyTiming = { gapMs: number; voiceMs: number; voice: string };

const SILENCE_MS = 700; // a pause this long ends your turn
const MIN_SPEECH_MS = 300; // shorter than this is a cough or a click
const MAX_TURN_MS = 30_000; // the server takes up to about 30 seconds a turn
const IDLE_RESTART_MS = 15_000; // a recording with no speech is thrown away and started again
const VOICE_PIECE = 200; // characters the human voice takes at a time
const VOICE_WAIT_MS = 3_000; // the human voice gets this long to start a reply before the browser's says it
const LIMIT_PAUSE_MS = 60_000; // after the human voice hits its free limit, the browser's speaks this long
/** Said while a slow answer is on its way, as a person would. */
const FILLERS = ["One moment.", "Okay, just a second."];

/** The most human-sounding English voice the browser has, then the one closest to the restaurant's region. */
function pickVoice(country: string): SpeechSynthesisVoice | null {
  const regions = country === "PK" ? ["en-pk", "en-in", "en-gb", "en-us"] : ["en-us", "en-gb"];
  const score = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.replace("_", "-").toLowerCase();
    if (!lang.startsWith("en")) return -1;
    // Edge's "Online (Natural)" voices are neural and sound like people; Chrome's "Google" ones come next.
    const human = /natural/i.test(v.name) ? 3 : /online|neural/i.test(v.name) ? 2 : /google/i.test(v.name) ? 1 : 0;
    const region = regions.indexOf(lang);
    return human * 10 + (region < 0 ? 0 : regions.length - region);
  };
  let best: SpeechSynthesisVoice | null = null;
  for (const v of window.speechSynthesis?.getVoices() ?? []) if (score(v) > (best ? score(best) : -1)) best = v;
  return best;
}

/** The browser fills its voice list in the background; wait for it (briefly) so the greeting gets the good voice too. */
const voicesReady = () =>
  new Promise<void>((resolve) => {
    const synth = window.speechSynthesis;
    if (synth.getVoices().length) return resolve();
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      resolve();
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 1_500);
  });

/** Long text is spoken a sentence at a time: some browsers stop a single long utterance part way. */
const sentences = (text: string) => text.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];

/** What the AI wrote, as words a voice reads naturally: "Rs 1,250" as "1,250 rupees", "&" as "and". */
export const spoken = (text: string) =>
  text
    .replace(/(?:\bRs\.?|\bPKR|₨)\s?(\d[\d,]*(?:\.\d{1,2})?)/g, (_, n: string) => `${n.replace(/\.00$/, "")} rupees`)
    .replace(/(\d[\d,]*(?:\.\d{1,2})?)\s?PKR\b/g, (_, n: string) => `${n.replace(/\.00$/, "")} rupees`)
    .replace(/\s&\s/g, " and ")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Joins parts into as few pieces of at most `max` characters as it can. */
function pack(parts: string[], max: number): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const last = out.at(-1);
    if (last !== undefined && last.length + 1 + part.length <= max) out[out.length - 1] = `${last} ${part}`;
    else out.push(part.slice(0, max));
  }
  return out;
}

/** A reply in pieces the human voice takes, split between sentences where it can and between words where it must. */
export const pieces = (text: string, max = VOICE_PIECE) => pack(sentences(text).flatMap((s) => (s.length <= max ? [s] : pack(s.split(/\s+/), max))), max);

/** The human voice said no: `status` is the HTTP status (0 when it was too slow). */
class VoiceProblem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Kept for the whole page, not one call: the free tier allows about 100 pieces a day, the greeting and the
// fillers are the same every call, and a refusal (terms not accepted) doesn't change until the page reloads.
const voiceCache = new Map<string, ArrayBuffer>();
const human = { off: null as string | null, pausedUntil: 0 };

async function fetchVoice(where: { locationId: string; chatId: string }, text: string): Promise<ArrayBuffer> {
  const cached = voiceCache.get(text);
  if (cached) return cached;
  const res = await fetch("/api/chat-speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...where, text }) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new VoiceProblem(res.status, body?.error?.message ?? "The human-sounding voice isn't available right now.");
  }
  const audio = await res.arrayBuffer();
  voiceCache.set(text, audio);
  if (voiceCache.size > 40) voiceCache.delete(voiceCache.keys().next().value!);
  return audio;
}

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new VoiceProblem(0, "slow")), ms))]);

/** One reply being spoken: `finish` ends whatever part is playing, `cancelled` stops the rest. */
type Speech = { cancelled: boolean; source: AudioBufferSourceNode | null; finish: (() => void) | null };

/** Stops a reply: what is playing now, and everything after it. */
function stopSpeech(s: Speech) {
  s.cancelled = true;
  try {
    s.source?.stop();
  } catch {
    // It had already finished.
  }
  window.speechSynthesis?.cancel();
  s.finish?.();
}

/** Plays one piece of decoded audio to the end, or until it is stopped. */
const play = (context: AudioContext, s: Speech, audio: AudioBuffer) =>
  new Promise<void>((resolve) => {
    if (s.cancelled) return resolve();
    const source = context.createBufferSource();
    source.buffer = audio;
    source.connect(context.destination);
    source.onended = () => resolve();
    s.source = source;
    s.finish = resolve;
    source.start();
  });

export function useVoiceCall({
  country,
  locationId,
  voice,
  onTurn,
  onNotice,
}: {
  country: string;
  locationId: string;
  voice: VoiceChoice;
  onTurn: (audio: Blob) => void;
  /** Something to tell the person once per call, such as why the browser's voice took over. */
  onNotice: (message: string) => void;
}) {
  const [state, setStateRaw] = useState<CallState>("off");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [timing, setTiming] = useState<ReplyTiming | null>(null);
  const stateRef = useRef<CallState>("off");
  const mutedRef = useRef(false);
  const onTurnRef = useRef(onTurn);
  const onNoticeRef = useRef(onNotice);
  const voiceRef = useRef(voice);
  const media = useRef<{ stream: MediaStream; context: AudioContext; analyser: AnalyserNode } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const frame = useRef<number | null>(null);
  const turn = useRef({ started: 0, speechStart: 0, lastLoud: 0, noise: 0.01 });
  const chat = useRef<string | null>(null);
  const speech = useRef<Speech | null>(null);
  /** When you stopped talking, until the reply to it starts. */
  const youStopped = useRef(0);
  const told = useRef(new Set<string>());
  const fillerTurn = useRef(0);

  useEffect(() => {
    onTurnRef.current = onTurn;
    onNoticeRef.current = onNotice;
    voiceRef.current = voice;
  }, [onTurn, onNotice, voice]);

  const setState = (s: CallState) => {
    stateRef.current = s;
    setStateRaw(s);
  };

  const tell = useCallback((message: string) => {
    if (told.current.has(message)) return;
    told.current.add(message);
    onNoticeRef.current(message);
  }, []);

  const startRecording = useCallback(() => {
    const m = media.current;
    if (!m) return;
    chunks.current = [];
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(m.stream, type ? { mimeType: type } : undefined);
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.start();
    recorder.current = r;
    turn.current = { ...turn.current, started: performance.now(), speechStart: 0, lastLoud: 0 };
  }, []);

  /** Stops the recording; `keep` hands it over as a turn, otherwise it is thrown away. */
  const stopRecording = useCallback((keep: boolean) => {
    const r = recorder.current;
    recorder.current = null;
    if (!r || r.state === "inactive") return;
    r.onstop = () => {
      if (!keep) return;
      const audio = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
      onTurnRef.current(audio);
    };
    r.stop();
  }, []);

  /** Ends your turn: it goes to the AI, and the wait for its reply starts from when you went quiet. */
  const handOver = useCallback(
    (quietSince: number) => {
      youStopped.current = quietSince;
      setState("thinking");
      stopRecording(true);
    },
    [stopRecording],
  );

  // The level-meter loop, kept in a ref so each frame runs the latest version.
  const tick = useRef<() => void>(() => {});
  useEffect(() => {
    tick.current = () => {
      const m = media.current;
      if (!m) return;
      const data = new Float32Array(m.analyser.fftSize);
      m.analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 8));
      const now = performance.now();
      const t = turn.current;
      const s = stateRef.current;
      if ((s === "listening" || s === "hearing") && !mutedRef.current) {
        // The threshold follows the room's own noise, so a fan or traffic doesn't count as talking.
        const threshold = Math.max(0.015, t.noise * 2.5 + 0.008);
        if (rms > threshold) {
          if (!t.speechStart) t.speechStart = now;
          t.lastLoud = now;
          if (s === "listening" && now - t.speechStart > 120) setState("hearing");
        } else {
          if (s === "listening") t.noise = t.noise * 0.95 + rms * 0.05;
          if (t.speechStart && now - t.lastLoud > SILENCE_MS) {
            const spoke = t.lastLoud - t.speechStart;
            if (spoke >= MIN_SPEECH_MS) {
              handOver(t.lastLoud);
            } else {
              // A click or a cough: start listening again from scratch.
              stopRecording(false);
              startRecording();
              setState("listening");
            }
          }
        }
        if (stateRef.current === "hearing" && now - t.started > MAX_TURN_MS) {
          handOver(now);
        } else if (stateRef.current === "listening" && !t.speechStart && now - t.started > IDLE_RESTART_MS) {
          stopRecording(false);
          startRecording();
        }
      }
      frame.current = requestAnimationFrame(() => tick.current());
    };
  }, [handOver, startRecording, stopRecording]);

  /** Asks for the microphone. Returns a message to show if it can't be used. */
  const open = useCallback(async (): Promise<string | null> => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia || !window.speechSynthesis) {
      return "This browser can't record or speak. Use Microsoft Edge or Google Chrome.";
    }
    setState("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      media.current = { stream, context, analyser };
      told.current = new Set();
      setTiming(null);
      await voicesReady();
      frame.current = requestAnimationFrame(() => tick.current());
      return null;
    } catch {
      setState("off");
      return "The microphone isn't available. Allow it in the browser's address bar, then call again.";
    }
  }, []);

  /** Whether this piece of speech should try the human voice. */
  const humanOn = useCallback(() => voiceRef.current === "human" && chat.current !== null && human.off === null && Date.now() >= human.pausedUntil, []);

  /** The human voice failed: say why once, and stop asking it for as long as the reason lasts. */
  const humanFailed = useCallback(
    (e: unknown) => {
      if (!(e instanceof VoiceProblem)) return tell("The human-sounding voice couldn't play here, so the browser's voice is speaking.");
      if (e.status === 0) return tell("The human-sounding voice was slow to answer, so the browser's voice said that.");
      if (e.status === 401 || e.status === 403 || /terms|one-time OK|refused the key|No voice is set up/i.test(e.message)) {
        human.off = e.message;
        return tell(`${e.message} Until then the browser's voice speaks; reload this page after.`);
      }
      human.pausedUntil = Date.now() + LIMIT_PAUSE_MS;
      if (e.status === 429) return tell("The human-sounding voice is at Groq's free limit (about 10 replies a minute and 100 a day), so the browser's voice is speaking for now.");
      tell(`The human-sounding voice couldn't speak (${e.message}), so the browser's voice is, for a minute.`);
    },
    [tell],
  );

  /** The browser's own voice says `text`, a sentence at a time. */
  const sayInBrowser = useCallback(
    (s: Speech, text: string, started: () => void) =>
      new Promise<void>((resolve) => {
        const synth = window.speechSynthesis;
        if (!synth || s.cancelled) return resolve();
        s.finish = resolve;
        synth.cancel();
        const v = pickVoice(country);
        const parts = sentences(text);
        parts.forEach((part, i) => {
          const u = new SpeechSynthesisUtterance(part);
          if (v) {
            u.voice = v;
            u.lang = v.lang;
          }
          if (i === 0) u.onstart = started;
          u.onerror = () => resolve();
          if (i === parts.length - 1) u.onend = () => resolve();
          synth.speak(u);
        });
      }),
    [country],
  );

  /**
   * Says `text`. The human voice is asked for each piece while the one before it plays; if it can't start
   * within a few seconds, or fails part way, the browser's voice says the rest. A `filler` keeps the call
   * "thinking" and is only said from a clip that is already here, since fetching one would come too late.
   */
  const say = useCallback(
    async (text: string, { filler = false } = {}) => {
      const words = spoken(text);
      if (!words || !media.current) return;
      if (speech.current) stopSpeech(speech.current);
      const s: Speech = { cancelled: false, source: null, finish: null };
      speech.current = s;
      if (!filler) {
        stopRecording(false);
        setState("speaking");
      }
      const asked = performance.now();
      const started = (voiceName: string) => () => {
        if (filler || !youStopped.current) return;
        const now = performance.now();
        setTiming({ gapMs: Math.round(now - youStopped.current), voiceMs: Math.round(now - asked), voice: voiceName });
        youStopped.current = 0;
      };
      const browserName = () => pickVoice(country)?.name.replace(/ - English.*$/, "") ?? "the browser's voice";

      try {
        const context = media.current.context;
        // A browser may hold sound back until the page is clicked; the Call button was, so this lets it play.
        if (context.state === "suspended") await context.resume().catch(() => {});
        const where = { locationId, chatId: chat.current ?? "" };
        if (humanOn() && !(filler && !voiceCache.has(words))) {
          const parts = pieces(words);
          const decoded = (part: string) => fetchVoice(where, part).then((audio) => context.decodeAudioData(audio.slice(0)));
          // "Let me speak" while the first piece is on its way ends the wait at once.
          const stopped = new Promise<null>((resolve) => (s.finish = () => resolve(null)));
          let audio: AudioBuffer | null = null;
          try {
            audio = await Promise.race([within(decoded(parts[0]!), VOICE_WAIT_MS), stopped]);
          } catch (e) {
            if (!s.cancelled) humanFailed(e);
          }
          if (s.cancelled) return;
          if (audio) {
            for (let i = 0; i < parts.length && !s.cancelled; i++) {
              const next = i + 1 < parts.length ? decoded(parts[i + 1]!) : null;
              next?.catch(() => {}); // looked at below, once this piece has played
              if (i === 0) started("Orpheus")();
              await play(context, s, audio);
              if (!next || s.cancelled) break;
              try {
                audio = await next;
              } catch (e) {
                humanFailed(e);
                await sayInBrowser(s, parts.slice(i + 1).join(" "), () => {});
                break;
              }
            }
            return;
          }
        }
        // Fillers in the human voice only: the browser's saying "one moment" before a human reply would jar.
        if (filler && humanOn()) return;
        await sayInBrowser(s, words, started(browserName()));
      } finally {
        if (speech.current === s) speech.current = null;
      }
    },
    [country, humanFailed, humanOn, locationId, sayInBrowser, stopRecording],
  );

  /** The call is for this chat: the human voice speaks for it, and the fillers are fetched ahead. */
  const attach = useCallback(
    (chatId: string) => {
      chat.current = chatId;
      if (voiceRef.current !== "human" || human.off) return;
      // After the greeting has had its turn with the voice service, so it isn't slowed down.
      setTimeout(() => {
        for (const f of FILLERS) if (!voiceCache.has(f) && chat.current === chatId) fetchVoice({ locationId, chatId }, f).catch(() => {});
      }, 2_500);
    },
    [locationId],
  );

  /** Starts (or resumes) listening for the caller's next turn. */
  const listen = useCallback(() => {
    if (!media.current) return;
    youStopped.current = 0;
    startRecording();
    setState("listening");
  }, [startRecording]);

  /** The AI speaks a reply; resolves when it is done or interrupted. */
  const speak = useCallback((text: string) => say(text), [say]);

  /** A short "one moment" while a slow answer is on its way. */
  const holdOn = useCallback(() => say(FILLERS[fillerTurn.current++ % FILLERS.length]!, { filler: true }), [say]);

  /** Stops the AI mid-sentence. */
  const interrupt = useCallback(() => {
    if (speech.current) stopSpeech(speech.current);
  }, []);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  }, []);

  const close = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    stopRecording(false);
    interrupt();
    window.speechSynthesis?.cancel();
    media.current?.stream.getTracks().forEach((track) => track.stop());
    void media.current?.context.close();
    media.current = null;
    chat.current = null;
    youStopped.current = 0;
    mutedRef.current = false;
    setMuted(false);
    setLevel(0);
    setState("off");
  }, [interrupt, stopRecording]);

  useEffect(() => close, [close]);

  return { state, level, muted, timing, open, attach, listen, speak, holdOn, interrupt, toggleMute, close };
}
