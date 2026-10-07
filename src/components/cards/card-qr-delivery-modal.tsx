import { useState, useEffect } from "react";
import { MessageCircle, Download, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  open: boolean;
  memberName: string;
  memberPhone: string | null;
  barcodeValue: string;
  cardId: string;
  onClose: () => void;
}

export function CardQrDeliveryModal({ open, memberName, memberPhone, barcodeValue, cardId, onClose }: Props) {
  const t = useT();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string>("");

  useEffect(() => {
    let active = true;
    if (!barcodeValue) return;

    async function generateCardImage() {
      try {
        const qrWidth = 480;
        const qrDataUrl = await QRCode.toDataURL(barcodeValue, {
          width: qrWidth,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        });

        // If in browser environment with Canvas, draw composite card with credit
        if (typeof document !== "undefined") {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            if (!active) return;
            const barcodeText = barcodeValue.trim().toUpperCase();
            const creditLabel = "System by : ";
            const creditName = "Yassen Mohamed Kotb | 01288536381";

            const canvas = document.createElement("canvas");
            canvas.width = qrWidth;
            canvas.height = qrWidth + 64; // Extra space for barcode and developer credit

            const ctx = canvas.getContext("2d");
            if (!ctx) {
              if (active) setDataUrl(qrDataUrl);
              return;
            }

            // White background
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw QR code
            ctx.drawImage(img, 0, 0, qrWidth, qrWidth);

            // Draw barcode text (bold mono, centered)
            ctx.fillStyle = "#0f172a";
            ctx.font = "bold 20px monospace, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(barcodeText, qrWidth / 2, qrWidth + 18);

            // Draw developer credit (System by : in gray, Name in bold black)
            ctx.font = "13px system-ui, -apple-system, sans-serif";
            const labelWidth = ctx.measureText(creditLabel).width;
            ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
            const nameWidth = ctx.measureText(creditName).width;
            const totalCreditWidth = labelWidth + nameWidth;
            const startX = (qrWidth - totalCreditWidth) / 2;
            const creditY = qrWidth + 44;

            ctx.textAlign = "left";
            ctx.font = "13px system-ui, -apple-system, sans-serif";
            ctx.fillStyle = "#64748b"; // Slate 500
            ctx.fillText(creditLabel, startX, creditY);

            ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
            ctx.fillStyle = "#000000"; // Black
            ctx.fillText(creditName, startX + labelWidth, creditY);

            setDataUrl(canvas.toDataURL("image/png"));
          };
          img.onerror = () => {
            if (active) setDataUrl(qrDataUrl);
          };
          img.src = qrDataUrl;
        } else {
          if (active) setDataUrl(qrDataUrl);
        }
      } catch (err) {
        console.error("Failed to generate QR data URL:", err);
      }
    }

    void generateCardImage();

    return () => {
      active = false;
    };
  }, [barcodeValue]);

  const qrSrc = dataUrl || api.cards.qrUrl(barcodeValue);

  async function doSend(force: boolean) {
    if (!memberPhone) {
      toast("error", t("cards.qrNoPhoneToast"));
      return false;
    }
    setSending(true);
    try {
      const delivery = await api.cards.queueDelivery(cardId, force);
      if (delivery.status === "pending") {
        const result = await api.cards.sendPendingDeliveries(50);
        if (result.notConfigured > 0) {
          toast("warning", t("cards.qrNotConfiguredToast"));
        } else if (result.failed > 0) {
          toast("warning", t("cards.qrFailedToast", { count: result.failed }));
        } else {
          toast("success", t("cards.qrSentToast"));
        }
        onClose();
        return true;
      }
      return false;
    } catch (err) {
      toast("error", describeError(err, t));
      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendNow() {
    const accepted = await doSend(false);
    if (!accepted) setResendOpen(true);
  }

  async function confirmResend() {
    setResendOpen(false);
    await doSend(true);
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t("cards.qrPreviewTitle")}
        widthClass="max-w-sm"
        footer={
          <>
            <a href={qrSrc} download={`card-qr-${barcodeValue}.png`} className="flex-1">
              <Button type="button" variant="secondary" className="w-full">
                <Download className="size-4" />
                {t("cards.downloadQr")}
              </Button>
            </a>
            <Button type="button" className="flex-1" onClick={() => void sendNow()} loading={sending} disabled={sending}>
              <MessageCircle className="size-4" />
              {t("cards.sendQr")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm font-bold text-ink">{memberName}</p>
          <div className="relative flex w-full max-w-[260px] items-center justify-center rounded-2xl border border-line bg-white p-2.5 shadow-sm">
            {qrSrc ? (
              <img
                src={qrSrc}
                alt={barcodeValue}
                className="w-full rounded-xl object-contain"
              />
            ) : (
              <div className="flex size-52 items-center justify-center">
                <QrCode className="size-12 animate-pulse text-muted" />
              </div>
            )}
          </div>
          <p className="text-center text-xs text-faint">
            {memberPhone ? t("cards.qrHint") : t("cards.qrNoPhoneToast")}
          </p>
          <div className="flex items-center gap-1 text-[11px] text-faint">
            <QrCode className="size-3.5" />
            <span>{t("cards.pacingHint")}</span>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={resendOpen}
        title={t("cards.resentTitle")}
        message={t("cards.resentMessage")}
        confirmLabel={t("cards.resentConfirm")}
        tone="primary"
        loading={sending}
        onConfirm={() => void confirmResend()}
        onClose={() => setResendOpen(false)}
      />
    </>
  );
}