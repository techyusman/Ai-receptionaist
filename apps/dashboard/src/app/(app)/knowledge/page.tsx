import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { toFaqRows } from "@/server/knowledge";
import { KnowledgeList } from "./knowledge-list";

export const metadata: Metadata = { title: "Knowledge" };

// S25 knowledge base (with S26 starter templates).
export default function KnowledgePage() {
  return (
    <>
      <PageHeader
        title="Knowledge"
        description="Answers the AI gives to common questions. It uses your wording and never makes up an answer. If something isn't here, it offers to pass the caller to staff."
      />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "knowledge.edit")) return <NoAccess />;
  const [faqs, location] = await Promise.all([api.getFaqs(), api.getLocation()]);
  const rows = toFaqRows(faqs, location.timezone);
  const live = rows.filter((r) => r.active && r.reviewed && !r.expired).length;
  return <KnowledgeList rows={rows} liveCount={live} />;
}
