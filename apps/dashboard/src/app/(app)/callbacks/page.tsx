import { PhoneCall } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterLinks, str } from "@/components/app/filters";
import { CardSkeleton, PageHeader } from "@/components/app/page";
import { Card, EmptyState } from "@/components/ui/display";
import { fmtDateTime, prettyPhone } from "@/lib/format";
import { can } from "@/lib/permissions";
import * as api from "@/server/api";
import { CallbackActions } from "./callback-actions";

export const metadata: Metadata = { title: "Callbacks" };

// S42: callback requests the AI took when nobody could pick up a transfer, or after hours.
export default function CallbacksPage({ searchParams }: PageProps<"/callbacks">) {
  return (
    <>
      <PageHeader title="Callbacks" description="People who asked to be called back, usually because nobody could take a transfer or it was after hours." />
      <Suspense fallback={<CardSkeleton rows={6} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/callbacks">["searchParams"] }) {
  const sp = await searchParams;
  const status = str(sp.status) === "DONE" ? "DONE" : str(sp.status) === "all" ? "all" : "OPEN";
  const [items, location, session] = await Promise.all([api.listCallbacks(status), api.getLocation(), api.getSessionInfo()]);
  const canHandle = can(session.role, "callbacks.handle");
  return (
    <div className="flex flex-col gap-4">
      <FilterLinks
        label="Callback status"
        options={[
          { href: "/callbacks", label: "To call back", active: status === "OPEN" },
          { href: "/callbacks?status=DONE", label: "Done", active: status === "DONE" },
          { href: "/callbacks?status=all", label: "All", active: status === "all" },
        ]}
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={PhoneCall} title={status === "OPEN" ? "Nobody's waiting for a call back" : "Nothing here yet"}>
            When a transfer isn&apos;t answered, or someone calls after hours, the AI offers to take a callback request. They land here.
          </EmptyState>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-base font-semibold text-fg">
                    {c.customerName}{" "}
                    {c.phone.startsWith("+") ? (
                      <a href={`tel:${c.phone}`} className="font-normal text-accent underline-offset-2 hover:underline">
                        {prettyPhone(c.phone)}
                      </a>
                    ) : (
                      <span className="font-normal text-muted">{c.phone}</span>
                    )}
                  </p>
                  {c.reason && <p className="text-sm text-fg">{c.reason}</p>}
                  <p className="text-xs text-muted">
                    Asked {fmtDateTime(c.createdAt, location.timezone)}
                    {c.preferredWindow ? ` · Best time: ${c.preferredWindow}` : ""}
                    {c.status === "DONE" && c.handledBy ? ` · Called back by ${c.handledBy}` : ""}
                    {c.status === "CANCELLED" ? " · Cancelled" : ""}
                  </p>
                  {c.callId && (
                    <Link href={`/calls?call=${c.callId}`} className="text-xs text-accent underline underline-offset-2">
                      Open the call
                    </Link>
                  )}
                </div>
                {canHandle && <CallbackActions id={c.id} status={c.status} name={c.customerName} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
