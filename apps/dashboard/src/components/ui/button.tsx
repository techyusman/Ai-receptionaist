"use client";

import { Loader } from "lucide-react";
import { Slot } from "radix-ui";
import { cn, focusRing } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-muted",
  ghost: "text-fg hover:bg-surface-muted",
  danger: "bg-danger text-on-danger hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

const iconSizes: Record<Size, string> = { sm: "size-8", md: "size-10", lg: "size-12" };

const base = cn(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap select-none",
  "transition-colors duration-(--ds-motion-fast) ease-ds active:translate-y-px",
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  focusRing,
);

type ButtonProps = React.ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Render the child (e.g. a Next <Link>) with button styles. */
  asChild?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  asChild = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = cn(base, variants[variant], sizes[size], className);
  if (asChild) {
    return <Slot.Root className={classes}>{children}</Slot.Root>;
  }
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader aria-hidden className="animate-spin motion-reduce:animate-none" />}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<React.ComponentProps<"button">, "aria-label"> & {
  /** Required: the accessible name, also shown as the tooltip text by callers. */
  label: string;
  variant?: "ghost" | "secondary";
  size?: Size;
};

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(base, variants[variant], iconSizes[size], "px-0", className)}
      {...props}
    />
  );
}
