import { Skeleton } from "@/components/ui/display";
import * as api from "@/server/api";
import { toTicket } from "@/server/tickets";
import { LiveBoard } from "./live-board";

/** Live orders data, shared by /live (S41) and the full-screen kitchen view. */
export async function LiveContent({ size }: { size?: "default" | "kitchen" }) {
  const [tickets, location, settings] = await Promise.all([api.getLiveTickets(), api.getLocation(), api.getSettings()]);
  return (
    <LiveBoard
      size={size}
      tickets={tickets.map((t) => toTicket(t, location.timezone))}
      orderingOff={location.orderingMode === "DISABLED" || !settings.orderingEnabled}
    />
  );
}

export function BoardSkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--ds-ticket-min),1fr))] gap-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-64 rounded-lg" />
      ))}
    </div>
  );
}
