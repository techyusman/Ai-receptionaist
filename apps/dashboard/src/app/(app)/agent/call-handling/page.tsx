import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { CallHandling } from "./call-handling";

export const metadata: Metadata = { title: "Call handling" };

// S18: Ring Staff First, limits, and (owners only) transcripts, recordings and retention.
export default function CallHandlingPage() {
  return (
    <>
      <PageHeader title="Call handling" description="When staff get the first ring, how long calls can run, and what the AI keeps afterwards." />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const settings = await api.getSettings();
  return <CallHandling settings={settings} canEditPrivacy={can(session.role, "privacy.edit")} />;
}
