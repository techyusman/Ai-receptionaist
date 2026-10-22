import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Transfers" };

// S20: stub from the shell step; replaced when this screen is built.
export default function TransfersPage() {
  return <PageHeader title="Transfers" description="Who the AI hands calls to." />;
}
