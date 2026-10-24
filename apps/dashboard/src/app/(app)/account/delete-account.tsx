"use client";

import { deleteAccount } from "@/app/actions/auth";
import { useAction } from "@/components/app/use-action";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/overlays";

export function DeleteAccount() {
  const action = useAction();
  return (
    <div className="flex flex-col gap-2">
      <ConfirmDialog
        trigger={
          <Button variant="danger" className="self-start" loading={action.pending}>
            Delete my account
          </Button>
        }
        title="Delete your account?"
        description="Your sign-in and your access to every restaurant end now. This can't be undone."
        confirmLabel="Delete my account"
        onConfirm={() => action.run(() => deleteAccount())}
      />
      {action.error && <p className="text-sm text-danger">{action.error.message}</p>}
    </div>
  );
}
