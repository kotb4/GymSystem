import { useState, useEffect } from "react";
import {
  Globe,
  QrCode,
  Download,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  Users,
} from "lucide-react";
import QRCode from "qrcode";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/api";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";
import type { PublicMember } from "@/core/services/members.service";

interface MemberPortalLinkModalProps {
  open: boolean;
  onClose: () => void;
  member: PublicMember;
}

export function MemberPortalLinkModal({ open, onClose, member }: MemberPortalLinkModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [portalUrl, setPortalUrl] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [liveOccupancy, setLiveOccupancy] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    if (!open || !member?.id) return;

    async function generatePortalData() {
      setLoading(true);
      try {
        const origin = window.location.origin;
        const res = await api.memberPortal.getUrl(member.id, origin);
        if (!active) return;

        const effectiveUrl = res?.url || `${origin}/#/portal?code=${encodeURIComponent(member.memberCode)}`;
        setPortalUrl(effectiveUrl);
        if (res?.liveOccupancy != null) {
          setLiveOccupancy(res.liveOccupancy);
        }

        // Generate clean QR code for the portal URL
        const qrWidth = 440;
        const rawQr = await QRCode.toDataURL(effectiveUrl, {
          width: qrWidth,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#0f172a", light: "#ffffff" },
        });

        if (typeof document !== "undefined") {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            if (!active) return;
            const canvas = document.createElement("canvas");
            canvas.width = qrWidth;
            canvas.height = qrWidth + 72;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
              setQrDataUrl(rawQr);
              return;
            }

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, qrWidth, qrWidth);

            ctx.fillStyle = "#0f172a";
            ctx.font = "bold 18px system-ui, -apple-system, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(member.fullName, qrWidth / 2, qrWidth + 22);

            ctx.fillStyle = "#059669";
            ctx.font = "bold 15px monospace, sans-serif";
            ctx.fillText(member.memberCode, qrWidth / 2, qrWidth + 48);

            setQrDataUrl(canvas.toDataURL("image/png"));
          };
          img.onerror = () => {
            if (active) setQrDataUrl(rawQr);
          };
          img.src = rawQr;
        } else {
          setQrDataUrl(rawQr);
        }
      } catch (err) {
        console.error("Portal QR generation failed", err);
        toast("error", "تعذر تجهيز رابط بروفايل العضو.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void generatePortalData();

    return () => {
      active = false;
    };
  }, [open, member?.id, member?.memberCode, member?.fullName, toast]);

  const handleCopyLink = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopiedLink(true);
      toast("success", "تم نسخ رابط بروفايل المشترك بنجاح");
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      toast("error", "تعذر نسخ الرابط إلى الحافظة");
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `Portal-QR-${member.memberCode}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast("success", "تم تنزيل كود الـ QR بنجاح");
  };

  const [sending, setSending] = useState(false);

  const buildPortalMessage = () => {
    const effectiveLink = portalUrl;
    return [
      `أهلاً بك يا كابتن *${member.fullName}*! 🏋️‍♂️`,
      `كود العضوية الخاص بك: *${member.memberCode}*`,
      ``,
      `🌐 *رابط بروفايلك وبطاقتك الإلكترونية المشفر:*`,
      effectiveLink,
      ``,
      `يمكنك فتح الرابط في أي وقت لمتابعة:`,
      `• عدد المتواجدين في الجيم في الوقت الحالي لحظياً 👥`,
      `• تفاصيل اشتراكك والأيام المتبقية 📅`,
      `• كود الـ QR الخاص بك لتسجيل الدخول السريع عند الاستقبال 📲`,
      ``,
      `نتمنى لك تمريناً رائعاً دائماً! 💪`,
      ``,
      `GymGate — Powered by KOTB Digital Solutions`,
    ].join("\n");
  };

  const handleOpenDirectWhatsApp = () => {
    if (!member.phone) {
      toast("error", "المشترك لا يملك رقم هاتف مسجل لإرسال رسالة الواتساب");
      return;
    }
    const msg = buildPortalMessage();
    const directUrl = buildWhatsAppDirectUrl(member.phone, msg);
    if (!directUrl) {
      toast("error", "رقم هاتف المشترك غير صالح لإرسال رسالة الواتساب");
      return;
    }
    if (typeof window !== "undefined") {
      window.open(directUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleSendWhatsApp = async () => {
    if (!member.phone) {
      toast("error", "المشترك لا يملك رقم هاتف مسجل لإرسال رسالة الواتساب");
      return;
    }
    if (!portalUrl) {
      toast("error", "جارٍ تجهيز الرابط المشفر... يرجى الانتظار ثوانٍ والمحاولة مجدداً");
      return;
    }

    const msg = buildPortalMessage();

    setSending(true);
    try {
      const res = await api.messages.send({ memberId: member.id, segment: "custom", body: msg });
      if (res && res.status === "sent") {
        toast("success", "تم إرسال رابط البروفايل بنجاح إلى المشترك عبر واتساب الآلي! ✅");
        onClose();
        return;
      }
      if (res && (res.status === "not_configured" || res.status === "failed")) {
        toast("info", "تعذر الإرسال الآلي — جاري فتح محادثة الواتساب مباشرة");
        handleOpenDirectWhatsApp();
        onClose();
        return;
      }
      toast("info", "تم وضع الرسالة في صندوق الإرسال");
    } catch {
      toast("info", "تعذر الإرسال الآلي — جاري فتح محادثة الواتساب مباشرة");
      handleOpenDirectWhatsApp();
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="رابط بروفايل العميل الإلكتروني"
      widthClass="max-w-md"
    >
      <div className="space-y-4 text-sm" dir="rtl">
        {/* Member Badge Info */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-[#0F1420] border border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-[#0055FF]/10 border border-[#0055FF]/30 flex items-center justify-center text-[#0055FF]">
              <Globe className="size-5" />
            </div>
            <div>
              <p className="font-bold text-white text-sm">{member.fullName}</p>
              <p className="text-xs text-[#00D2FF] font-mono" dir="ltr">{member.memberCode}</p>
            </div>
          </div>
          {liveOccupancy != null && (
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#0055FF]/10 text-[#0055FF] border border-[#0055FF]/30 flex items-center gap-1">
              <Users className="size-3" />
              <span>{liveOccupancy} بالصالة الآن</span>
            </span>
          )}
        </div>

        {/* QR Code Presentation */}
        <div className="flex flex-col items-center justify-center p-4 bg-[#06080D] rounded-2xl border border-white/[0.08] space-y-3">
          <div className="p-3 bg-white rounded-2xl shadow-card border border-slate-200">
            {loading ? (
              <div className="size-52 flex flex-col items-center justify-center gap-2 text-slate-400">
                <QrCode className="size-10 animate-spin text-[#0055FF]" />
                <span className="text-xs">جارٍ توليد الرابط والـ QR...</span>
              </div>
            ) : qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR ${member.memberCode}`}
                className="size-52 object-contain"
              />
            ) : (
              <div className="size-52 flex items-center justify-center text-slate-400">
                <QrCode className="size-12" />
              </div>
            )}
          </div>

          <p className="text-xs text-slate-300 font-medium text-center max-w-xs leading-relaxed">
            يمكن للمشترك مسح هذا الرمز بكاميرا أي هاتف لفتح بروفايله مباشرة، أو إرسال الرابط إليه عبر الواتساب.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          {member.phone && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={handleSendWhatsApp}
                loading={sending}
                disabled={sending || loading || !portalUrl}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 shadow-lg shadow-emerald-950/40"
              >
                <MessageCircle className="size-4" />
                <span>إرسال الرابط تلقائياً عبر الواتساب</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleOpenDirectWhatsApp}
                disabled={loading || !portalUrl}
                title="فتح محادثة واتساب مباشرة في المتصفح"
                className="px-3 py-2.5 text-xs text-slate-300 hover:text-white"
              >
                <ExternalLink className="size-3.5" />
                <span>واتساب مباشر</span>
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleCopyLink()}
              disabled={!portalUrl || loading}
              className="font-semibold text-xs"
            >
              {copiedLink ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              <span>{copiedLink ? "تم النسخ بنجاح" : "نسخ رابط البروفايل"}</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleDownloadQr}
              disabled={!qrDataUrl || loading}
              className="font-semibold text-xs"
            >
              <Download className="size-3.5" />
              <span>تحميل صورة الكود</span>
            </Button>
          </div>

          {portalUrl && (
            <a
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-xs text-slate-400 hover:text-white transition"
            >
              <ExternalLink className="size-3" />
              <span>معاينة الرابط في نافذة جديدة</span>
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
