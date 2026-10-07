import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import { LoadingSpinner } from "./loading-spinner";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANTS = {
  primary:
    "bg-primary text-white font-bold hover:bg-primary-hover active:scale-[0.98] shadow-glow-sm focus-visible:ring-primary/60",
  secondary:
    "bg-panel border border-line text-ink hover:bg-raised hover:border-line-strong active:scale-[0.98] focus-visible:ring-primary/50",
  ghost: "text-subtle hover:text-ink hover:bg-white/[0.05] active:scale-[0.98] focus-visible:ring-primary/50",
  danger:
    "bg-red/15 border border-red/30 text-red hover:bg-red/25 active:scale-[0.98] focus-visible:ring-red/50",
} as const;

const SIZES = {
  sm: "h-8 gap-1.5 px-3 text-xs rounded-lg",
  md: "h-10 gap-2 px-4 text-sm rounded-xl",
  lg: "h-11 gap-2 px-5 text-sm rounded-xl",
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      icon,
      loading = false,
      fullWidth = false,
      className,
      children,
      disabled,
      ...rest
    },
    ref
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-base disabled:pointer-events-none disabled:opacity-55",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    >
      {loading ? <LoadingSpinner size="sm" /> : icon}
      {children}
    </button>
  )
);

Button.displayName = "Button";
