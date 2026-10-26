"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A phone-like call in the browser: the microphone is always recording while it listens, a level meter
// notices when you start and stop talking, and each turn is handed over as one recording. The AI's replies
// are spoken with the browser's own voices. While the AI speaks, the microphone is ignored so it doesn't
// hear itself (no headphones needed).

export type CallState = "off" | "connecting" | "listening" | "hearing" | "thinking" | "speaking";

const SILENCE_MS = 900; // a pause this long ends your turn
const MIN_SPEECH_MS = 300; // shorter than this is a cough or a click
const MAX_TURN_MS = 30_000; // the server takes up to about 30 seconds a turn
const IDLE_RESTART_MS = 15_000; // a recording with no speech is thrown away and started again

/** The best English voice the browser has, preferring natural ones and the restaurant's region. */
function pickVoice(country: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const regions = country === "PK" ? ["en-PK", "en-IN", "en-GB", "en-US"] : ["en-US", "en-GB"];
  const natural = (v: SpeechSynthesisVoice) => /natural|online|google/i.test(v.name);
  for (const region of regions) {
    const inRegion = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === region.toLowerCase());
    const best = inRegion.find(natural) ?? inRegion[0];
    if (best) return best;
  }
  return voices.find((v) => v.lang.toLowerCase().startsWith("en") && natural(v)) ?? voices.find((v) => v.lang.toLowerCase().startsWith("en")) ?? null;
}

/** Long text is spoken a sentence at a time: some browsers stop a single long utterance part way. */
const sentences = (text: string) => text.match(/[^.!?]+[.!?]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];

export function useVoiceCall({ country, onTurn }: { country: string; onTurn: (audio: Blob) => void }) {
  const [state, setStateRaw] = useState<CallState>("off");
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const stateRef = useRef<CallState>("off");
  const mutedRef = useRef(false);
  const onTurnRef = useRef(onTurn);
  const media = useRef<{ stream: MediaStream; context: AudioContext; analyser: AnalyserNode } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const frame = useRef<number | null>(null);
  const turn = useRef({ started: 0, speechStart: 0, lastLoud: 0, noise: 0.01 });
  /** Ends the speech in progress (it finished, failed, or you interrupted it). */
  const doneSpeaking = useRef<(() => void) | null>(null);

  useEffect(() => {
    onTurnRef.current = onTurn;
  }, [onTurn]);

  const setState = (s: CallState) => {
    stateRef.current = s;
    setStateRaw(s);
  };

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
              setState("thinking");
              stopRecording(true);
            } else {
              // A click or a cough: start listening again from scratch.
              stopRecording(false);
              startRecording();
              setState("listening");
            }
          }
        }
        if (stateRef.current === "hearing" && now - t.started > MAX_TURN_MS) {
          setState("thinking");
          stopRecording(true);
        } else if (stateRef.current === "listening" && !t.speechStart && now - t.started > IDLE_RESTART_MS) {
          stopRecording(false);
          startRecording();
        }
      }
      frame.current = requestAnimationFrame(() => tick.current());
    };
  }, [startRecording, stopRecording]);

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
      window.speechSynthesis.getVoices(); // starts loading the voice list
      frame.current = requestAnimationFrame(() => tick.current());
      return null;
    } catch {
      setState("off");
      return "The microphone isn't available. Allow it in the browser's address bar, then call again.";
    }
  }, []);

  /** Starts (or resumes) listening for the caller's next turn. */
  const listen = useCallback(() => {
    if (!media.current) return;
    startRecording();
    setState("listening");
  }, [startRecording]);

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        const synth = window.speechSynthesis;
        if (!synth || !text.trim()) return resolve();
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          doneSpeaking.current = null;
          resolve();
        };
        doneSpeaking.current = finish;
        stopRecording(false);
        setState("speaking");
        synth.cancel();
        const voice = pickVoice(country);
        const parts = sentences(text);
        parts.forEach((part, i) => {
          const u = new SpeechSynthesisUtterance(part);
          if (voice) {
            u.voice = voice;
            u.lang = voice.lang;
          }
          u.rate = 1;
          u.onerror = finish;
          if (i === parts.length - 1) u.onend = finish;
          synth.speak(u);
        });
      }),
    [country, stopRecording],
  );

  /** Stops the AI mid-sentence and listens again. */
  const interrupt = useCallback(() => {
    window.speechSynthesis?.cancel();
    doneSpeaking.current?.();
  }, []);

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
  }, []);

  const close = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = null;
    stopRecording(false);
    window.speechSynthesis?.cancel();
    doneSpeaking.current?.();
    media.current?.stream.getTracks().forEach((track) => track.stop());
    void media.current?.context.close();
    media.current = null;
    mutedRef.current = false;
    setMuted(false);
    setLevel(0);
    setState("off");
  }, [stopRecording]);

  useEffect(() => close, [close]);

  return { state, level, muted, open, listen, speak, interrupt, toggleMute, close };
}
