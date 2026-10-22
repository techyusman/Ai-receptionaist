"use client";

import type { OrderStatus } from "@receptionist/domain";
import { useState, useTransition } from "react";
import { acceptOrder, cancelOrder } from "@/app/actions/orders";
import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/field";
import { Dialog, DialogClose } from "@/components/ui/overlays";
import { useToast } from "@/components/ui/toast";

const cancellable: OrderStatus[] = ["SUBMITTED_TO_POS", "POS_VISIBILITY_UNVERIFIED", "RECEIVED_BY_RESTAURANT"];

export function OrderActions({
  id,
  status,
  customer,
  canAccept: mayAccept,
  canManage,
}: {
  id: string;
  status: OrderStatus;
  customer: string;
  canAccept: boolean;
  canManage: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const canAccept = mayAccept && (status === "SUBMITTED_TO_POS" || status === "POS_VISIBILITY_UNVERIFIED");
  const canCancel = canManage && cancellable.includes(status);
  if (!canAccept && !canCancel) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canAccept && (
        <Button
          loading={pending && !open}
          onClick={() =>
            start(async () => {
              const r = await acceptOrder(id);
              toast(r.ok ? { title: `Accepted ${customer}'s order`, variant: "success" } : { title: r.message, variant: "error" });
            })
          }
        >
          Accept order
        </Button>
      )}
      {canCancel && (
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setError(undefined);
        }}
        locked={pending}
        trigger={<Button variant="secondary">Cancel order</Button>}
        title={`Cancel ${customer}'s order?`}
        description="The order stays in the history as cancelled. Call the customer to let them know."
        footer={
          <>
            <DialogClose asChild>
              <Button variant="secondary" disabled={pending}>
                Keep it
              </Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await cancelOrder(id, reason);
                  if (!r.ok) return setError(r.message);
                  setOpen(false);
                  toast({ title: "Order cancelled", variant: "success" });
                })
              }
            >
              Cancel order
            </Button>
          </>
        }
      >
        <FormField label="Why?" error={error} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Out of oat milk, customer chose to cancel" />
        </FormField>
      </Dialog>
      )}
    </div>
  );
}
