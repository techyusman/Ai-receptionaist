import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, NoAccess, PageHeader } from "@/components/app/page";
import { Card } from "@/components/ui/display";
import { can } from "@/lib/permissions";
import { requireSession } from "@/server/auth";
import * as api from "@/server/api";
import { KeyRound } from "lucide-react";
import { ChatWindow, GroqKeySteps } from "./chat-window";

export const metadata: Metadata = { title: "Chat with your AI" };

// S22b. Text the AI the way a customer would, through the same menu, answers and order steps as a call.
export default function TestChatPage() {
  return (
    <>
      <PageHeader
        title="Chat with your AI"
        description="Text the AI the way a customer would. It uses the same menu, answers and order steps as on a phone call. Orders are marked Test: they show on Live orders and never alert the kitchen."
      />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <ChatContent />
      </Suspense>
    </>
  );
}

async function ChatContent() {
  const session = await requireSession();
  if (!can(session.role, "agent.test")) return <NoAccess />;
  const [status, location] = await Promise.all([api.getTestChatStatus(), api.getLocation()]);
  if (!status.configured || !status.model) {
    return (
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <KeyRound aria-hidden className="size-5 text-muted" />
          <h2 className="text-lg text-fg">Add an AI key to chat</h2>
        </div>
        <GroqKeySteps />
      </Card>
    );
  }
  return <ChatWindow restaurant={session.restaurant.name} model={status.model} voice={status.voice} country={location.address.country} />;
}
