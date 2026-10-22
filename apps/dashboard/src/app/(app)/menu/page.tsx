import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Menu" };

// S23: stub from the shell step; replaced when this screen is built.
export default function MenuPage() {
  return <PageHeader title="Menu" description="What the AI can offer, synced from Square." />;
}
