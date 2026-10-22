import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Phone number" };

// S09: stub from the shell step; replaced when this screen is built.
export default function PhonenumberPage() {
  return <PageHeader title="Phone number" description="The number callers reach the AI on." />;
}
