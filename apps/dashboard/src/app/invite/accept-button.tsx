"use client";

import { useState, useTransition } from "react";
import { acceptInvitation } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";

export function AcceptButton({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await acceptInvitation(token);
            if (r && !r.ok) setError(r.message);
          })
        }
      >
        Accept and join
      </Button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
