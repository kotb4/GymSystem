import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

const baseControl =
  "h-10 w-full rounded-xl border bg-panel px-3.5 text-sm text-ink placeholder:text-faint transition-colors duration-150 outline-none focus:ring-2 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className, id, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const errorId = `${inputId}-error`;
    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-[13px] font-semibold text-subtle">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span aria-hidden className="pointer-events-none absolute inset-y-0 start-0 grid w-10 place-items-center text-faint">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              baseControl,
              "focus:border-neon/60 focus:ring-neon/15",
              icon ? "ps-10" : undefined,
              error && "border-red/60 focus:border-red/60 focus:ring-red/15",
              className
            )}
            {...rest}
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-xs font-semibold text-red">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
