"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { LiveEvent } from "@/data/types";

export const LIVE_EVENT = "receptionist:live";
const REOPEN_MS = 10_000;

/**
 * Re-renders the current page when the location's data changes, and rebroadcasts each event. If the
 * stream drops it reconnects (the browser does that itself, unless the stream was refused outright, in
 * which case this opens a new one), and catches up on whatever happened while it was away.
 */
export function LiveRefresher() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    let source: EventSource | undefined;
    let missed = false;
    const refreshSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    const open = () => {
      source = new EventSource("/api/live");
      source.onopen = () => {
        if (missed) refreshSoon();
        missed = false;
      };
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as LiveEvent;
          window.dispatchEvent(new CustomEvent<LiveEvent>(LIVE_EVENT, { detail: event }));
        } catch {}
        refreshSoon();
      };
      source.onerror = () => {
        missed = true;
        if (source?.readyState === EventSource.CLOSED) reopen = setTimeout(open, REOPEN_MS);
      };
    };
    open();
    return () => {
      source?.close();
      clearTimeout(timer);
      clearTimeout(reopen);
    };
  }, [router]);
  return null;
}
