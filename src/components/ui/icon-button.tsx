import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/utils/cn";
import { LoadingSpinner } from "./loading-spinner";

type Variant = "ghost" | "solid" | "danger";

const VARIANTS: Record<Variant, string> = {
  ghost: "text-subtle hover:text-ink hover:bg-white/5",
  solid: "bg-panel border border-line-strong text-subtle hover:text-ink hover:border-white/20",
  danger: "text-red/80 hover:text-red hover:bg-red/10",
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  label: string;
  size?: "sm" | "md";
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = "ghost", label, size = "md", loading = false, className, children, disabled, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/50 disabled:pointer-events-none disabled:opacity-50",
        size === "md" ? "size-9" : "size-7",
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {loading ? <LoadingSpinner size="xs" /> : children}
    </button>
  )
);

IconButton.displayName = "IconButton";
