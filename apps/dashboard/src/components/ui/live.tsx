"use client";

import { Printer, RefreshCw, TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "./button";
import { StatusPill } from "./display";
import { Tooltip } from "./overlays";

/* A shared 15-second clock. The server snapshot is null, so relative times render only in the
   browser: no hydration mismatch and no Date.now() during prerendering. */
let ticks = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function subscribe(cb: () => void) {
  listeners.add(cb);
  timer ??= setInterval(() => {
    ticks++;
    listeners.forEach((l) => l());
  }, 15_000);
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
let lastTick = -1;
let lastNow = 0;
function getNow() {
  if (lastTick !== ticks) {
    lastTick = ticks;
    lastNow = Date.now();
  }
  return lastNow;
}
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getNow, () => null);
}

export function minutesAgo(iso: string, now: number | null) {
  if (now === null) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export function relative(mins: number | null) {
  if (mins === null) return "…";
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} h ago`;
}

/* SyncIndicator ----------------------------------------------------------- */

export function SyncIndicator({
  state,
  updatedAt,
  error,
  onResync,
}: {
  state: "fresh" | "running" | "stale" | "failed";
  updatedAt?: string;
  error?: string;
  onResync?: () => void;
}) {
  const now = useNow();
  const ago = updatedAt ? relative(minutesAgo(updatedAt, now)) : "never";
  return (
    <div className="inline-flex items-center gap-2">
      <StatusPill domain="sync" value={state} size="sm" />
      <Tooltip content={error ?? (updatedAt ? new Date(updatedAt).toUTCString() : "Never synced")}>
        <span tabIndex={0} className="text-xs text-muted">
          Updated {ago}
        </span>
      </Tooltip>
      {onResync && (
        <Tooltip content="Sync the menu from Square now">
          <IconButton label="Sync the menu from Square now" size="sm" onClick={onResync} disabled={state === "running"}>
            <RefreshCw aria-hidden className={cn(state === "running" && "animate-spin motion-reduce:animate-none")} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}

/* TicketCard (S41 live orders) --------------------------------------------- */

export type Ticket = {
  id: string;
  customerName: string;
  phoneLast4: string;
  pickup: string; // "ASAP" or a local time label
  createdAt: string;
  total: string;
  lines: { qty: number; name: string; modifiers?: string[]; note?: string }[];
};

/** Prints only this ticket (see the print rules in globals.css). */
function printTicket(el: HTMLElement | null) {
  if (!el) return;
  el.setAttribute("data-printing", "");
  window.print();
  el.removeAttribute("data-printing");
}

export function TicketCard({
  ticket,
  state = "new",
  test = false,
  onAccept,
  accepting = false,
}: {
  ticket: Ticket;
  state?: "new" | "accepted" | "check-needed";
  test?: boolean;
  onAccept?: () => void;
  accepting?: boolean;
}) {
  const now = useNow();
  const mins = minutesAgo(ticket.createdAt, now);
  const late = !test && mins !== null && mins >= 5 && state === "new";
  return (
    <article
      aria-label={`Order for ${ticket.customerName}`}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-surface p-4",
        state === "new" && "border-accent",
        state === "accepted" && "border-border opacity-80",
        state === "check-needed" && "border-warning",
        test && "border-dashed",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-lg text-fg">{ticket.customerName}</h3>
          <span className="text-xs text-muted">
            ···{ticket.phoneLast4} · Pickup {ticket.pickup}
          </span>
        </div>
        <span className={cn("text-xs font-semibold", late ? "text-warning" : "text-muted")}>{relative(mins)}</span>
      </header>

      {state === "check-needed" && (
        <p className="flex items-start gap-2 rounded-md bg-warning-subtle p-2 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          We&apos;re not sure this reached Square. Confirm before cooking.
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {ticket.lines.map((l, i) => (
          <li key={i} className="text-base text-fg">
            <span className="font-semibold">{l.qty} ×</span> {l.name}
            {l.modifiers?.map((m) => (
              <span key={m} className="block pl-6 text-sm text-muted">
                {m}
              </span>
            ))}
            {l.note && <span className="block pl-6 text-sm text-muted italic">“{l.note}”</span>}
          </li>
        ))}
      </ul>

      <footer className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-fg">{ticket.total}</span>
          {test ? (
            <span className="rounded-pill bg-surface-muted px-2 text-xs font-semibold text-muted">Test call</span>
          ) : (
            <StatusPill
              domain="order"
              value={
                state === "accepted" ? "RECEIVED_BY_RESTAURANT" : state === "check-needed" ? "SUBMISSION_UNKNOWN" : "SUBMITTED_TO_POS"
              }
              size="sm"
            />
          )}
        </div>
        <div className="flex items-center gap-1">
          <IconButton label={`Print ticket for ${ticket.customerName}`} size="lg" onClick={(e) => printTicket(e.currentTarget.closest("article"))}>
            <Printer aria-hidden />
          </IconButton>
          {state !== "accepted" && onAccept && (
            <Button size="lg" onClick={onAccept} loading={accepting} aria-label={`Accept order for ${ticket.customerName}`}>
              Accept
            </Button>
          )}
        </div>
      </footer>
    </article>
  );
}
