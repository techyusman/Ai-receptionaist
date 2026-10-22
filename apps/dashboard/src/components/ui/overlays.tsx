"use client";

import { X } from "lucide-react";
import { Dialog as RDialog, DropdownMenu as RMenu, Tooltip as RTooltip } from "radix-ui";
import { useState } from "react";
import { cn, focusRing } from "@/lib/cn";
import { Button, IconButton } from "./button";

const overlayClass = "fixed inset-0 z-40 bg-(--ds-shadow-overlay)";

/* Dialog ------------------------------------------------------------------ */

export function Dialog({
  trigger,
  title,
  description,
  size = "md",
  footer,
  children,
  open,
  onOpenChange,
  locked = false,
}: {
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  size?: "sm" | "md";
  footer?: React.ReactNode;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** While submitting: Esc and outside clicks don't close it. */
  locked?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className={overlayClass} />
        <RDialog.Content
          onEscapeKeyDown={(e) => locked && e.preventDefault()}
          onPointerDownOutside={(e) => locked && e.preventDefault()}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg bg-surface p-6 shadow-pop",
            size === "sm" ? "max-w-100" : "max-w-140",
            focusRing,
          )}
        >
          <div className="flex flex-col gap-1">
            <RDialog.Title className="text-lg text-fg">{title}</RDialog.Title>
            {description ? (
              <RDialog.Description className="text-sm text-muted">{description}</RDialog.Description>
            ) : (
              <RDialog.Description className="sr-only">{title}</RDialog.Description>
            )}
          </div>
          {children}
          {footer && <div className="flex justify-end gap-2">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export const DialogClose = RDialog.Close;

/** Destructive confirmation. Names the thing being destroyed. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && setOpen(o)}
      trigger={trigger}
      title={title}
      description={description}
      size="sm"
      locked={busy}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              Keep it
            </Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* Drawer (side sheet) ------------------------------------------------------ */

export function Drawer({
  trigger,
  title,
  children,
  open,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className={overlayClass} />
        <RDialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-pop md:w-(--ds-drawer)",
            focusRing,
          )}
        >
          <div className="flex h-(--ds-header) items-center justify-between border-b border-border px-5">
            <RDialog.Title className="text-lg text-fg">{title}</RDialog.Title>
            <RDialog.Description className="sr-only">{title}</RDialog.Description>
            <RDialog.Close asChild>
              <IconButton label="Close">
                <X aria-hidden />
              </IconButton>
            </RDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* Tooltip ----------------------------------------------------------------- */

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <RTooltip.Provider delayDuration={300}>{children}</RTooltip.Provider>
);

export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          sideOffset={6}
          className="z-50 rounded-sm bg-fg px-2 py-1 text-xs text-surface shadow-pop"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/* DropdownMenu ------------------------------------------------------------ */

export type MenuItem = { label: string; onSelect?: () => void; destructive?: boolean; disabled?: boolean };

export function DropdownMenu({ trigger, items }: { trigger: React.ReactNode; items: (MenuItem | "separator")[] }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-pop"
        >
          {items.map((item, i) =>
            item === "separator" ? (
              <RMenu.Separator key={`sep-${i}`} className="my-1 h-px bg-border" />
            ) : (
              <RMenu.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  "flex h-9 cursor-default items-center rounded-sm px-3 text-sm outline-none select-none data-disabled:opacity-50 data-highlighted:bg-surface-muted",
                  item.destructive ? "text-danger" : "text-fg",
                )}
              >
                {item.label}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}
