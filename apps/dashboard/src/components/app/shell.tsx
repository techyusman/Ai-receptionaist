import Link from "next/link";
import { Skeleton } from "@/components/ui/display";
import { Banner } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { navFor } from "./nav";
import { NavList } from "./nav-list";
import { AlertsBell, HelpButton, LocationSwitcher, MobileNav, UserMenu } from "./shell-client";

async function navData() {
  const session = await requireSession();
  const [live, callbacks] = await Promise.all([api.getLiveTickets(), api.listCallbacks("OPEN")]);
  const waiting = live.filter((o) => o.status !== "RECEIVED_BY_RESTAURANT" && !o.isTest).length;
  return { session, groups: navFor(session.role, { live: waiting, callbacks: callbacks.length }) };
}

/** Desktop sidebar (S10). */
export async function Sidebar() {
  const { session, groups } = await navData();
  return (
    <div className="flex h-full flex-col gap-6 p-3">
      <div className="flex flex-col gap-0.5 px-3 pt-2">
        <Link href={can(session.role, "settings.edit") ? "/" : "/live"} className="truncate text-base font-semibold text-fg">
          {session.restaurant.name}
        </Link>
        <LocationSwitcher current={session.location} locations={session.locations} />
      </div>
      <NavList groups={groups} />
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-6" aria-busy="true">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/** Top bar: mobile nav, alerts bell (S03), help (S31), theme and account. */
export async function AppHeader() {
  const { session, groups } = await navData();
  const [alerts, tasks] = await Promise.all([
    api.listAlerts(),
    can(session.role, "settings.edit") ? api.getSetupTasks() : Promise.resolve([]),
  ]);
  return (
    <div className="sticky top-0 z-30 flex h-(--ds-header) items-center gap-2 border-b border-border bg-surface px-3 md:px-6">
      <MobileNav groups={groups} restaurant={session.restaurant.name} />
      <p className="truncate text-sm font-semibold text-fg lg:hidden">{session.restaurant.name}</p>
      <div className="ml-auto flex items-center gap-1">
        <AlertsBell alerts={alerts} tasks={tasks} />
        <HelpButton />
        <UserMenu name={session.user.name} role={roleLabel[session.role]} />
      </div>
    </div>
  );
}

export function HeaderSkeleton() {
  return (
    <div className="flex h-(--ds-header) items-center justify-end gap-2 border-b border-border bg-surface px-6" aria-busy="true">
      <Skeleton className="size-8" />
      <Skeleton className="size-8" />
      <Skeleton className="h-8 w-32" />
    </div>
  );
}

/** Location-wide warnings under the header (S10 global banner slot). */
export async function GlobalBanners() {
  const session = await requireSession();
  const [location, integration, menu] = await Promise.all([api.getLocation(), api.getIntegration(), api.getMenuStatus()]);
  const canFix = can(session.role, "square.connect");
  const banners: React.ReactNode[] = [];
  if (integration.status === "NEEDS_REAUTH" || integration.status === "REVOKED") {
    banners.push(
      <Banner key="sq" tone="danger" critical title="Square disconnected" action={canFix ? <Button asChild size="sm" variant="secondary"><Link href="/square">Reconnect</Link></Button> : undefined}>
        Phone orders are paused until Square is reconnected.
      </Banner>,
    );
  }
  if (menu.state === "stale" || menu.state === "failed") {
    banners.push(
      <Banner key="menu" tone="warning" title={menu.state === "failed" ? "Menu sync failed" : "Menu out of date"} action={canFix ? <Button asChild size="sm" variant="secondary"><Link href="/menu">Check menu</Link></Button> : undefined}>
        The AI won&apos;t take orders until the menu syncs from Square again.
      </Banner>,
    );
  }
  if (location.orderingMode === "DASHBOARD_TICKET") {
    banners.push(
      <Banner key="mode" tone="info" title="Phone orders go to Live orders">
        Square ordering stays off until the Square test is signed off. Staff accept each order on the Live orders screen.
      </Banner>,
    );
  } else if (location.orderingMode === "DISABLED") {
    banners.push(
      <Banner key="off" tone="info" title="Phone ordering is off">
        The AI answers questions but doesn&apos;t take orders yet.
      </Banner>,
    );
  }
  if (banners.length === 0) return null;
  return <div className="mx-auto flex w-full max-w-(--ds-content-max) flex-col gap-2 px-4 pt-4 md:px-6">{banners}</div>;
}
