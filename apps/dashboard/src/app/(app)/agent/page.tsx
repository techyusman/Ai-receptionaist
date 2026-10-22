import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Greeting and language" };

// S17: stub from the shell step; replaced when this screen is built.
export default function GreetingandlanguagePage() {
  return <PageHeader title="Greeting and language" description="What callers hear first." />;
}
