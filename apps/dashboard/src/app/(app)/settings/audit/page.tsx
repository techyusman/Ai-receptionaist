import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { str } from "@/components/app/filters";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, MobileDetail, Table, Td, Th, THead, Tr } from "@/components/ui/display";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";

export const metadata: Metadata = { title: "Audit log" };

// S44: every change to settings, the team, Square and orders, newest first. Read-only.
export default function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  return (
    <>
      <PageHeader title="Audit log" description="Every change to settings, the team, Square and orders, and who made it. Entries can't be edited or deleted." />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/settings/audit">["searchParams"] }) {
  const session = await requireSession();
  if (!can(session.role, "audit.view")) return <NoAccess who="owners" />;
  const cursor = str((await searchParams).cursor) ?? null;
  const [page, location] = await Promise.all([api.getAudit(cursor), api.getLocation()]);
  if (page.items.length === 0) {
    return (
      <Card>
        <EmptyState icon={ScrollText} title="Nothing changed yet">
          Changes show here as soon as anyone edits a setting.
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Table>
        <caption className="sr-only">Audit log, newest first</caption>
        <THead>
          <tr>
            <Th>What changed</Th>
            <Th desktopOnly>Who</Th>
            <Th desktopOnly>When</Th>
          </tr>
        </THead>
        <tbody>
          {page.items.map((a) => (
            <Tr key={a.id}>
              <Td>
                <span className="text-fg">{a.summary}</span>
                <span className="block font-mono text-xs text-muted">{a.action}</span>
                <MobileDetail>
                  {a.actorName} · {fmtDateTime(a.at, location.timezone)}
                </MobileDetail>
              </Td>
              <Td desktopOnly className="whitespace-nowrap">
                {a.actorName}
                {a.actorType !== "USER" && <span className="text-muted"> ({a.actorType.toLowerCase()})</span>}
              </Td>
              <Td desktopOnly className="whitespace-nowrap text-muted">{fmtDateTime(a.at, location.timezone)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{page.total} entries</span>
        <div className="flex gap-2">
          {cursor && (
            <Button asChild variant="secondary" size="sm">
              <Link href={Number(cursor) - 25 > 0 ? `/settings/audit?cursor=${Number(cursor) - 25}` : "/settings/audit"}>Newer</Link>
            </Button>
          )}
          {page.nextCursor && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/settings/audit?cursor=${page.nextCursor}`}>Older</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
