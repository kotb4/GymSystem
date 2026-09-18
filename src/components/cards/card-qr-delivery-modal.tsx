import { useState } from "react";
import { MessageCircle, Download, QrCode } from "lucide-react";
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
  const qrUrl = api.cards.qrUrl(barcodeValue);

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
            <a href={qrUrl} download={`card-qr-${barcodeValue}.png`} className="flex-1">
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
          <img
            src={qrUrl}
            alt={barcodeValue}
            className="w-48 rounded-xl border border-line bg-white p-2"
          />
          <div dir="ltr" className="font-mono text-sm font-bold tracking-wider text-ink">
            {barcodeValue}
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