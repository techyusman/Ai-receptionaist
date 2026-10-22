"use client";

import { useEffect, useRef, useState } from "react";

export type LineSeries = { key: string; label: string; slot: 1 | 2; values: number[] };

const H = 240;
const M = { top: 16, right: 92, bottom: 28, left: 36 };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

/**
 * Multi-series line chart (dataviz spec): 2px lines, ≥8px end dots with a 2px surface ring,
 * hairline grid, legend for ≥2 series plus end labels when they don't collide, crosshair tooltip on
 * hover, and the same readout from the keyboard (arrow keys).
 */
export function LineChart({ labels, series, ariaLabel }: { labels: string[]; series: LineSeries[]; ariaLabel: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => M.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72))));

  // End labels only when they won't collide; otherwise the legend and tooltip carry identity.
  const ends = series.map((s) => y(s.values[n - 1] ?? 0));
  const endLabels = series.length < 2 || Math.abs((ends[0] ?? 0) - (ends[1] ?? 0)) >= 18;

  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const px = clientX - rect.left;
    const i = Math.round(((px - M.left) / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };

  const tipLeft = active === null ? 0 : Math.min(Math.max(x(active) + 12, 0), width - 168);

  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-4 text-sm text-muted" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-4 rounded-pill" style={{ background: `var(--ds-chart-series-${s.slot})` }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={box}
        className="relative rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use the left and right arrow keys to read each day.`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
          else if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
          else if (e.key === "Escape") setActive(null);
          else return;
          e.preventDefault();
        }}
      >
        <svg width={width} height={H} role="img" aria-hidden className="block max-w-full">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--ds-chart-axis)" : "var(--ds-chart-grid)"} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-xs tabular-nums">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={l} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-muted text-xs">
                {l}
              </text>
            ) : null,
          )}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--ds-chart-axis)" strokeWidth={1} />}
          {series.map((s) => (
            <g key={s.key}>
              <path
                d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={`var(--ds-chart-series-${s.slot})`}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={4} fill={`var(--ds-chart-series-${s.slot})`} stroke="var(--ds-surface)" strokeWidth={2} />
              {active !== null && (
                <circle cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} fill={`var(--ds-chart-series-${s.slot})`} stroke="var(--ds-surface)" strokeWidth={2} />
              )}
              {endLabels && (
                <text x={x(n - 1) + 10} y={y(s.values[n - 1] ?? 0)} dy="0.32em" className="fill-fg text-xs">
                  <tspan className="font-semibold">{s.values[n - 1] ?? 0}</tspan>
                  <tspan className="fill-muted"> {s.label.toLowerCase()}</tspan>
                </text>
              )}
            </g>
          ))}
        </svg>
        {active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 w-40 rounded-md border border-border bg-surface p-2 shadow-pop"
            style={{ left: tipLeft }}
          >
            <p className="text-xs text-muted">{labels[active]}</p>
            {series.map((s) => (
              <p key={s.key} className="flex items-center gap-2 text-sm">
                <span aria-hidden className="h-0.5 w-3 rounded-pill" style={{ background: `var(--ds-chart-series-${s.slot})` }} />
                <span className="font-semibold text-fg tabular-nums">{s.values[active] ?? 0}</span>
                <span className="text-muted">{s.label.toLowerCase()}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
