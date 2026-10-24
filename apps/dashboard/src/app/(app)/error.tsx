"use client";

import { ErrorRecovery } from "@/components/app/error-recovery";

// A screen inside the app failed to load: keep the sidebar and header, show the way back.
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery {...props} />;
}
