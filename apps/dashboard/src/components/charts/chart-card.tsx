"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";

/** Card with a title and a table-view toggle: every chart has a table twin (dataviz rule). */
export function ChartCard({
  title,
  description,
  table,
  children,
}: {
  title: string;
  description?: string;
  table: { columns: string[]; rows: (string | number)[][] };
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg text-fg">{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        <Button variant="ghost" size="sm" aria-expanded={showTable} onClick={() => setShowTable((s) => !s)}>
          {showTable ? "Show chart" : "Show as table"}
        </Button>
      </div>
      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-border">
                {table.columns.map((c, i) => (
                  <th key={c} scope="col" className={`py-2 font-semibold text-muted ${i ? "text-right" : "text-left"}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  {r.map((v, j) => (
                    <td key={j} className={`py-1.5 text-fg ${j ? "text-right tabular-nums" : ""}`}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
