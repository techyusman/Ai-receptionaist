import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { OrderSettings } from "./order-settings";

export const metadata: Metadata = { title: "Phone orders" };

// S19: whether the AI takes orders, where they go (the P0 sign-off), and pickup rules.
export default function OrdersSettingsPage() {
  return (
    <>
      <PageHeader title="Phone orders" description="Whether the AI takes pickup orders, where they go, and what it tells callers about pickup." />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const [settings, location] = await Promise.all([api.getSettings(), api.getLocation()]);
  return (
    <OrderSettings
      settings={settings}
      ordering={{ mode: location.orderingMode, feasibility: location.feasibility, note: location.feasibilityNote ?? "" }}
      canSignOff={can(session.role, "ordering.mode")}
    />
  );
}
