"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { LiveEvent } from "@/data/types";

export const LIVE_EVENT = "receptionist:live";

/** Re-renders the current page when the location's data changes, and rebroadcasts each event. */
export function LiveRefresher() {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/live");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as LiveEvent;
        window.dispatchEvent(new CustomEvent<LiveEvent>(LIVE_EVENT, { detail: event }));
      } catch {}
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    return () => {
      source.close();
      clearTimeout(timer);
    };
  }, [router]);
  return null;
}
