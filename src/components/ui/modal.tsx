import { useEffect, useId, useRef } from "react";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          // fallback if already open
        }
      }
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (!dialog.contains(document.activeElement)) {
      dialog.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (dialog && dialog.open && typeof dialog.close === "function") {
        try {
          dialog.close();
        } catch {
          // ignore
        }
      }
    };
  }, [open]);

  // Handle native cancel event (Esc key)
  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onCloseRef.current();
  };

  // Light-dismiss fallback for clicking outside dialog bounds
  const handleClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (e.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      const isInside =
        rect.top <= e.clientY &&
        e.clientY <= rect.bottom &&
        rect.left <= e.clientX &&
        e.clientX <= rect.right;
      if (!isInside) {
        onCloseRef.current();
      }
    }
  };

  if (!open) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      onClick={handleClick}
      aria-labelledby={title ? titleId : undefined}
      aria-modal="true"
      {...({ closedby: "any" } as any)}
      className={cn(
        "fixed inset-0 m-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-raised p-0 text-foreground shadow-pop outline-none animate-pop",
        "backdrop:bg-black/65 backdrop:backdrop-blur-sm backdrop:animate-fade-in",
        "[overscroll-behavior:contain]",
        widthClass
      )}
      style={{ zIndex: "var(--z-modal)" }}
    >
      {title && (
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
          <h2 id={titleId} className="text-base font-bold text-foreground">
            {title}
          </h2>
          <IconButton label={t("common.close")} onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent]">
        {children}
      </div>
      {footer && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3.5 sm:px-5 sm:py-4">
          {footer}
        </div>
      )}
    </dialog>,
    document.body
  );
}
