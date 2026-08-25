import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({ interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-panel shadow-card",
        interactive && "transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong",
        className
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  action,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-5">
      <div>
        <h3 className="text-[15px] font-bold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-faint">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...rest} />;
}
