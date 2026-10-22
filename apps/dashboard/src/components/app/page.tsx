import { Lock } from "lucide-react";
import { Card, EmptyState, Skeleton } from "@/components/ui/display";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl text-fg">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function NoAccess({ who = "owners and managers" }: { who?: string }) {
  return (
    <Card>
      <EmptyState icon={Lock} title="You don't have access to this page">
        This page is for {who}. Ask an owner if you need it.
      </EmptyState>
    </Card>
  );
}

/** Generic loading state: a few skeleton rows in a card, for Suspense fallbacks. */
export function CardSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <Card className={className} aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-1/3" />
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={i % 2 ? "h-4 w-5/6" : "h-4 w-full"} />
        ))}
      </div>
    </Card>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg text-fg">{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
