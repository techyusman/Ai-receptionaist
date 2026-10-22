import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { Transfers } from "./transfers";

export const metadata: Metadata = { title: "Transfers" };

// S20: where the AI hands calls to a person, and how.
export default function TransfersPage() {
  return (
    <>
      <PageHeader
        title="Transfers"
        description="When a caller asks for a person, has a complaint or an allergy question, or the AI is unsure, it passes the call to one of these numbers."
      />
      <Suspense fallback={<CardSkeleton rows={6} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const [targets, settings] = await Promise.all([api.getTransferTargets(), api.getSettings()]);
  return <Transfers targets={targets} settings={settings} />;
}
