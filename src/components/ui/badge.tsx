import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

export type BadgeVariant =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "violet"
  | "neutral";

const VARIANTS: Record<BadgeVariant, string> = {
  success: "bg-neon/10 text-neon ring-neon/25",
  warning: "bg-amber/10 text-amber ring-amber/25",
  danger: "bg-red/10 text-red ring-red/25",
  info: "bg-cyan/10 text-cyan ring-cyan/25",
  violet: "bg-violet/10 text-violet ring-violet/25",
  neutral: "bg-white/5 text-subtle ring-white/10",
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
