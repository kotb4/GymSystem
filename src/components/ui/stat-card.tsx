import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/utils/cn";
import { ACCENT_TINTS, type Accent } from "./accent";
import { Card } from "./card";

export interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  accent: Accent;
  subtitle?: string;
  delta?: string;
  deltaDir?: "up" | "down";
  trendLabel?: string;
}

export function StatCard({ title, value, icon, accent, subtitle, delta, deltaDir = "up", trendLabel }: StatCardProps) {
  const up = deltaDir === "up";

  return (
    <Card interactive className="p-4 sm:p-5 relative overflow-hidden group border-line bg-panel/95 hover:border-line-strong transition-all">
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden
          className={cn(
            "grid size-10 sm:size-11 place-items-center rounded-2xl border border-white/10 shadow-sm transition-transform duration-300 group-hover:scale-105",
            ACCENT_TINTS[accent]
          )}
        >
          {icon}
        </span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-[11px] font-bold tabnum border",
              up
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-glow-sm"
                : "bg-red/10 text-red border-red/20"
            )}
          >
            {up ? <ArrowUpRight className="size-3 sm:size-3.5" /> : <ArrowDownRight className="size-3 sm:size-3.5" />}
            {delta}
          </span>
        )}
      </div>

      <p className="mt-3 sm:mt-4 text-2xl sm:text-3xl font-black tracking-tight tabnum text-ink">{value}</p>
      
      <p className="mt-1 flex items-baseline gap-1.5 text-xs sm:text-sm text-subtle">
        <span className="font-semibold text-slate-300">{title}</span>
        {trendLabel && <span className="text-[10px] sm:text-[11px] text-faint font-normal">• {trendLabel}</span>}
      </p>
      {subtitle && <p className="mt-0.5 text-[10px] sm:text-[11px] font-semibold text-faint">{subtitle}</p>}
    </Card>
  );
}
