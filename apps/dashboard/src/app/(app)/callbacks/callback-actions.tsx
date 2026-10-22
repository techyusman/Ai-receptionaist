"use client";

import { updateCallback } from "@/app/actions/orders";
import { useAction } from "@/components/app/use-action";
import { Button } from "@/components/ui/button";

export function CallbackActions({ id, status, name }: { id: string; status: "OPEN" | "DONE" | "CANCELLED"; name: string }) {
  const act = useAction();
  if (status !== "OPEN") {
    return (
      <Button variant="ghost" size="sm" loading={act.pending} onClick={() => act.run(() => updateCallback(id, "OPEN"), { success: `${name} is back on the list` })}>
        Reopen
      </Button>
    );
  }
  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" loading={act.pending} onClick={() => act.run(() => updateCallback(id, "DONE"), { success: `Marked ${name} as called back` })}>
        Called back
      </Button>
      <Button variant="secondary" size="sm" disabled={act.pending} onClick={() => act.run(() => updateCallback(id, "CANCELLED"))}>
        Not needed
      </Button>
    </div>
  );
}
