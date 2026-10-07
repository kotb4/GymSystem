import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface Column<T> {
  key: string;
  header: string;
  align?: "start" | "center" | "end";
  className?: string;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  className?: string;
  /** Row to emphasise and scroll into view (e.g. a reference-number lookup hit). */
  highlightRowKey?: string | null;
}

const ALIGN = { start: "text-start", center: "text-center", end: "text-end" } as const;

export function DataTable<T>({
  columns,
  data,
  rowKey,
  className,
  highlightRowKey,
}: DataTableProps<T>) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="bg-surface/60 border-b border-line">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-4.5 py-3.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400",
                  ALIGN[col.align ?? "start"]
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {data.map((row) => {
            const isHit = highlightRowKey != null && rowKey(row) === highlightRowKey;
            return (
            <tr
              key={rowKey(row)}
              ref={isHit ? (el) => el?.scrollIntoView({ block: "center", behavior: "smooth" }) : undefined}
              className={cn(
                "transition-colors duration-150 hover:bg-white/[0.04]",
                isHit && "bg-primary/15 outline outline-2 -outline-offset-2 outline-primary/60 shadow-glow-sm"
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "whitespace-nowrap px-4 py-3",
                    ALIGN[col.align ?? "start"],
                    col.className
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
