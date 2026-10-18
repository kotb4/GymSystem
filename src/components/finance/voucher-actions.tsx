import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { VoucherKind } from "@/core/services/vouchers.service";
import { Button } from "@/components/ui/button";

/**
 * Download / print the voucher for one operation (refund, debt repayment,
 * cash closing, attendance visit).
 *
 * Mirrors ReceiptActions, but the document is produced by the shared voucher
 * template. Whitelisting the kind here keeps the button set to the four types
 * the backend actually supports.
 */
const ALLOWED: readonly VoucherKind[] = ["refund", "store_debt_payment", "cash_closing", "attendance", "expense"];

export function VoucherActions({
  kind,
  rowId,
  size = "sm",
}: {
  kind: VoucherKind;
  rowId: string;
  size?: "sm" | "md";
}) {
  const t = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "download" | "print">(null);

  if (!ALLOWED.includes(kind)) return null;

  const generate = async (): Promise<{ fileName: string; base64: string } | null> => {
    try {
      return await api.vouchers.generateOperationVoucher(kind, rowId);
    } catch (err) {
      toast("error", describeError(err, t));
      return null;
    }
  };

  const openBlobUrl = (base64: string): string => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  };

  const download = async () => {
    setBusy("download");
    const doc = await generate();
    if (doc) {
      const url = openBlobUrl(doc.base64);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast("success", t("pdf.downloadedToast"));
    }
    setBusy(null);
  };

  const print = async () => {
    setBusy("print");
    const doc = await generate();
    if (doc) {
      const url = openBlobUrl(doc.base64);
      let printed = false;
      const frame = document.createElement("iframe");
      frame.style.display = "none";
      frame.src = url;
      document.body.appendChild(frame);

      const triggerPrint = () => {
        if (printed) return;
        printed = true;
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          window.open(url, "_blank");
        }
      };

      frame.onload = () => triggerPrint();
      window.setTimeout(() => {
        if (!printed) triggerPrint();
      }, 1000);
      window.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    }
    setBusy(null);
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size={size}
        onClick={() => void download()}
        loading={busy === "download"}
        disabled={busy !== null}
      >
        <Download className="size-3.5" />
        {t("voucher.download")}
      </Button>
      <Button
        variant="ghost"
        size={size}
        onClick={() => void print()}
        loading={busy === "print"}
        disabled={busy !== null}
      >
        <Printer className="size-3.5" />
        {t("voucher.print")}
      </Button>
    </div>
  );
}
