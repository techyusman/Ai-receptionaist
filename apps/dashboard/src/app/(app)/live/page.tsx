import { Maximize } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SoundToggle } from "@/components/app/live-board";
import { BoardSkeleton, LiveContent } from "@/components/app/live-content";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Live orders" };

// S41: phone orders waiting for the kitchen. Updates live over SSE.
export default function LivePage() {
  return (
    <>
      <PageHeader
        title="Live orders"
        description="Phone orders appear here the moment a caller confirms one. Accept each one so the team knows it's being made."
        actions={
          <>
            <SoundToggle />
            <Button asChild variant="secondary">
              <Link href="/kitchen">
                <Maximize aria-hidden /> Kitchen view
              </Link>
            </Button>
          </>
        }
      />
      <Suspense fallback={<BoardSkeleton />}>
        <LiveContent />
      </Suspense>
    </>
  );
}
