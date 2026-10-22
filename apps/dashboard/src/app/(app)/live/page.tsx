import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Live orders" };

// S41: stub from the shell step; replaced when this screen is built.
export default function LiveordersPage() {
  return <PageHeader title="Live orders" description="Phone orders waiting for the kitchen." />;
}
