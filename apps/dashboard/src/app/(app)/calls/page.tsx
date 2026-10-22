import { Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterLinks, hrefWith, str } from "@/components/app/filters";
import { CardSkeleton, PageHeader } from "@/components/app/page";
import { UrlDrawer } from "@/components/app/url-drawer";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, MobileDetail, StatusPill, Table, Td, Th, THead, Tr } from "@/components/ui/display";
import { controlClass } from "@/components/ui/field";
import type { CallOutcome } from "@/data/types";
import { cn } from "@/lib/cn";
import { fmtDay, fmtDuration, fmtTime } from "@/lib/format";
import { statusVocabulary } from "@/lib/status";
import * as api from "@/server/api";
import { CallDetailPanel } from "./call-detail";

export const metadata: Metadata = { title: "Calls" };

const ranges = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
] as const;
type Range = (typeof ranges)[number]["id"];
const outcomes = Object.keys(statusVocabulary.call) as CallOutcome[];

// S14 call log, with S15 (call summary) as a drawer on ?call=.
export default function CallsPage({ searchParams }: PageProps<"/calls">) {
  return (
    <>
      <PageHeader title="Calls" description="Every call the AI handled, what the caller wanted, and how it ended." />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <CallsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function CallsContent({ searchParams }: { searchParams: PageProps<"/calls">["searchParams"] }) {
  const sp = await searchParams;
  const range: Range = ranges.some((r) => r.id === str(sp.range)) ? (str(sp.range) as Range) : "7d";
  const outcome = outcomes.includes(str(sp.outcome) as CallOutcome) ? (str(sp.outcome) as CallOutcome) : undefined;
  const transferred = str(sp.transferred) === "1";
  const q = str(sp.q)?.slice(0, 100);
  const cursor = str(sp.cursor) ?? null;
  const callId = str(sp.call);
  const current = { range, outcome, transferred: transferred ? "1" : undefined, q, cursor: cursor ?? undefined };
  const [page, location, detail] = await Promise.all([
    api.listCalls({ range, outcome, transferred, q, cursor }),
    api.getLocation(),
    callId ? api.getCall(callId) : Promise.resolve(null),
  ]);
  const tz = location.timezone;
  const filtered = !!(outcome || transferred || q);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <FilterLinks
          label="Date range"
          options={ranges.map((r) => ({ href: hrefWith("/calls", current, { range: r.id, cursor: undefined }), label: r.label, active: r.id === range }))}
        />
        <form action="/calls" className="flex flex-wrap items-end gap-2" role="search">
          <input type="hidden" name="range" value={range} />
          <label className="flex flex-col gap-1 text-sm font-semibold text-fg">
            Outcome
            <select name="outcome" defaultValue={outcome ?? ""} className={cn(controlClass, "h-10 w-44")}>
              <option value="">Any outcome</option>
              {outcomes.map((o) => (
                <option key={o} value={o}>
                  {statusVocabulary.call[o].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-fg">
            Search
            <input name="q" defaultValue={q} placeholder="Name, number or words" className={cn(controlClass, "h-10 w-52")} />
          </label>
          <label className="flex h-10 items-center gap-2 text-sm text-fg">
            <input type="checkbox" name="transferred" value="1" defaultChecked={transferred} className="size-4 accent-accent" />
            Transferred only
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered && (
            <Button asChild variant="ghost">
              <Link href={hrefWith("/calls", { range }, {})}>Clear</Link>
            </Button>
          )}
        </form>
      </div>

      {page.items.length === 0 ? (
        <Card>
          <EmptyState icon={Phone} title={filtered ? "No calls match" : "No calls yet"}>
            {filtered ? "Try a different outcome or search, or clear the filters." : "Calls show up here after the AI answers them. Call your AI number to try it."}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Table>
            <caption className="sr-only">Calls, newest first</caption>
            <THead>
              <tr>
                <Th>Caller</Th>
                <Th desktopOnly>When</Th>
                <Th desktopOnly>What happened</Th>
                <Th desktopOnly className="text-right">Length</Th>
                <Th>Outcome</Th>
              </tr>
            </THead>
            <tbody>
              {page.items.map((c) => (
                <Tr key={c.id}>
                  <Td>
                    <Link href={hrefWith("/calls", current, { call: c.id })} scroll={false} className="font-semibold text-fg hover:underline">
                      {c.callerName ?? (c.callerPhone ? `Caller ${c.callerPhone.slice(-4)}` : "Unknown caller")}
                    </Link>
                    {c.isTest && <span className="ml-2 rounded-pill bg-surface-muted px-2 text-xs font-semibold text-muted">Test</span>}
                    <MobileDetail>
                      {fmtDay(c.startedAt, tz)}, {fmtTime(c.startedAt, tz)} · {fmtDuration(c.durationSeconds)}
                      {c.summary ? ` · ${c.summary}` : ""}
                    </MobileDetail>
                  </Td>
                  <Td desktopOnly className="text-muted whitespace-nowrap">
                    {fmtDay(c.startedAt, tz)}, {fmtTime(c.startedAt, tz)}
                  </Td>
                  <Td desktopOnly className="max-w-110 truncate text-muted" title={c.summary ?? undefined}>
                    {c.summary ?? "–"}
                  </Td>
                  <Td desktopOnly className="text-right whitespace-nowrap text-muted">{fmtDuration(c.durationSeconds)}</Td>
                  <Td>{c.outcome ? <StatusPill domain="call" value={c.outcome} size="sm" /> : <span className="text-xs text-muted">In progress</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>{page.total} {page.total === 1 ? "call" : "calls"}</span>
            <div className="flex gap-2">
              {cursor && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefWith("/calls", current, { cursor: Number(cursor) - 25 > 0 ? String(Number(cursor) - 25) : undefined })}>Newer</Link>
                </Button>
              )}
              {page.nextCursor && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefWith("/calls", current, { cursor: page.nextCursor })}>Older</Link>
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      <UrlDrawer open={!!callId} title={detail ? `Call from ${detail.callerName ?? "a caller"}` : "Call"} closeHref={hrefWith("/calls", current, {})}>
        {callId && <CallDetailPanel call={detail} timeZone={tz} />}
      </UrlDrawer>
    </div>
  );
}
