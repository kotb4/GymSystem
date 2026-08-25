import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/utils/cn";

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...rest }, ref) => {
    const t = useT();
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn(
            "h-10 w-full rounded-xl border border-line bg-panel px-3.5 pe-11 text-sm text-ink placeholder:text-faint transition-colors duration-150 outline-none focus:border-neon/60 focus:ring-2 focus:ring-neon/15",
            className
          )}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
          className="absolute inset-y-0 end-0 grid w-10 place-items-center text-faint transition-colors hover:text-subtle"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";
