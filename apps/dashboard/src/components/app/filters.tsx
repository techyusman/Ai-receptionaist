import Link from "next/link";
import { cn, focusRing } from "@/lib/cn";

/** Server-rendered filter links (pill tabs). Each is a URL, so filters survive refresh and sharing. */
export function FilterLinks({ label, options }: { label: string; options: { href: string; label: string; active: boolean; count?: number }[] }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-1 rounded-md bg-surface-muted p-1">
        {options.map((o) => (
          <li key={o.href}>
            <Link
              href={o.href}
              scroll={false}
              aria-current={o.active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm font-semibold transition-colors",
                o.active ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
                focusRing,
              )}
            >
              {o.label}
              {o.count !== undefined && <span className="text-xs font-normal text-muted">{o.count}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Builds hrefs that change one query parameter and keep the rest. */
export function hrefWith(path: string, current: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...change })) if (v) params.set(k, v);
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

export function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}
