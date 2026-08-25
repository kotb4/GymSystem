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
    <Card interactive className="p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden
          className={cn("grid size-10 place-items-center rounded-xl", ACCENT_TINTS[accent])}
        >
          {icon}
        </span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold tabnum",
              up ? "bg-neon/10 text-neon" : "bg-red/10 text-red"
            )}
          >
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {delta}
          </span>
        )}
      </div>
      <p className="mt-4 text-3xl font-extrabold tracking-tight tabnum">{value}</p>
      <p className="mt-1 flex items-baseline gap-1.5 text-sm text-subtle">
        <span>{title}</span>
        {trendLabel && <span className="text-[11px] text-faint">• {trendLabel}</span>}
      </p>
      {subtitle && <p className="mt-0.5 text-[11px] font-semibold text-faint">{subtitle}</p>}
    </Card>
  );
}
