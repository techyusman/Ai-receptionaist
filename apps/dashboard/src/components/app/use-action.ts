"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/data/types";

/**
 * Runs a Server Action from a form: pending state, a field error next to its field, and a toast for
 * anything without a field (or for success, if you pass a message).
 */
export function useAction() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  function run<T>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; onDone?: (data: T) => void } = {}) {
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError({ field: r.field, message: r.message });
        if (!r.field) toast({ title: r.message, variant: "error" });
        return;
      }
      if (opts.success) toast({ title: opts.success, variant: "success" });
      opts.onDone?.(r.data);
    });
  }

  return {
    run,
    pending,
    error,
    fieldError: (field: string) => (error?.field === field ? error.message : undefined),
    clearError: () => setError(null),
  };
}
