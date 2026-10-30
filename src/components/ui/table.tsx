import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollStart, setCanScrollStart] = useState(false);
  const [canScrollEnd, setCanScrollEnd] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;

    if (maxScroll <= 2) {
      setCanScrollStart(false);
      setCanScrollEnd(false);
      return;
    }

    const isRtl = document.dir === "rtl" || getComputedStyle(el).direction === "rtl";

    if (isRtl) {
      const abs = Math.abs(scrollLeft);
      setCanScrollStart(abs > 2);
      setCanScrollEnd(abs < maxScroll - 2);
    } else {
      setCanScrollStart(scrollLeft > 2);
      setCanScrollEnd(scrollLeft < maxScroll - 2);
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();

    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(checkScroll);
      ro.observe(el);
    }

    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
      ro?.disconnect();
    };
  }, [checkScroll, data, columns]);

  return (
    <div className={cn("relative w-full overflow-hidden rounded-xl border border-line/60 bg-panel/30", className)}>
      {/* Scroll indicator - Start (Right in RTL) */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 end-0 z-20 w-6 bg-gradient-to-l from-panel/90 to-transparent transition-opacity duration-200",
          canScrollStart ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Scroll indicator - End (Left in RTL) */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 start-0 z-20 w-6 bg-gradient-to-r from-panel/90 to-transparent transition-opacity duration-200",
          canScrollEnd ? "opacity-100" : "opacity-0"
        )}
      />

      <div
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label="جدول البيانات"
        className="w-full overflow-x-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-neon/40 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent]"
      >
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="sticky top-0 z-10 bg-surface/90 backdrop-blur-md border-b border-line">
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
    </div>
  );
}
