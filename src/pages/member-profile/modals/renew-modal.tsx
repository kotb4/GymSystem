import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { Subscription } from "@/core/services/subscriptions.service";
import type { PublicMember } from "@/core/services/members.service";
import { toMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Send } from "lucide-react";
import { buildPaymentReceiptMessage, buildWhatsAppDirectUrl } from "@/core/whatsapp";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DateRange } from "@/components/ui/date-range";

interface RenewModalProps {
  sub: Subscription;
  member?: PublicMember | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function RenewModal({ sub, member, open, onClose, onDone }: RenewModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [priceMajor, setPriceMajor] = useState(String(sub.price));
  const [methodCode, setMethodCode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (sendWhatsApp = false) => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      const numPrice = Number(priceMajor);
      const hasPrice = priceMajor.trim() !== "" && Number.isFinite(numPrice) && numPrice > 0;
      const result = await api.subscriptions.renew(sub.id, {
        price: hasPrice ? numPrice : undefined,
        notes: notes || null,
      });
      if (hasPrice) {
        await api.payments.record({
          memberId: sub.memberId,
          subscriptionId: result.next.id,
          baseAmountMinor: toMinor(numPrice),
          paidAmountMinor: toMinor(numPrice),
          methodCode,
          notes: notes || null,
        });
      }
      toast("success", t("toast.saved"));
      if (sendWhatsApp && member?.phone) {
        const msg = buildPaymentReceiptMessage({
          memberName: member.fullName,
          memberCode: member.memberCode,
          planName: sub.planName || undefined,
          amountPaid: hasPrice ? numPrice : 0,
          date: todayKey(),
          notes: notes || undefined,
        });
        let sentDirectly = false;
        try {
          const res = await api.messages.send({
            memberId: member.id,
            segment: "payment",
            body: msg,
          });
          if (res && res.status === "sent") {
            sentDirectly = true;
            toast("success", "تم إرسال إيصال وتفاصيل التجديد عبر الواتساب تلقائياً! ✅");
          }
        } catch {
          // gateway offline or failed, fallback to manual direct url
        }
        if (!sentDirectly) {
          const waUrl = buildWhatsAppDirectUrl(member.phone, msg);
          if (waUrl) {
            window.open(waUrl, "_blank");
            toast("info", "تم فتح واتساب لإرسال الإيصال يدوياً لعدم اتصال البوابة");
          }
        }
      }
      onDone();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("subs.renewTitle")} widthClass="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
        className="space-y-3.5"
      >
        <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px]">
          <p className="font-bold">{sub.planName}</p>
          <div className="mt-0.5">
            <DateRange start={sub.startDate} end={sub.endDate} />
          </div>
        </div>
        <Input
          label={`${t("subs.pricePaid")} (ج.م)`}
          type="number"
          dir="ltr"
          min={0}
          step="0.01"
          value={priceMajor}
          onChange={(e) => setPriceMajor(e.target.value)}
          disabled={submitting}
        />
        <Select
          label={t("store.method")}
          value={methodCode}
          onChange={(e) => setMethodCode(e.target.value)}
          options={[
            { value: "cash", label: "نقدي" },
            { value: "bank_card", label: "بطاقة بنكية" },
            { value: "transfer", label: "تحويل / محفظة" },
            { value: "other", label: "أخرى" },
          ]}
          disabled={submitting}
        />
        <Input label={t("members.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          {member?.phone && (
            <Button
              type="button"
              variant="secondary"
              loading={submitting}
              disabled={submitting}
              onClick={() => void onSubmit(true)}
              className="text-emerald-400 hover:text-emerald-300 border-emerald-500/30 gap-1.5"
              title="تجديد الاشتراك وفتح إيصال الواتساب مباشرة"
            >
              <Send className="size-3.5" />
              <span>تجديد وإرسال واتساب</span>
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={submitting}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
