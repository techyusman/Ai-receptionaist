"use client";

import { Check, ChevronDown, Minus } from "lucide-react";
import { Checkbox as RCheckbox, RadioGroup as RRadio, Select as RSelect, Switch as RSwitch } from "radix-ui";
import { cn, focusRing } from "@/lib/cn";
import { controlClass, useFieldProps } from "./field";

/* Select ------------------------------------------------------------------ */

export type Option = { value: string; label: string; disabled?: boolean };

export function Select({
  options,
  placeholder = "Choose…",
  className,
  ...props
}: React.ComponentProps<typeof RSelect.Root> & { options: Option[]; placeholder?: string; className?: string }) {
  const field = useFieldProps();
  return (
    <RSelect.Root {...props}>
      <RSelect.Trigger
        id={field.id}
        aria-describedby={field["aria-describedby"]}
        aria-invalid={field["aria-invalid"]}
        className={cn(controlClass, "flex h-10 items-center justify-between gap-2 text-left data-placeholder:text-muted", className)}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <ChevronDown aria-hidden className="size-4 text-muted" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden rounded-md border border-border bg-surface shadow-pop"
        >
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-9 cursor-default items-center rounded-sm pr-3 pl-8 text-sm text-fg outline-none select-none data-disabled:opacity-50 data-highlighted:bg-surface-muted"
              >
                <RSelect.ItemIndicator className="absolute left-2">
                  <Check aria-hidden className="size-4 text-accent" />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

/* Checkbox ---------------------------------------------------------------- */

export function Checkbox({
  label,
  className,
  ...props
}: React.ComponentProps<typeof RCheckbox.Root> & { label: string }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-fg has-disabled:opacity-50", className)}>
      <RCheckbox.Root
        className={cn(
          "grid size-5 place-items-center rounded-sm border border-input bg-surface",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
          "text-on-accent disabled:cursor-not-allowed",
          focusRing,
        )}
        {...props}
      >
        <RCheckbox.Indicator>
          {props.checked === "indeterminate" ? (
            <Minus aria-hidden className="size-3.5" />
          ) : (
            <Check aria-hidden className="size-3.5" />
          )}
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      {label}
    </label>
  );
}

/* Switch ------------------------------------------------------------------ */

export function Switch({
  label,
  description,
  pending = false,
  className,
  ...props
}: React.ComponentProps<typeof RSwitch.Root> & { label: string; description?: string; pending?: boolean }) {
  return (
    <label className={cn("flex items-start justify-between gap-4 has-disabled:opacity-50", className)}>
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-fg">{label}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </span>
      <RSwitch.Root
        aria-busy={pending || undefined}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-pill border border-input bg-surface-muted transition-colors duration-(--ds-motion-fast)",
          "data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed",
          pending && "opacity-70",
          focusRing,
        )}
        {...props}
      >
        <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-pill bg-surface shadow-card transition-transform duration-(--ds-motion-fast) ease-ds data-[state=checked]:translate-x-5" />
      </RSwitch.Root>
    </label>
  );
}

/* RadioGroup: list and cards ---------------------------------------------- */

export type RadioOption = { value: string; title: string; description?: string; disabledReason?: string };

export function RadioGroup({
  legend,
  options,
  variant = "list",
  className,
  ...props
}: React.ComponentProps<typeof RRadio.Root> & {
  legend: string;
  options: RadioOption[];
  variant?: "list" | "cards";
}) {
  return (
    <fieldset className={cn("flex flex-col gap-2", className)}>
      <legend className="mb-1 text-sm font-semibold text-fg">{legend}</legend>
      <RRadio.Root className={cn("flex flex-col", variant === "cards" ? "gap-2" : "gap-1")} {...props}>
        {options.map((o) => {
          const disabled = !!o.disabledReason;
          return (
            <label
              key={o.value}
              className={cn(
                "flex items-start gap-3",
                variant === "cards" &&
                  "rounded-md border border-border bg-surface p-3 has-data-[state=checked]:border-accent has-data-[state=checked]:bg-accent-subtle",
                disabled && "opacity-50",
              )}
            >
              <RRadio.Item
                value={o.value}
                disabled={disabled}
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-pill border border-input bg-surface data-[state=checked]:border-accent",
                  focusRing,
                )}
              >
                <RRadio.Indicator className="size-2.5 rounded-pill bg-accent" />
              </RRadio.Item>
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-fg">{o.title}</span>
                {o.description && <span className="text-xs text-muted">{o.description}</span>}
                {o.disabledReason && <span className="text-xs text-warning">{o.disabledReason}</span>}
              </span>
            </label>
          );
        })}
      </RRadio.Root>
    </fieldset>
  );
}
