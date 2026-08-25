import type { InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/utils/cn";

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  value: string;
  onValueChange: (value: string) => void;
}

export function SearchInput({ value, onValueChange, className, ...rest }: SearchInputProps) {
  const t = useT();
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-0 my-auto ms-3.5 size-4 text-faint" />
      <input
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(
          "h-10 w-full rounded-xl border border-line bg-panel ps-10 pe-9 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15 [&::-webkit-search-cancel-button]:hidden",
          className
        )}
        {...rest}
      />
      {value && (
        <button
          type="button"
          aria-label={t("common.clear")}
          onClick={() => onValueChange("")}
          className="absolute inset-y-0 end-0 grid w-9 place-items-center text-faint transition-colors hover:text-subtle"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
