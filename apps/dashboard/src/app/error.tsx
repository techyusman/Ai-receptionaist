"use client";

import { ErrorRecovery } from "@/components/app/error-recovery";

// Anything above a screen failed (the app's frame itself): a whole-page version of the same recovery.
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4">
      <ErrorRecovery {...props} />
    </main>
  );
}
