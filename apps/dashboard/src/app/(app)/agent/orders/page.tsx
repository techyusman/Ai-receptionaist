import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Phone orders" };

// S19: stub from the shell step; replaced when this screen is built.
export default function PhoneordersPage() {
  return <PageHeader title="Phone orders" description="Where orders go and pickup rules." />;
}
