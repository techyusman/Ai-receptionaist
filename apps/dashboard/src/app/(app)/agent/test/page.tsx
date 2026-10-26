import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { TestAgent } from "./test-agent";

export const metadata: Metadata = { title: "Test your agent" };

// S22. Two ways to test: call the AI number, or walk an order through the AI's own steps here.
export default function TestAgentPage({ searchParams }: PageProps<"/agent/test">) {
  return (
    <>
      <PageHeader
        title="Test your agent"
        description="Walk an order through the same steps the AI follows on a call. Test orders show on Live orders with a Test label and never reach Square or the kitchen printer."
      />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <TestContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function TestContent({ searchParams }: { searchParams: PageProps<"/agent/test">["searchParams"] }) {
  const session = await requireSession();
  if (!can(session.role, "agent.test")) return <NoAccess />;
  const sp = await searchParams;
  const orderId = typeof sp.order === "string" ? sp.order : null;
  const [menu, numbers, order, location, settings, open] = await Promise.all([
    api.getMenu(),
    api.getPhoneNumbers(),
    orderId ? api.getTestOrder(orderId) : Promise.resolve(null),
    api.getLocation(),
    api.getSettings(),
    api.getOpenState(),
  ]);
  return (
    <TestAgent
      menu={menu}
      order={order}
      aiNumber={numbers.find((n) => n.enabled)?.e164 ?? null}
      currency={location.currency}
      country={location.address.country}
      restaurant={session.restaurant.name}
      pickupPolicy={settings.pickupPolicy}
      orderingOn={location.orderingMode !== "DISABLED" && settings.orderingEnabled}
      orderingOpen={open.orderingOpen}
      nowIso={new Date().toISOString()}
    />
  );
}
