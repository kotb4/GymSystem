import type { InputHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/utils/cn";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children?: ReactNode;
}

export function Checkbox({ checked, onCheckedChange, children, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn("inline-flex cursor-pointer select-none items-center gap-2.5", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
        {...rest}
      />
      <span
        aria-hidden
        className="grid size-[18px] place-items-center rounded-md border border-line-strong bg-panel transition-colors peer-checked:border-neon peer-checked:bg-neon peer-focus-visible:ring-2 peer-focus-visible:ring-neon/50"
      >
        <Check className={cn("size-3 text-neon-ink transition-opacity", checked ? "opacity-100" : "opacity-0")} strokeWidth={3.5} />
      </span>
      {children && <span className="text-sm text-subtle">{children}</span>}
    </label>
  );
}
