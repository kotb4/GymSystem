import { useState, useEffect } from "react";
import { MessageCircle, Download, QrCode, Copy, Check, Users, ExternalLink } from "lucide-react";
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
  memberId?: string;
  onClose: () => void;
}

export function CardQrDeliveryModal({ open, memberName, memberPhone, barcodeValue, cardId, memberId, onClose }: Props) {
  const t = useT();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [portalUrl, setPortalUrl] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [liveCount, setLiveCount] = useState<number | null>(null);

  // Generate Card Barcode QR image
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

        if (typeof document !== "undefined") {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            if (!active) return;
            const barcodeText = barcodeValue.trim().toUpperCase();
            const creditLabel = "Powered by ";
            const creditName = "GymGate — KOTB Digital Solutions";

            const canvas = document.createElement("canvas");
            canvas.width = qrWidth;
            canvas.height = qrWidth + 64;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
              if (active) setDataUrl(qrDataUrl);
              return;
            }

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, qrWidth, qrWidth);

            ctx.fillStyle = "#0f172a";
            ctx.font = "bold 20px monospace, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(barcodeText, qrWidth / 2, qrWidth + 18);

            ctx.font = "13px system-ui, -apple-system, sans-serif";
            const labelWidth = ctx.measureText(creditLabel).width;
            ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
            const nameWidth = ctx.measureText(creditName).width;
            const totalCreditWidth = labelWidth + nameWidth;
            const startX = (qrWidth - totalCreditWidth) / 2;
            const creditY = qrWidth + 44;

            ctx.textAlign = "left";
            ctx.font = "13px system-ui, -apple-system, sans-serif";
            ctx.fillStyle = "#64748b";
            ctx.fillText(creditLabel, startX, creditY);

            ctx.font = "bold 13px system-ui, -apple-system, sans-serif";
            ctx.fillStyle = "#000000";
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

  // Load Member Portal link with live occupancy count
  useEffect(() => {
    let active = true;
    if (!open) return;

    async function loadPortal() {
      try {
        if (memberId) {
          const res = await api.memberPortal.getUrl(
            memberId,
            typeof window !== "undefined" ? window.location.origin : undefined,
          );
          if (active && res) {
            setPortalUrl(res.url);
            setLiveCount(res.liveOccupancy);
          }
        } else if (barcodeValue) {
          const fallback = `${window.location.origin}/#/portal?code=${encodeURIComponent(barcodeValue)}`;
          if (active) setPortalUrl(fallback);
        }
      } catch {
        if (barcodeValue && active) {
          setPortalUrl(`${window.location.origin}/#/portal?code=${encodeURIComponent(barcodeValue)}`);
        }
      }
    }

    void loadPortal();

    return () => {
      active = false;
    };
  }, [open, memberId, barcodeValue]);

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
        if (result.sent > 0) {
          toast("success", t("cards.qrSentToast"));
        } else if (result.notConfigured > 0) {
          toast("warning", "خدمة الواتساب غير مفعلة في الإعدادات");
        } else if (result.failed > 0) {
          toast("error", "فشل إرسال البطاقة عبر الواتساب — يرجى التأكد من تشغيل البوابة");
        } else {
          toast("info", "لم يتم إرسال أي بطاقة");
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

  const handleCopyPortal = async () => {
    let url = portalUrl;
    if (!url && memberId) {
      try {
        const res = await api.memberPortal.getUrl(memberId, window.location.origin);
        if (res?.url) {
          url = res.url;
          setPortalUrl(url);
        }
      } catch (err) { console.error("Failed to load portal URL:", err); }
    }
    if (!url) {
      toast("error", "جارٍ تجهيز الرابط المشفر... يرجى الانتظار ثانية والمحاولة مجدداً");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      toast("success", "تم نسخ رابط بروفايل العميل بنجاح (الموضح فيه عدد المتواجدين بالجيم)");
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      toast("error", "فشل نسخ الرابط إلى الحافظة");
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t("cards.qrPreviewTitle")}
        widthClass="max-w-md"
        footer={
          <>
            <a href={qrSrc} download={`card-qr-${barcodeValue}.png`} className="flex-1">
              <Button type="button" variant="secondary" className="w-full">
                <Download className="size-4" />
                {t("cards.downloadQr")}
              </Button>
            </a>
            <Button
              type="button"
              className="flex-1"
              onClick={() => void sendNow()}
              loading={sending}
              disabled={sending}
            >
              <MessageCircle className="size-4" />
              {t("cards.sendQr")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm font-bold text-ink">{memberName}</p>

            {/* QR Image Display */}
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

            {/* Member Portal & Live Occupancy Link Card */}
            <div className="w-full rounded-xl border border-line bg-panel p-3 text-right">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                  <Users className="size-4 text-emerald-400" />
                  <span>رابط بروفايل العميل والمشتركين بالجيم</span>
                </div>
                {liveCount !== null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
                    {liveCount} حالياً بالجيم
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-faint leading-relaxed">
                رابط مباشر ومخصص للمشترك للدخول بدون تسجيل، ومتابعة اشتراكه ومعرفة عدد المتواجدين في الجيم في الوقت الحالي.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleCopyPortal()}
                  className="flex-1 text-xs gap-1.5"
                >
                  {copiedLink ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                  <span>{copiedLink ? "تم النسخ بنجاح" : "نسخ رابط البروفايل"}</span>
                </Button>
                {portalUrl && (
                  <a
                    href={portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-xl border border-line p-2 text-subtle hover:text-ink hover:bg-card transition-colors"
                    title="معاينة البروفايل كما يظهر للعميل"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            </div>

            <p className="text-center text-xs text-faint">
              {memberPhone ? t("cards.qrHint") : t("cards.qrNoPhoneToast")}
            </p>
            <div className="flex items-center gap-1 text-[11px] text-faint">
              <QrCode className="size-3.5" />
              <span>{t("cards.pacingHint")}</span>
            </div>
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