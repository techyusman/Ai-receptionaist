import { ArrowDown, ArrowUp, Check, CircleAlert, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { statusVocabulary, toneClass, type StatusDomain, type StatusMeta, type StatusValue } from "@/lib/status";

/* Card -------------------------------------------------------------------- */

export function Card({
  variant = "flat",
  className,
  ...props
}: React.ComponentProps<"div"> & { variant?: "flat" | "raised" }) {
  return (
    <div
      className={cn(
        "rounded-lg bg-surface p-5",
        variant === "flat" ? "border border-border" : "shadow-card",
        className,
      )}
      {...props}
    />
  );
}

/* StatusPill -------------------------------------------------------------- */

export function StatusPill<D extends StatusDomain>({
  domain,
  value,
  size = "md",
  className,
}: {
  domain: D;
  value: StatusValue<D>;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = statusVocabulary[domain][value] as StatusMeta;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill font-semibold whitespace-nowrap",
        size === "sm" ? "h-5.5 px-2 text-xs" : "h-7 px-2.5 text-sm",
        toneClass[meta.tone],
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-3.5", meta.spin && "animate-spin motion-reduce:animate-none")} />
      {meta.label}
    </span>
  );
}

/* Table ------------------------------------------------------------------- */

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export const THead = (p: React.ComponentProps<"thead">) => (
  <thead {...p} className={cn("sticky top-0 bg-surface-muted", p.className)} />
);
/* Below md, columns marked desktopOnly are hidden; put their values in a <MobileDetail> under the
   first cell so nothing is lost. The element stays a real <table> for screen readers. */
type ColumnProps = { desktopOnly?: boolean };

export const Th = ({ desktopOnly, ...p }: React.ComponentProps<"th"> & ColumnProps) => (
  <th
    scope="col"
    {...p}
    className={cn("h-10 px-4 text-left text-xs font-semibold text-muted", desktopOnly && "max-md:hidden", p.className)}
  />
);
export const Tr = (p: React.ComponentProps<"tr">) => (
  <tr {...p} className={cn("border-t border-border transition-colors hover:bg-surface-muted", p.className)} />
);
export const Td = ({ desktopOnly, ...p }: React.ComponentProps<"td"> & ColumnProps) => (
  <td {...p} className={cn("h-12 px-4 py-2 text-fg max-md:px-3", desktopOnly && "max-md:hidden", p.className)} />
);
export const MobileDetail = ({ children }: { children: React.ReactNode }) => (
  <span className="block text-xs text-muted md:hidden">{children}</span>
);

/* EmptyState -------------------------------------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      <Icon aria-hidden className="size-8 text-muted" />
      <p className="text-lg text-fg">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* Skeleton ---------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("animate-pulse rounded-sm bg-surface-muted motion-reduce:animate-none", className)} />
  );
}

/* Banner ------------------------------------------------------------------ */

type BannerTone = "info" | "warning" | "danger" | "success";
const bannerTone: Record<BannerTone, { cls: string; icon: LucideIcon }> = {
  info: { cls: "bg-accent-subtle text-accent", icon: Info },
  warning: { cls: "bg-warning-subtle text-warning", icon: TriangleAlert },
  danger: { cls: "bg-danger-subtle text-danger", icon: CircleAlert },
  success: { cls: "bg-success-subtle text-success", icon: Check },
};

export function Banner({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  critical = false,
  className,
}: {
  tone?: BannerTone;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  /** Announce once with role="alert" instead of the polite role="status". */
  critical?: boolean;
  className?: string;
}) {
  const { cls, icon: Icon } = bannerTone[tone];
  return (
    <div role={critical ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md p-4", cls, className)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold">{title}</p>
        {children && <p className="text-sm text-fg">{children}</p>}
      </div>
      {action}
      {onDismiss && !critical && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded-sm p-1 hover:bg-surface/50">
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

/* StatTile ---------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  delta,
  loading = false,
}: {
  label: string;
  value?: string;
  /** e.g. { text: "12% vs last week", direction: "up", good: true } */
  delta?: { text: string; direction: "up" | "down"; good: boolean };
  loading?: boolean;
}) {
  const Arrow = delta?.direction === "down" ? ArrowDown : ArrowUp;
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {loading ? <Skeleton className="h-8.5 w-24" /> : <span className="text-xl text-fg">{value ?? "–"}</span>}
      {delta && !loading && (
        <span className={cn("inline-flex items-center gap-1 text-xs", delta.good ? "text-success" : "text-danger")}>
          <Arrow aria-hidden className="size-3.5" />
          {delta.text}
        </span>
      )}
    </Card>
  );
}

/* Stepper ----------------------------------------------------------------- */

export type Step = { title: string; state: "done" | "current" | "upcoming" | "blocked"; note?: string };

export function Stepper({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-1", className)}>
      {steps.map((s, i) => (
        <li
          key={s.title}
          aria-current={s.state === "current" ? "step" : undefined}
          className={cn("flex items-start gap-3 rounded-md p-2", s.state === "current" && "bg-accent-subtle")}
        >
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded-pill border text-xs font-semibold",
              s.state === "done" && "border-success bg-success text-on-accent",
              s.state === "current" && "border-accent bg-accent text-on-accent",
              s.state === "upcoming" && "border-input text-muted",
              s.state === "blocked" && "border-warning text-warning",
            )}
          >
            {s.state === "done" ? <Check aria-hidden className="size-3.5" /> : i + 1}
            <span className="sr-only">{s.state === "done" ? "Done" : s.state === "blocked" ? "Blocked" : ""}</span>
          </span>
          <span className="flex flex-col">
            <span className={cn("text-sm font-semibold", s.state === "upcoming" ? "text-muted" : "text-fg")}>
              {s.title}
            </span>
            {s.note && (
              <span className={cn("text-xs", s.state === "blocked" ? "text-warning" : "text-muted")}>{s.note}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
