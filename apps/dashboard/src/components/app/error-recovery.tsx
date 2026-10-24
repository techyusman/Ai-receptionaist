"use client";

import { CloudAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";

const RETRY_MS = 15_000;

/**
 * What a screen shows when it couldn't load. The frame around it stays, the person can try again, and a
 * screen nobody is touching (a kitchen tablet) tries again by itself, so it comes back on its own.
 */
export function ErrorRecovery({ error, reset, className }: { error: Error & { digest?: string }; reset: () => void; className?: string }) {
  const router = useRouter();
  useEffect(() => {
    const retry = () => startTransition(() => {
      router.refresh();
      reset();
    });
    const timer = setInterval(retry, RETRY_MS);
    return () => clearInterval(timer);
  }, [router, reset]);

  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={CloudAlert}
        title="This screen didn't load"
        action={
          <Button
            variant="secondary"
            onClick={() => startTransition(() => {
              router.refresh();
              reset();
            })}
          >
            Try again
          </Button>
        }
      >
        Usually a passing hiccup. It tries again by itself every few seconds.
        {error.digest && <span className="mt-1 block font-mono text-xs">Reference {error.digest}</span>}
      </EmptyState>
    </div>
  );
}
