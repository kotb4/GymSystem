import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/utils/cn";
import { Button } from "./button";
import { Modal } from "./modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  icon?: ReactNode;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone = "danger",
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} widthClass="max-w-sm">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl",
            tone === "danger" ? "bg-red/10 text-red" : "bg-neon/10 text-neon"
          )}
        >
          <AlertTriangle className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-subtle">{message}</p>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-2.5">
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
          {confirmLabel ?? t("common.confirm")}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {t("common.cancel")}
        </Button>
      </div>
    </Modal>
  );
}
