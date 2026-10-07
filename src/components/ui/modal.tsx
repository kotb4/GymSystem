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

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Only focus the panel if no element inside it is already focused
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);


  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 grid place-items-center p-3 sm:p-4" style={{ zIndex: "var(--z-modal)" }}>
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-pop outline-none animate-pop",
          widthClass
        )}
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
            <h2 className="text-base font-bold">{title}</h2>
            <IconButton label={t("common.close")} onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3.5 sm:px-5 sm:py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
