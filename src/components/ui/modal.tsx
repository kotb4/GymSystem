import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n";
import { cn } from "@/utils/cn";
import { IconButton } from "./icon-button";
import { X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  widthClass?: string;
}

export function Modal({ open, onClose, title, children, footer, widthClass }: ModalProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 grid place-items-center p-4" style={{ zIndex: "var(--z-modal)" }}>
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn("relative w-full max-w-md animate-pop rounded-2xl border border-line bg-raised shadow-pop outline-none", widthClass)}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-bold">{title}</h2>
            <IconButton label={t("common.close")} onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && (
          <div className="flex items-center gap-2 border-t border-line px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
