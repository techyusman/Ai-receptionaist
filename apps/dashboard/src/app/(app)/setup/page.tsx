import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Set up your AI receptionist" };

// S04: stub from the shell step; replaced when this screen is built.
export default function SetupyourAIreceptionistPage() {
  return <PageHeader title="Set up your AI receptionist" description="A few steps before callers reach it." />;
}
