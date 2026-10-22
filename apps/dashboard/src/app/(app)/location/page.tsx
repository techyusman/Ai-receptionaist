import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Hours and location" };

// S28: stub from the shell step; replaced when this screen is built.
export default function HoursandlocationPage() {
  return <PageHeader title="Hours and location" description="Address, directions and opening hours." />;
}
