import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterLinks, hrefWith, str } from "@/components/app/filters";
import { CardSkeleton, PageHeader } from "@/components/app/page";
import { UrlDrawer } from "@/components/app/url-drawer";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, MobileDetail, StatusPill, Table, Td, Th, THead, Tr } from "@/components/ui/display";
import { fmtDay, fmtTime, formatMoney, itemsSummary, maskPhone } from "@/lib/format";
import { can } from "@/lib/permissions";
import * as api from "@/server/api";
import { OrderDetailPanel } from "./order-detail";

export const metadata: Metadata = { title: "Orders" };

const views = [
  { id: "open", label: "Open" },
  { id: "attention", label: "Needs attention" },
  { id: "accepted", label: "Accepted" },
  { id: "all", label: "All" },
] as const;
const ranges = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
] as const;

type View = (typeof views)[number]["id"];
type Range = (typeof ranges)[number]["id"];

// S11 order list, with S12 (order summary) as a drawer on ?order=.
export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <>
      <PageHeader title="Orders" description="Every phone order, from the moment the AI starts taking it to when the team accepts it." />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <OrdersContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OrdersContent({ searchParams }: { searchParams: PageProps<"/orders">["searchParams"] }) {
  const sp = await searchParams;
  const view: View = views.some((v) => v.id === str(sp.view)) ? (str(sp.view) as View) : "all";
  const range: Range = ranges.some((r) => r.id === str(sp.range)) ? (str(sp.range) as Range) : "7d";
  const cursor = str(sp.cursor) ?? null;
  const orderId = str(sp.order);
  const current = { view, range, cursor: cursor ?? undefined };
  const [page, counts, location, session] = await Promise.all([api.listOrders({ view, range, cursor }), api.countOrders(), api.getLocation(), api.getSessionInfo()]);
  const tz = location.timezone;
  const detail = orderId ? await api.getOrder(orderId) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <FilterLinks
          label="Order status"
          options={views.map((v) => ({ href: hrefWith("/orders", current, { view: v.id, cursor: undefined }), label: v.label, active: v.id === view, count: counts[v.id] }))}
        />
        <FilterLinks
          label="Date range"
          options={ranges.map((r) => ({ href: hrefWith("/orders", current, { range: r.id, cursor: undefined }), label: r.label, active: r.id === range }))}
        />
      </div>

      {page.items.length === 0 ? (
        <Card>
          <EmptyState icon={Receipt} title={view === "attention" ? "Nothing needs attention" : "No orders here"}>
            {view === "attention"
              ? "Orders that might not have reached the kitchen show up here."
              : "Phone orders appear as soon as the AI starts taking one. Try a wider date range, or place a test order."}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Table>
            <caption className="sr-only">Phone orders, newest first</caption>
            <THead>
              <tr>
                <Th>Customer</Th>
                <Th desktopOnly>Placed</Th>
                <Th desktopOnly>Items</Th>
                <Th desktopOnly className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <tbody>
              {page.items.map((o) => (
                <Tr key={o.id}>
                  <Td>
                    <Link href={hrefWith("/orders", current, { order: o.id })} scroll={false} className="font-semibold text-fg hover:underline">
                      {o.customer.name || "No name yet"}
                    </Link>
                    {o.isTest && <span className="ml-2 rounded-pill bg-surface-muted px-2 text-xs font-semibold text-muted">Test</span>}
                    <span className="block text-xs text-muted max-md:hidden">{maskPhone(o.customer.phone)}</span>
                    <MobileDetail>
                      {fmtDay(o.createdAt, tz)}, {fmtTime(o.createdAt, tz)} · {itemsSummary(o.lines)}
                      {o.totals ? ` · ${formatMoney(o.totals.totalMinor, o.currency)}` : ""}
                    </MobileDetail>
                  </Td>
                  <Td desktopOnly className="text-muted whitespace-nowrap">
                    {fmtDay(o.createdAt, tz)}, {fmtTime(o.createdAt, tz)}
                  </Td>
                  <Td desktopOnly className="max-w-80 truncate text-muted">{itemsSummary(o.lines)}</Td>
                  <Td desktopOnly className="text-right whitespace-nowrap">{o.totals ? formatMoney(o.totals.totalMinor, o.currency) : "–"}</Td>
                  <Td>
                    <StatusPill domain="order" value={o.status === "SUBMITTED_TO_POS" && o.posMode === "SQUARE" ? "SUBMITTED_TO_SQUARE" : o.status} size="sm" />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              {page.total} {page.total === 1 ? "order" : "orders"}
            </span>
            <div className="flex gap-2">
              {cursor && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefWith("/orders", current, { cursor: Number(cursor) - 25 > 0 ? String(Number(cursor) - 25) : undefined })}>Newer</Link>
                </Button>
              )}
              {page.nextCursor && (
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefWith("/orders", current, { cursor: page.nextCursor })}>Older</Link>
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      <UrlDrawer open={!!orderId} title={detail ? `Order for ${detail.customer.name || "caller"}` : "Order"} closeHref={hrefWith("/orders", current, {})}>
        {orderId && <OrderDetailPanel order={detail} timeZone={tz} canAccept={can(session.role, "orders.accept")} canManage={can(session.role, "orders.manage")} />}
      </UrlDrawer>
    </div>
  );
}
