import { cn } from "@/utils/cn";

export interface TooltipProps {
  content: string;
  side?: "top" | "bottom" | "start" | "end";
  className?: string;
  children: React.ReactNode;
}

const SIDE_CLASSES = {
  top: "bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2",
  bottom: "top-[calc(100%+8px)] left-1/2 -translate-x-1/2",
  end: "top-1/2 -translate-y-1/2 end-[calc(100%+10px)]",
  start: "top-1/2 -translate-y-1/2 start-[calc(100%+10px)]",
} as const;

export function Tooltip({ content, side = "top", className, children }: TooltipProps) {
  if (!content) return <>{children}</>;
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-[400] whitespace-nowrap rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 shadow-pop transition-opacity delay-100 duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          SIDE_CLASSES[side]
        )}
      >
        {content}
      </span>
    </span>
  );
}
