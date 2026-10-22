import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Callbacks" };

// S42: stub from the shell step; replaced when this screen is built.
export default function CallbacksPage() {
  return <PageHeader title="Callbacks" description="People who asked to be called back." />;
}
