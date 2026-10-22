import { describeDay } from "@receptionist/domain";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { Card } from "@/components/ui/display";
import { fmtDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { HoursEditor, LocationDetails, SpecialDays } from "./location-forms";

export const metadata: Metadata = { title: "Hours and location" };

// S28: address and directions, weekly hours (store and ordering), and special days.
export default function LocationPage() {
  return (
    <>
      <PageHeader title="Hours and location" description="The AI answers “are you open?” and “where are you?” from here, and only takes orders during ordering hours." />
      <Suspense fallback={<CardSkeleton rows={10} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const [location, hours, specials, open] = await Promise.all([api.getLocation(), api.getHours(), api.getSpecialHours(), api.getOpenState()]);
  const today = describeDay(open.today, hours.store, specials);
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-wrap items-center gap-3">
        <span className={`rounded-pill px-2.5 py-0.5 text-sm font-semibold ${open.storeOpen ? "bg-success-subtle text-success" : "bg-surface-muted text-muted"}`}>
          {open.storeOpen ? "Open now" : "Closed now"}
        </span>
        <span className="text-sm text-fg">
          Today ({fmtDate(open.today)}): {today}
        </span>
        <span className="text-sm text-muted">{open.orderingOpen ? "Taking phone orders" : "Not taking phone orders right now"}</span>
      </Card>
      <LocationDetails location={location} zones={Intl.supportedValuesOf("timeZone")} />
      <HoursEditor hours={hours} />
      <SpecialDays specials={specials.map((s) => ({ ...s, label: fmtDate(s.date) }))} />
    </div>
  );
}
