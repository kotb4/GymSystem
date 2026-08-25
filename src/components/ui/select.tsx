import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  label?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, label, className, id, ...rest }, ref) => {
    const selectId = id ?? (label ? `sel-${label.replace(/\s/g, "-")}` : undefined);
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="block text-[13px] font-semibold text-subtle">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "h-10 w-full cursor-pointer appearance-none rounded-xl border border-line bg-panel ps-3.5 pe-9 text-sm text-ink outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15",
              className
            )}
            {...rest}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute inset-y-0 end-0 my-auto me-3 size-4 text-faint" />
        </div>
      </div>
    );
  }
);

Select.displayName = "Select";
