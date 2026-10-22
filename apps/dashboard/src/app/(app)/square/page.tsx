import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { SquareSettings } from "./square-settings";

export const metadata: Metadata = { title: "Square" };

// S29 (with S06 connect and S13 ordering setup): connection, location, menu sync and sign-off.
export default function SquarePage() {
  return (
    <>
      <PageHeader title="Square" description="The AI reads your menu, prices and sold-out items from Square." />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <SquareContent />
      </Suspense>
    </>
  );
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
