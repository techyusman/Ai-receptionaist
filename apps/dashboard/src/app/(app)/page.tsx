import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Overview" };

// S02: stub from the shell step; replaced when this screen is built.
export default function OverviewPage() {
  return <PageHeader title="Overview" description="Setup progress and today at a glance." />;
}
