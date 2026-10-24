"use client";

import { ErrorRecovery } from "@/components/app/error-recovery";

// The kitchen screen keeps its dark frame and its live connection, and recovers by itself.
export default function KitchenError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery {...props} className="grid min-h-dvh place-items-center" />;
}
