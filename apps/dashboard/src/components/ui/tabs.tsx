"use client";

import { Tabs as RTabs } from "radix-ui";
import { cn, focusRing } from "@/lib/cn";

export const Tabs = RTabs.Root;
export const TabsContent = (props: React.ComponentProps<typeof RTabs.Content>) => (
  <RTabs.Content {...props} className={cn("pt-4", focusRing, props.className)} />
);

export function TabsList({
  variant = "underline",
  className,
  ...props
}: React.ComponentProps<typeof RTabs.List> & { variant?: "underline" | "pill" }) {
  return (
    <RTabs.List
      data-variant={variant}
      className={cn(
        "group/tabs flex gap-1",
        variant === "underline" ? "border-b border-border" : "rounded-md bg-surface-muted p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        "inline-flex h-10 items-center gap-2 px-3 text-sm font-semibold text-muted transition-colors duration-(--ds-motion-fast) hover:text-fg disabled:opacity-50",
        // underline variant
        "group-data-[variant=underline]/tabs:-mb-px group-data-[variant=underline]/tabs:border-b-2 group-data-[variant=underline]/tabs:border-transparent",
        "group-data-[variant=underline]/tabs:data-[state=active]:border-accent",
        // pill variant
        "group-data-[variant=pill]/tabs:h-8 group-data-[variant=pill]/tabs:rounded-sm group-data-[variant=pill]/tabs:data-[state=active]:bg-surface group-data-[variant=pill]/tabs:data-[state=active]:shadow-card",
        "data-[state=active]:text-fg",
        focusRing,
        className,
      )}
      {...props}
    />
  );
}
