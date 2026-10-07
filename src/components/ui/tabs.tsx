import { cn } from "@/utils/cn";

export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn("inline-flex max-w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-line bg-surface/80 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden backdrop-blur-sm", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-lg px-4 py-1.5 text-[13px] font-bold transition-all duration-150",
              active
                ? "bg-primary text-white shadow-glow-sm"
                : "text-subtle hover:bg-white/[0.05] hover:text-ink"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
