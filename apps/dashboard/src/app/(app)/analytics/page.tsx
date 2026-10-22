import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Analytics" };

// S27: stub from the shell step; replaced when this screen is built.
export default function AnalyticsPage() {
  return <PageHeader title="Analytics" description="How the AI is doing." />;
}
