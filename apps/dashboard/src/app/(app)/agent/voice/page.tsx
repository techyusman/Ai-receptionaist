import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { VoiceSettings } from "./voice-settings";

export const metadata: Metadata = { title: "Voice and pronunciation" };

// S21 voice choice and S30 pronunciation list.
export default function VoicePage() {
  return (
    <>
      <PageHeader title="Voice and pronunciation" description="How the AI sounds, and how it says words it might get wrong." />
      <Suspense fallback={<CardSkeleton rows={6} />}>
        <Content />
      </Suspense>
    </>
  );
}

async function Content() {
  const session = await requireSession();
  if (!can(session.role, "settings.edit")) return <NoAccess />;
  const [settings, words] = await Promise.all([api.getSettings(), api.getPronunciations()]);
  return <VoiceSettings voice={settings.voice} words={words} />;
}
