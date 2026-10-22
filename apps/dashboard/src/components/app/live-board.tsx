"use client";

import { BellRing, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { acceptOrder } from "@/app/actions/orders";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { TicketCard, type Ticket } from "@/components/ui/live";
import { useToast } from "@/components/ui/toast";

export type BoardTicket = Ticket & { state: "new" | "accepted" | "check-needed"; test: boolean };

/* Sound preference: per device, in localStorage (a convenience, not shared state). */
const SOUND_KEY = "live-sound";
const soundListeners = new Set<() => void>();
function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}
function writeSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {}
  soundListeners.forEach((l) => l());
}
function useSound() {
  return useSyncExternalStore(
    (cb) => {
      soundListeners.add(cb);
      return () => soundListeners.delete(cb);
    },
    readSound,
    () => false,
  );
}

let audio: AudioContext | null = null;
/** Two short tones, made with Web Audio rather than a sound file. */
function chime() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    for (const [freq, start] of [[880, 0], [1320, 0.18]] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + start);
      gain.gain.exponentialRampToValueAtTime(0.25, t + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + start + 0.16);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + start);
      osc.stop(t + start + 0.17);
    }
  } catch {}
}

export function SoundToggle() {
  const on = useSound();
  return (
    <Button
      variant="secondary"
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        writeSound(next);
        if (next) chime(); // the click is the user gesture browsers require before audio
      }}
    >
      {on ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
      {on ? "Sound on" : "Sound off"}
    </Button>
  );
}

export function LiveBoard({ tickets, orderingOff, size = "default" }: { tickets: BoardTicket[]; orderingOff: boolean; size?: "default" | "kitchen" }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const sound = useSound();
  const seen = useRef<Set<string> | null>(null);
  const announcer = useRef<HTMLParagraphElement>(null);

  // Announce (and chime for) tickets that arrived since the last render. The first render only
  // records what's already there.
  useEffect(() => {
    const ids = new Set(tickets.map((t) => t.id));
    if (seen.current) {
      const fresh = tickets.filter((t) => !seen.current!.has(t.id) && t.state === "new");
      if (fresh.length && announcer.current) {
        announcer.current.textContent = fresh
          .map((t) => `New ${t.test ? "test " : ""}order for ${t.customerName}, ${t.lines.length} ${t.lines.length === 1 ? "item" : "items"}.`)
          .join(" ");
      }
      if (sound && fresh.some((t) => !t.test)) chime();
    }
    seen.current = ids;
  }, [tickets, sound]);

  const waiting = tickets.filter((t) => t.state !== "accepted");
  const accepted = tickets.filter((t) => t.state === "accepted");

  const accept = (t: BoardTicket) => {
    setAcceptingId(t.id);
    start(async () => {
      const r = await acceptOrder(t.id);
      setAcceptingId(null);
      if (!r.ok) toast({ title: r.message, variant: "error" });
    });
  };

  const grid = "grid grid-cols-[repeat(auto-fill,minmax(var(--ds-ticket-min),1fr))] gap-4";

  return (
    <div className="flex flex-col gap-8">
      <p ref={announcer} aria-live="assertive" className="sr-only" />
      <section aria-labelledby="waiting-heading" className="flex flex-col gap-3">
        <h2 id="waiting-heading" className={size === "kitchen" ? "text-xl text-fg" : "text-lg text-fg"}>
          Waiting <span className="text-muted">({waiting.length})</span>
        </h2>
        {waiting.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border">
            {orderingOff ? (
              <EmptyState icon={BellRing} title="Phone ordering is off">
                The AI isn&apos;t taking orders, so nothing will arrive here until ordering is turned on.
              </EmptyState>
            ) : (
              <EmptyState icon={BellRing} title="All caught up">
                New phone orders ring here as soon as a caller confirms one.
              </EmptyState>
            )}
          </div>
        ) : (
          <ul className={grid}>
            {waiting.map((t) => (
              <li key={t.id}>
                <TicketCard ticket={t} state={t.state} test={t.test} onAccept={() => accept(t)} accepting={pending && acceptingId === t.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {accepted.length > 0 && (
        <section aria-labelledby="accepted-heading" className="flex flex-col gap-3">
          <h2 id="accepted-heading" className="text-lg text-fg">
            Accepted in the last 30 minutes <span className="text-muted">({accepted.length})</span>
          </h2>
          <ul className={grid}>
            {accepted.map((t) => (
              <li key={t.id}>
                <TicketCard ticket={t} state="accepted" test={t.test} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
