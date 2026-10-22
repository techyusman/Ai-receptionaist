import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Knowledge" };

// S25: stub from the shell step; replaced when this screen is built.
export default function KnowledgePage() {
  return <PageHeader title="Knowledge" description="Answers the AI gives to common questions." />;
}
