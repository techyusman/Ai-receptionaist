import { Minimize } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SoundToggle } from "@/components/app/live-board";
import { BoardSkeleton, LiveContent } from "@/components/app/live-content";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Kitchen view" };

export default function KitchenPage() {
  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-display text-fg">Live orders</h1>
        <div className="flex items-center gap-2">
          <SoundToggle />
          <Button asChild variant="secondary" size="lg">
            <Link href="/live">
              <Minimize aria-hidden /> Exit kitchen view
            </Link>
          </Button>
        </div>
      </header>
      <Suspense fallback={<BoardSkeleton />}>
        <LiveContent size="kitchen" />
      </Suspense>
    </main>
  );
}
