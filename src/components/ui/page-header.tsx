import React from "react";
import { cn } from "@/utils/cn";

export interface PageHeaderProps {
  icon?: React.ElementType<{ className?: string }>;
  title: string;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  iconClassName?: string;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  badge,
  actions,
  className,
  iconClassName,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-[0_0_18px_rgba(var(--primary-rgb),0.15)] backdrop-blur-md transition-transform duration-200 hover:scale-105",
              iconClassName,
            )}
          >
            <Icon className="size-5.5" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-black text-ink tracking-tight">
              {title}
            </h1>
            {badge && (
              <div className="inline-flex items-center">
                {badge}
              </div>
            )}
          </div>
          {subtitle && (
            <div className="text-xs sm:text-[13px] text-subtle mt-0.5 leading-relaxed">
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {actions}
        </div>
      )}
    </div>
  );
}
