import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

export type BadgeVariant =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "violet"
  | "primary"
  | "neutral";

const VARIANTS: Record<BadgeVariant, string> = {
  success: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  warning: "bg-amber/10 text-amber ring-amber/20",
  danger: "bg-red/10 text-red ring-red/20",
  info: "bg-cyan/10 text-cyan ring-cyan/20",
  violet: "bg-violet/10 text-violet ring-violet/20",
  primary: "bg-primary/10 text-primary ring-primary/25",
  neutral: "bg-white/[0.05] text-subtle ring-white/10",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

export function Badge({
  variant = "neutral",
  dot = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
