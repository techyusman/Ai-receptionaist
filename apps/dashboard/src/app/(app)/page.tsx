import { ArrowRight, BellRing } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, StatTile, StatusPill } from "@/components/ui/display";
import { fmtTime, plural } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";

export const metadata: Metadata = { title: "Overview" };

// S02: today at a glance, setup progress, and what's waiting.
export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" description="Today at a glance, and anything that needs you." />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const [tasks, calls, orders, live, callbacks, location] = await Promise.all([
    api.getSetupTasks(),
    api.listCalls({ range: "today" }),
    api.listOrders({ view: "all", range: "today" }),
    api.getLiveTickets(),
    api.listCallbacks("OPEN"),
    api.getLocation(),
  ]);
  const tz = location.timezone;
  const done = tasks.filter((t) => t.done).length;
  // Orders that reached the restaurant, not drafts that were dropped or passed to staff.
  const realOrders = orders.items.filter((o) => !o.isTest && ["SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED", "RECEIVED_BY_RESTAURANT"].includes(o.status));
  const waiting = live.filter((t) => t.status !== "RECEIVED_BY_RESTAURANT" && !t.isTest).length;
  const transferred = calls.items.filter((c) => c.transferred).length;

  return (
    <div className="flex flex-col gap-6">
      {waiting > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-accent">
          <p className="flex items-center gap-2 text-base font-semibold text-fg">
            <BellRing aria-hidden className="size-5 text-accent" />
            {plural(waiting, "phone order")} waiting for the kitchen
          </p>
          <Button asChild>
            <Link href="/live">Open Live orders</Link>
          </Button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Calls today" value={String(calls.total)} />
        <StatTile label="Phone orders today" value={String(realOrders.length)} />
        <StatTile label="Passed to staff today" value={calls.total ? `${Math.round((transferred / calls.total) * 100)}%` : "–"} />
        <StatTile label="Waiting for a call back" value={String(callbacks.length)} />
      </div>

      {done < tasks.length && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg text-fg">Finish setting up</h2>
            <span className="text-sm text-muted">
              {done} of {tasks.length} done
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-pill bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={tasks.length} aria-valuenow={done} aria-label="Setup progress">
            <div className="h-full rounded-pill bg-accent" style={{ width: `${(done / tasks.length) * 100}%` }} />
          </div>
          <ul className="flex flex-col gap-1">
            {tasks
              .filter((t) => !t.done)
              .map((t) => (
                <li key={t.id}>
                  <Link href={t.href} className="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus">
                    <span className="text-sm text-fg">
                      <span className="font-semibold">{t.title}</span>
                      <span className="block text-xs text-muted">{t.detail}</span>
                    </span>
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
          </ul>
          <Link href="/setup" className="text-sm text-accent underline underline-offset-2">
            See every setup step
          </Link>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg text-fg">Latest calls</h2>
          <Link href="/calls?range=today" className="text-sm text-accent underline underline-offset-2">
            All of today&apos;s calls
          </Link>
        </div>
        {calls.items.length === 0 ? (
          <p className="text-sm text-muted">No calls yet today.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {calls.items.slice(0, 5).map((c) => (
              <li key={c.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <Link href={`/calls?range=today&call=${c.id}`} className="min-w-0 text-sm hover:underline">
                  <span className="font-semibold text-fg">{c.callerName ?? "Caller"}</span>
                  <span className="text-muted"> · {fmtTime(c.startedAt, tz)} · </span>
                  <span className="text-muted">{c.summary}</span>
                </Link>
                {c.outcome && <StatusPill domain="call" value={c.outcome} size="sm" className="self-start sm:self-auto" />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
