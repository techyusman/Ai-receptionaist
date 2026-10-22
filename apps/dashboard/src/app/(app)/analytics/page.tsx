import type { Metadata } from "next";
import { Suspense } from "react";
import { BarList } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { LineChart } from "@/components/charts/line-chart";
import { FilterLinks, str } from "@/components/app/filters";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { StatTile } from "@/components/ui/display";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/permissions";
import { statusVocabulary } from "@/lib/status";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";

export const metadata: Metadata = { title: "Analytics" };

// S27: how the AI is doing. One filter row scopes every number and chart below it.
export default function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  return (
    <>
      <PageHeader title="Analytics" description="How many calls the AI handled, how many became orders, and how often it needed a person. Test calls aren't counted." />
      <Suspense fallback={<CardSkeleton rows={10} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function delta(cur: number, prev: number, upIsGood: boolean, unit = "") {
  if (prev === 0) return undefined; // no baseline: a comparison would mean nothing
  const diff = cur - prev;
  const text = unit
    ? `${diff >= 0 ? "+" : ""}${Math.round(diff * 10) / 10}${unit} vs previous period`
    : `${diff >= 0 ? "+" : ""}${Math.round((diff / prev) * 100)}% vs previous period`;
  return { text, direction: diff >= 0 ? ("up" as const) : ("down" as const), good: diff === 0 ? true : (diff > 0) === upIsGood };
}

const dayLabel = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
};

async function Content({ searchParams }: { searchParams: PageProps<"/analytics">["searchParams"] }) {
  const session = await requireSession();
  if (!can(session.role, "analytics.view")) return <NoAccess />;
  const range = str((await searchParams).range) === "30d" ? "30d" : "7d";
  const [a, location] = await Promise.all([api.getAnalytics(range), api.getLocation()]);
  const labels = a.byDay.map((d) => dayLabel(d.date));
  const outcomeRows = a.outcomes.map((o) => ({ label: statusVocabulary.call[o.outcome].label, value: o.count }));
  const avg = `${Math.floor(a.avgCallSeconds / 60)}m ${String(a.avgCallSeconds % 60).padStart(2, "0")}s`;

  return (
    <div className="flex flex-col gap-6">
      <FilterLinks
        label="Date range"
        options={[
          { href: "/analytics", label: "Last 7 days", active: range === "7d" },
          { href: "/analytics?range=30d", label: "Last 30 days", active: range === "30d" },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="Calls answered" value={a.calls.toLocaleString("en-US")} delta={delta(a.calls, a.callsPrev, true)} />
        <StatTile label="Phone orders" value={a.orders.toLocaleString("en-US")} delta={delta(a.orders, a.ordersPrev, true)} />
        <StatTile label="Order value" value={formatMoney(a.orderValueMinor, location.currency)} />
        <StatTile label="Calls that became orders" value={`${a.conversionPct}%`} />
        <StatTile label="Passed to staff" value={`${a.transferredPct}%`} delta={delta(a.transferredPct, a.transferredPctPrev, false, " pts")} />
        <StatTile label="Average call" value={avg} />
      </div>

      <ChartCard
        title="Calls and phone orders per day"
        description={`${a.minutes.toLocaleString("en-US")} minutes on the phone in this period.`}
        table={{ columns: ["Day", "Calls", "Phone orders"], rows: a.byDay.map((d, i) => [labels[i]!, d.calls, d.orders]) }}
      >
        <LineChart
          ariaLabel="Calls and phone orders per day"
          labels={labels}
          series={[
            { key: "calls", label: "Calls", slot: 1, values: a.byDay.map((d) => d.calls) },
            { key: "orders", label: "Orders", slot: 2, values: a.byDay.map((d) => d.orders) },
          ]}
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="How calls ended" table={{ columns: ["Outcome", "Calls"], rows: outcomeRows.map((r) => [r.label, r.value]) }}>
          <BarList rows={outcomeRows} unit="calls" />
        </ChartCard>
        <ChartCard title="Most-ordered items" description="By quantity, accepted orders only." table={{ columns: ["Item", "Quantity"], rows: a.topItems.map((r) => [r.name, r.count]) }}>
          <BarList rows={a.topItems.map((r) => ({ label: r.name, value: r.count }))} unit="ordered" />
        </ChartCard>
      </div>
    </div>
  );
}
