import { useState } from "react";
import { MessageCircle, Download, QrCode } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

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
  const qrUrl = api.cards.qrUrl(barcodeValue);

  async function sendNow() {
    if (!memberPhone) {
      toast("error", t("cards.qrNoPhoneToast"));
      return;
    }
    setSending(true);
    try {
      const delivery = await api.cards.queueDelivery(cardId);
      if (delivery.status === "pending") {
        const result = await api.cards.sendPendingDeliveries(50);
        if (result.notConfigured > 0) {
          toast("warning", t("cards.qrNotConfiguredToast"));
        } else if (result.failed > 0) {
          toast("warning", t("cards.qrFailedToast", { count: result.failed }));
        } else {
          toast("success", t("cards.qrSentToast"));
        }
      } else {
        toast("info", t("cards.qrAlreadySentToast"));
      }
      onClose();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSending(false);
    }
  }

  return (
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
  );
}