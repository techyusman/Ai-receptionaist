import type { Metadata } from "next";
import { Suspense } from "react";
import { str } from "@/components/app/filters";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { Banner } from "@/components/ui/display";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { SquareSettings } from "./square-settings";

export const metadata: Metadata = { title: "Square" };

// S29 (with S06 connect and S13 ordering setup): connection, location, menu sync and sign-off.
// What Square's sign-in sent the owner back with (the API puts it on the redirect).
const RETURN_MESSAGES: Record<string, { tone: "success" | "danger" | "warning"; title: string; body?: string }> = {
  connected: { tone: "success", title: "Square is connected. Now pick the location the AI should use." },
  denied: { tone: "warning", title: "Square wasn't connected", body: "Access was declined on Square's page. Try again when you're ready." },
  expired: { tone: "warning", title: "That sign-in link expired", body: "Press Connect Square again to start over." },
  claimed: { tone: "danger", title: "That Square location is already linked to another restaurant", body: "Each Square location can belong to one restaurant here." },
  failed: { tone: "danger", title: "Square didn't finish connecting", body: "Nothing was saved. Try again in a minute." },
  state: { tone: "danger", title: "Square didn't finish connecting", body: "Nothing was saved. Try again in a minute." },
};

export default function SquarePage({ searchParams }: PageProps<"/square">) {
  return (
    <>
      <PageHeader title="Square" description="The AI reads your menu, prices and sold-out items from Square." />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <ReturnBanner searchParams={searchParams} />
        <SquareContent />
      </Suspense>
    </>
  );
}

async function ReturnBanner({ searchParams }: { searchParams: PageProps<"/square">["searchParams"] }) {
  const q = await searchParams;
  const key = str(q.connected) === "1" ? "connected" : str(q.error);
  const m = key ? RETURN_MESSAGES[key] : undefined;
  return m ? (
    <Banner tone={m.tone} title={m.title} className="mb-4">
      {m.body}
    </Banner>
  ) : null;
}

async function SquareContent() {
  const session = await requireSession();
  if (!can(session.role, "square.connect")) return <NoAccess />;
  const [integration, menu, location] = await Promise.all([api.getIntegration(), api.getMenuStatus(), api.getLocation()]);
  const locations = integration.status === "CONNECTED" && !integration.posLocationId ? await api.getSquareLocations() : [];
  return (
    <SquareSettings
      integration={integration}
      menu={menu}
      squareLocations={locations}
      location={{ orderingMode: location.orderingMode, feasibility: location.feasibility, note: location.feasibilityNote, signedOffBy: location.feasibilitySignedOffBy, signedOffAt: location.feasibilitySignedOffAt ? fmtDateTime(location.feasibilitySignedOffAt, location.timezone) : null }}
      canDisconnect={can(session.role, "square.disconnect")}
    />
  );
}
