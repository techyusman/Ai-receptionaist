import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Orders" };

// S11: stub from the shell step; replaced when this screen is built.
export default function OrdersPage() {
  return <PageHeader title="Orders" description="Every phone order and where it is." />;
}
