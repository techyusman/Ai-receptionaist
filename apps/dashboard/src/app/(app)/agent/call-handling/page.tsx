import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Call handling" };

// S18: stub from the shell step; replaced when this screen is built.
export default function CallhandlingPage() {
  return <PageHeader title="Call handling" description="Ring staff first, silence and call length." />;
}
