import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import type { ChartDataset, ChartPoint } from "@/types";
import { formatNumber } from "@/services/format";

interface AttendanceChartProps {
  dataset: ChartDataset;
}

const W = 600;
const H = 200;

function niceMax(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  const scaled = v / pow;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * pow;
}

function visibleIndices(n: number): number[] {
  if (n <= 10) return Array.from({ length: n }, (_, i) => i);
  if (n <= 16)
    return Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === n % 2);
  const idx = new Set<number>([0, 6, 12, 18, 24]);
  idx.add(n - 1);
  return [...idx].sort((a, b) => a - b).filter((i) => i < n);
}

export function AttendanceChart({ dataset }: AttendanceChartProps) {
  const { points, mode } = dataset;
  const [hover, setHover] = useState<number | null>(null);

  const maxValue = useMemo(() => Math.max(...points.map((p) => p.value)), [points]);
  const yMax = useMemo(() => niceMax(Math.ceil(maxValue * 1.15)), [maxValue]);

  const xOf = (i: number) =>
    mode === "bars" ? ((i + 0.5) / points.length) * W : (i / (points.length - 1)) * W;
  const yOf = (v: number) => H - (v / yMax) * H;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(p.value)}`).join(" ");
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

  const barBand = W / points.length;
  const barW = barBand * 0.55;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (mode === "bars") {
      setHover(Math.min(points.length - 1, Math.floor(pct * points.length)));
    } else {
      const raw = Math.round(pct * (points.length - 1));
      setHover(Math.max(0, Math.min(points.length - 1, raw)));
    }
  };

  const hoverPoint: ChartPoint | null = hover !== null ? points[hover] : null;
  const hoverLeftPct =
    hover !== null ? ((mode === "bars" ? (hover + 0.5) / points.length : hover / (points.length - 1)) * 100).toFixed(2) : "0";
  const hoverTopPct = hoverPoint ? (1 - hoverPoint.value / yMax).toFixed(2) : "0";

  const shown = visibleIndices(points.length);

  return (
    <div dir="ltr" className="flex gap-3">
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
          <defs>
            <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#39FF88" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#39FF88" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="chart-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#39FF88" />
              <stop offset="100%" stopColor="#39FF88" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {[0, 50, 100, 150, 200].map((y) => (
            <line
              key={y}
              x1={0}
              x2={W}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={1}
            />
          ))}

          {mode === "bars"
            ? points.map((p, i) => {
                const h = (p.value / yMax) * H;
                return (
                  <rect
                    key={i}
                    x={i * barBand + (barBand - barW) / 2}
                    y={H - h}
                    width={barW}
                    height={Math.max(h, 2)}
                    rx={4}
                    fill="url(#chart-bar)"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                    style={{ transition: "opacity 120ms ease" }}
                  />
                );
              })
            : (
              <>
                <path d={areaPath} fill="url(#chart-area)" />
                <path
                  d={linePath}
                  fill="none"
                  stroke="#39FF88"
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {points.map((p, i) => (
                  <circle
                    key={i}
                    cx={xOf(i)}
                    cy={yOf(p.value)}
                    r={hover === i ? 5 : 3}
                    fill="#0D111A"
                    stroke="#39FF88"
                    strokeWidth={2}
                  />
                ))}
              </>
            )}
        </svg>

        {hoverPoint && hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 shadow-pop"
            style={{ left: `${hoverLeftPct}%`, top: `calc(${hoverTopPct} * 200px - 8px)` }}
          >
            <p className="whitespace-nowrap text-[11px] font-semibold text-subtle">{hoverPoint.label}</p>
            <p className="text-sm font-extrabold leading-none tabnum">
              {formatNumber(hoverPoint.value)}
            </p>
          </div>
        )}

        <div
          dir="ltr"
          className="mt-2 grid select-none"
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        >
          {points.map((p, i) => (
            <span
              key={i}
              className={cn(
                "overflow-visible whitespace-nowrap text-center text-[10px] font-semibold tabnum",
                shown.includes(i) ? "text-faint" : "invisible",
                hover === i && "text-neon"
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
