import { useState } from "react";
import { Download, FileText, Printer, Send } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Download / print / WhatsApp-send the PDF receipt for one payment.
 * The PDF itself is produced by the backend (src/core/pdf) so the bytes are
 * identical whether the user saves it or the member receives it.
 */
export function ReceiptActions({
  paymentId,
  size = "sm",
}: {
  paymentId: string;
  size?: "sm" | "md";
}) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "download" | "print" | "send">(null);
  const [confirmSend, setConfirmSend] = useState(false);

  if (!hasPermission("pdf.receipt")) return null;

  const generate = async (): Promise<{ fileName: string; base64: string } | null> => {
    try {
      return await api.pdf.generatePaymentReceipt(paymentId);
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

      frame.onload = () => {
        triggerPrint();
      };

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

  const send = async () => {
    setConfirmSend(false);
    setBusy("send");
    try {
      const res = await api.pdf.sendPaymentReceipt(paymentId);
      const delivery = res.delivery;
      if (delivery.status === "sent") {
        toast("success", t("pdf.sentToast"));
      } else if (delivery.status === "not_configured") {
        toast("warning", t("pdf.notConfiguredToast"));
      } else if (delivery.status === "no_phone") {
        toast("warning", t("pdf.noPhoneToast"));
      } else {
        toast("error", t("pdf.failedToast", { error: delivery.error ?? "" }));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size={size} onClick={() => void download()} loading={busy === "download"} disabled={busy !== null}>
          <Download className="size-3.5" />
          {t("pdf.receiptDownload")}
        </Button>
        <Button variant="ghost" size={size} onClick={() => void print()} loading={busy === "print"} disabled={busy !== null}>
          <Printer className="size-3.5" />
          {t("pdf.receiptPrint")}
        </Button>
        <Button variant="ghost" size={size} onClick={() => setConfirmSend(true)} disabled={busy !== null} title={t("pdf.receiptSend")}>
          {busy === "send" ? <FileText className="size-3.5" /> : <Send className="size-3.5 text-neon" />}
          {busy === "send" ? t("pdf.receiptSending") : t("pdf.receiptSend")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        title={t("pdf.receiptTitle")}
        message={t("pdf.receiptSendConfirm")}
        confirmLabel={t("pdf.receiptSend")}
        onConfirm={() => void send()}
      />
    </>
  );
}
