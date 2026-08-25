import { useEffect, useRef, useState, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface DropdownProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "end";
  widthClass?: string;
  contentClassName?: string;
}

export function Dropdown({ trigger, children, align = "end", widthClass = "min-w-[210px]", contentClassName }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
        onClick: () => setOpen((v) => !v),
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })
    : trigger;

  return (
    <div ref={rootRef} className="relative">
      {triggerEl}
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cn(
            "absolute top-[calc(100%+8px)] animate-pop rounded-xl border border-line-strong bg-raised p-1.5 shadow-pop",
            align === "start" ? "start-0" : "end-0",
            widthClass,
            contentClassName
          )}
          style={{ zIndex: "var(--z-dropdown)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface DropdownItemProps {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
}

export function DropdownItem({ icon, label, danger, onClick, trailing }: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
        danger
          ? "text-red hover:bg-red/10"
          : "text-subtle hover:bg-white/5 hover:text-ink"
      )}
    >
      {icon && <span aria-hidden className="shrink-0 [&>svg]:size-4">{icon}</span>}
      <span className="flex-1 text-start">{label}</span>
      {trailing}
    </button>
  );
}

export function DropdownDivider() {
  return <div role="separator" className="my-1.5 h-px bg-line" />;
}
