import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Calls" };

// S14: stub from the shell step; replaced when this screen is built.
export default function CallsPage() {
  return <PageHeader title="Calls" description="Every call the AI answered." />;
}
