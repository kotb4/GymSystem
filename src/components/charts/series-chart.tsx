import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import { formatNumber } from "@/services/format";

export interface SeriesDataset {
  label: string;
  color: string;
  points: Array<{ label: string; value: number }>;
}

export interface SeriesChartProps {
  series: SeriesDataset[];
  className?: string;
}

const W = 600;
const H = 200;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const scaled = v / pow;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * pow;
}

function visibleIndices(n: number): number[] {
  if (n <= 10) return Array.from({ length: n }, (_, i) => i);
  if (n <= 16) return Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === n % 2);
  const idx = new Set<number>([0, 6, 12, 18, 24]);
  idx.add(n - 1);
  return [...idx].sort((a, b) => a - b).filter((i) => i < n);
}

export function SeriesChart({ series, className }: SeriesChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const n = series[0]?.points.length ?? 0;
  const maxValue = useMemo(
    () => Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value))),
    [series],
  );
  const yMax = useMemo(() => niceMax(Math.ceil(maxValue * 1.15)), [maxValue]);

  const groupBand = n > 0 ? W / n : W;
  const innerW = (groupBand / 2) * Math.min(series.length, 2);
  const barW = series.length > 1 ? innerW * 0.6 : groupBand * 0.5;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    setHover(n > 0 ? Math.min(n - 1, Math.floor(pct * n)) : null);
  };

  const shown = visibleIndices(n);

  if (n === 0) {
    return (
      <p className="py-8 text-center text-sm text-faint">
        {series.length === 0 ? "" : "\u2014"}
      </p>
    );
  }

  return (
    <div dir="ltr" className={cn("flex gap-3", className)}>
      <div className="relative w-12 shrink-0 select-none" style={{ height: H }} aria-hidden>
        <div className="absolute inset-y-0 flex w-full flex-col justify-between text-end text-[10px] font-semibold text-faint tabnum">
          <span>{formatNumber(yMax)}</span>
          <span>{formatNumber(yMax / 2)}</span>
          <span>0</span>
        </div>
      </div>

      <div className="relative min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-[200px] w-full"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 50, 100, 150, 200].map((y) => (
            <line key={y} x1={0} x2={W} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
          ))}

          {series.map((s, si) =>
            s.points.map((p, i) => {
              const h = (p.value / yMax) * H;
              const cx = i * groupBand + groupBand / 2;
              const x = cx - (series.length > 1 ? barW * series.length / 2 : barW / 2) + (si - (series.length - 1) / 2) * (barW + 2);
              return (
                <rect
                  key={`${si}-${i}`}
                  x={x}
                  y={H - h}
                  width={barW}
                  height={Math.max(h, 2)}
                  rx={3}
                  fill={s.color}
                  opacity={hover === null || hover === i ? 1 : 0.5}
                  style={{ transition: "opacity 120ms ease" }}
                />
              );
            }),
          )}
        </svg>

        {hover !== null && hover < n && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 shadow-pop"
            style={{ left: `${((hover + 0.5) / n) * 100}%`, top: "calc(-4px)" }}
          >
            <p className="whitespace-nowrap text-[11px] font-semibold text-subtle">
              {series[0]?.points[hover]?.label}
            </p>
            {series.map((s) => (
              <p key={s.label} className="whitespace-nowrap text-sm font-extrabold leading-tight tabnum" style={{ color: s.color }}>
                {s.label}: {formatNumber(s.points[hover]?.value ?? 0)}
              </p>
            ))}
          </div>
        )}

        <div
          dir="ltr"
          className="mt-2 grid select-none"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {series[0].points.map((p, i) => (
            <span
              key={i}
              className={cn(
                "overflow-visible whitespace-nowrap text-center text-[10px] font-semibold tabnum",
                shown.includes(i) ? "text-faint" : "invisible",
                hover === i && "text-neon",
              )}
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
