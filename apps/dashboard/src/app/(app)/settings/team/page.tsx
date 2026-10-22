import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Team" };

// S43: stub from the shell step; replaced when this screen is built.
export default function TeamPage() {
  return <PageHeader title="Team" description="Who can sign in, and what they can do." />;
}
