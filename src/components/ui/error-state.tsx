import type { ReactNode } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "./button";

export interface ErrorStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ icon, title, description, retryLabel, onRetry, className }: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-2xl border border-red/25 bg-red/10 text-red [&>svg]:size-6"
      >
        {icon ?? <WifiOff />}
      </span>
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-subtle">{description}</p>
        )}
      </div>
      {onRetry && retryLabel && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw aria-hidden className="size-3.5" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
