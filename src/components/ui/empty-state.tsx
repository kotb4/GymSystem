import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-2xl border border-line bg-surface text-faint [&>svg]:size-6"
      >
        {icon}
      </span>
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-subtle">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

