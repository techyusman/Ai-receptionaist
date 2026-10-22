import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Test your agent" };

// S22: stub from the shell step; replaced when this screen is built.
export default function TestyouragentPage() {
  return <PageHeader title="Test your agent" description="Walk an order through the AI before callers do." />;
}
