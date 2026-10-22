import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { GreetingSettings } from "./greeting-settings";

export const metadata: Metadata = { title: "AI agent" };

// S16/S17: greeting, languages and after-hours behaviour.
export default function GreetingPage() {
  return (
    <>
      <PageHeader title="Greeting and language" description="What callers hear first, which languages the AI speaks, and what it does when you're closed." />
      <Suspense fallback={<CardSkeleton rows={6} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const settings = await api.getSettings();
  return <GreetingSettings settings={settings} restaurant={session.restaurant.name} />;
}
