"use client";

import { Tooltip } from "@/components/ui/overlays";

/**
 * Horizontal bars for magnitude (dataviz spec): one series colour, ≤24px thick with a 4px rounded
 * data end and a square baseline, value at the tip in text ink, a hover/focus tooltip per bar.
 */
export function BarList({ rows, unit }: { rows: { label: string; value: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing in this period.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const share = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr]">
            <span className="truncate text-fg" title={r.label}>
              {r.label}
            </span>
            <Tooltip content={`${r.label}: ${r.value} ${unit} (${share}% of the total)`}>
              <span
                tabIndex={0}
                aria-label={`${r.label}: ${r.value} ${unit}`}
                className="flex items-center gap-2 rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span
                  aria-hidden
                  className="h-4 rounded-r-xs transition-opacity hover:opacity-80"
                  style={{ width: `max(4px, calc((100% - 3rem) * ${r.value / max}))`, background: "var(--ds-chart-series-1)" }}
                />
                <span className="text-sm font-semibold text-fg tabular-nums">{r.value}</span>
              </span>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
