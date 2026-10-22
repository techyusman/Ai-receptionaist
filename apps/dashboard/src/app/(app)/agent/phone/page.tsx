import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { PhoneNumbers } from "./phone-numbers";

export const metadata: Metadata = { title: "Phone number" };

// S09 / S16: the AI's phone number, outage fallback, call forwarding, adding a number.
export default function PhonePage() {
  return (
    <>
      <PageHeader title="Phone number" description="Callers reach the AI on this number. Keep your usual number public and forward it here." />
      <Suspense fallback={<CardSkeleton rows={6} />}>
        <PhoneContent />
      </Suspense>
    </>
  );
}

async function PhoneContent() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const [numbers, location] = await Promise.all([api.getPhoneNumbers(), api.getLocation()]);
  return <PhoneNumbers numbers={numbers} publicPhone={location.publicPhone} canBuy={can(session.role, "numbers.buy")} />;
}
