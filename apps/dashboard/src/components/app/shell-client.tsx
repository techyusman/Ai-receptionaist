"use client";

import { Bell, Check, ChevronsUpDown, CircleQuestionMark, Menu as MenuIcon, X } from "lucide-react";
import Link from "next/link";
import { Dialog as RDialog } from "radix-ui";
import { useState, useTransition } from "react";
import { signOut, switchLocation } from "@/app/actions/auth";
import { acknowledgeAlert } from "@/app/actions/orders";
import { IconButton } from "@/components/ui/button";
import { Dialog, DropdownMenu, Popover } from "@/components/ui/overlays";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useToast } from "@/components/ui/toast";
import type { Alert, LocationSummary, SetupTask } from "@/data/types";
import { cn, focusRing } from "@/lib/cn";
import type { NavGroup } from "./nav";
import { NavList } from "./nav-list";

/* Mobile navigation (below lg the sidebar becomes a drawer) ----------------------- */

export function MobileNav({ groups, restaurant }: { groups: NavGroup[]; restaurant: string }) {
  const [open, setOpen] = useState(false);
  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Trigger asChild>
        <IconButton label="Open navigation" className="lg:hidden">
          <MenuIcon aria-hidden />
        </IconButton>
      </RDialog.Trigger>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-(--ds-shadow-overlay)" />
        <RDialog.Content className={cn("fixed inset-y-0 left-0 z-50 flex w-(--ds-sidebar) flex-col gap-4 overflow-y-auto bg-surface p-3 shadow-pop", focusRing)}>
          <div className="flex items-center justify-between px-2">
            <RDialog.Title className="text-base font-semibold text-fg">{restaurant}</RDialog.Title>
            <RDialog.Description className="sr-only">Main navigation</RDialog.Description>
            <RDialog.Close asChild>
              <IconButton label="Close navigation" size="sm">
                <X aria-hidden />
              </IconButton>
            </RDialog.Close>
          </div>
          <NavList groups={groups} onNavigate={() => setOpen(false)} />
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* Location switcher (S10) ----------------------------------------------------------- */

export function LocationSwitcher({ current, locations }: { current: LocationSummary; locations: LocationSummary[] }) {
  if (locations.length < 2) {
    return <p className="truncate text-sm text-muted">{current.name}</p>;
  }
  return (
    <DropdownMenu
      trigger={
        <button type="button" className={cn("flex items-center gap-1 rounded-sm text-sm text-muted hover:text-fg", focusRing)}>
          {current.name}
          <ChevronsUpDown aria-hidden className="size-3.5" />
          <span className="sr-only">(switch location)</span>
        </button>
      }
      items={locations.map((l) => ({ label: l.id === current.id ? `${l.name} (current)` : l.name, onSelect: () => void switchLocation(l.id) }))}
    />
  );
}

/* Alerts and setup bell (S03) --------------------------------------------------------- */

export function AlertsBell({ alerts, tasks }: { alerts: Alert[]; tasks: SetupTask[] }) {
  const pendingTasks = tasks.filter((t) => !t.done);
  const count = alerts.length + pendingTasks.length;
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Popover
      title="Alerts and setup"
      trigger={
        <button
          type="button"
          aria-label={count ? `Alerts and setup, ${count} need attention` : "Alerts and setup, nothing waiting"}
          className={cn("relative grid size-10 place-items-center rounded-md text-fg hover:bg-surface-muted", focusRing)}
        >
          <Bell aria-hidden className="size-4" />
          {count > 0 && (
            <span aria-hidden className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-pill bg-danger px-1 text-xs text-on-danger">
              {count}
            </span>
          )}
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-fg">Alerts</h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">Nothing needs attention.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-2 rounded-md bg-surface-muted p-2">
                  <p className="flex-1 text-sm text-fg">{a.message}</p>
                  <IconButton
                    label="Mark as seen"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await acknowledgeAlert(a.id);
                        if (!r.ok) toast({ title: r.message, variant: "error" });
                      })
                    }
                  >
                    <Check aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </section>
        {pendingTasks.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-fg">Finish setting up</h2>
            <ul className="flex flex-col gap-1">
              {pendingTasks.map((t) => (
                <li key={t.id}>
                  <Link href={t.href} className={cn("block rounded-md p-2 text-sm text-fg hover:bg-surface-muted", focusRing)}>
                    {t.title}
                    <span className="block text-xs text-muted">{t.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Popover>
  );
}

/* Help (S31) --------------------------------------------------------------------- */

export function HelpButton() {
  return (
    <Dialog
      trigger={
        <IconButton label="Help">
          <CircleQuestionMark aria-hidden />
        </IconButton>
      }
      title="Get help"
      description="We read every message during restaurant hours."
      size="sm"
    >
      <ul className="flex flex-col gap-2 text-sm text-fg">
        <li>
          Email{" "}
          <a className="text-accent underline underline-offset-2" href="mailto:support@receptionist.example">
            support@receptionist.example
          </a>{" "}
          with your restaurant name and the time of the call.
        </li>
        <li>For a call that went wrong, open it under Calls and copy the link into your email.</li>
      </ul>
    </Dialog>
  );
}

/* User menu --------------------------------------------------------------------- */

export function UserMenu({ name, role }: { name: string; role: string }) {
  return (
    <div className="flex items-center gap-1">
      <ThemeToggle />
      <DropdownMenu
        trigger={
          <button type="button" className={cn("flex h-10 items-center gap-2 rounded-md px-2 text-sm hover:bg-surface-muted", focusRing)}>
            <span aria-hidden className="grid size-7 place-items-center rounded-pill bg-accent-subtle text-xs font-semibold text-accent">
              {name
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span className="hidden flex-col items-start leading-tight md:flex">
              <span className="font-semibold text-fg">{name}</span>
              <span className="text-xs text-muted">{role}</span>
            </span>
            <span className="sr-only md:hidden">{`${name}, ${role}. Account menu`}</span>
          </button>
        }
        items={[{ label: "Sign out", onSelect: () => void signOut() }]}
      />
    </div>
  );
}
