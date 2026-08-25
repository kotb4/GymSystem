import { cn } from "@/utils/cn";
import { useT } from "@/i18n";

const SIZES = {
  xs: "size-3.5 border-2",
  sm: "size-[18px] border-2",
  md: "size-6 border-2",
  lg: "size-8 border-[3px]",
} as const;

interface LoadingSpinnerProps {
  size?: keyof typeof SIZES;
  className?: string;
}

export function LoadingSpinner({ size = "sm", className }: LoadingSpinnerProps) {
  const t = useT();
  return (
    <span
      role="status"
      aria-label={t("common.loading")}
      className={cn(
        "inline-block animate-spin rounded-full border-current border-t-transparent align-middle",
        SIZES[size],
        className
      )}
    />
  );
}
