import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

export interface DropdownProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "end";
  widthClass?: string;
  contentClassName?: string;
}

export function Dropdown({
  trigger,
  children,
  align = "end",
  widthClass = "min-w-[210px]",
  contentClassName,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const updatePosition = () => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const isRtl = document.documentElement.dir === "rtl" || document.dir === "rtl";

    // Estimate or measure menu dimensions
    const menuEl = menuRef.current;
    const menuWidth = menuEl?.offsetWidth ?? 220;
    const menuHeight = menuEl?.offsetHeight ?? 260;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Vertical positioning: prefer bottom, flip to top if insufficient space
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placeTop = spaceBelow < menuHeight + 12 && spaceAbove > spaceBelow;

    let top = placeTop ? rect.top - menuHeight - 8 : rect.bottom + 8;
    if (top < 8) top = 8;
    if (top + menuHeight > viewportHeight - 8) {
      top = Math.max(8, viewportHeight - menuHeight - 8);
    }

    // Horizontal positioning: align 'start' or 'end' taking RTL into account
    let left: number;
    if (isRtl) {
      // In RTL:
      // align === "start" aligns right edge with trigger's right edge
      // align === "end" aligns left edge with trigger's left edge (or right edge to trigger's left edge)
      if (align === "end") {
        left = rect.left;
        if (left + menuWidth > viewportWidth - 8) {
          left = Math.max(8, viewportWidth - menuWidth - 8);
        }
      } else {
        left = rect.right - menuWidth;
        if (left < 8) left = 8;
      }
    } else {
      if (align === "end") {
        left = rect.right - menuWidth;
        if (left < 8) left = 8;
      } else {
        left = rect.left;
        if (left + menuWidth > viewportWidth - 8) {
          left = Math.max(8, viewportWidth - menuWidth - 8);
        }
      }
    }

    setMenuStyle({
      position: "fixed",
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      zIndex: "var(--z-dropdown)",
    });
  };

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScrollOrResize = () => {
      updatePosition();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger as React.ReactElement<Record<string, unknown>>, {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          setOpen((v) => !v);
        },
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })
    : trigger;

  return (
    <div ref={rootRef} className="relative inline-block">
      {triggerEl}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={() => setOpen(false)}
            className={cn(
              "max-w-[calc(100vw-1.5rem)] animate-pop rounded-xl border border-line-strong bg-raised p-1.5 shadow-pop",
              widthClass,
              contentClassName
            )}
            style={menuStyle}
          >
            {children}
          </div>,
          document.body
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
