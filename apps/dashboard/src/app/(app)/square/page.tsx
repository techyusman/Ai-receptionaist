import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Square" };

// S29: stub from the shell step; replaced when this screen is built.
export default function SquarePage() {
  return <PageHeader title="Square" description="Connection, location and sync." />;
}
