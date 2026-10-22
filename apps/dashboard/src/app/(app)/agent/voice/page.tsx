import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";

export const metadata: Metadata = { title: "Voice and pronunciation" };

// S21: stub from the shell step; replaced when this screen is built.
export default function VoiceandpronunciationPage() {
  return <PageHeader title="Voice and pronunciation" description="How the AI sounds." />;
}
