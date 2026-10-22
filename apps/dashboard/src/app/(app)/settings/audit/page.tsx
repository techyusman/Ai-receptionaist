import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Audit log" };

// S44: stub from the shell step; replaced when this screen is built.
export default function AuditlogPage() {
  return <PageHeader title="Audit log" description="Who changed what, and when." />;
}
