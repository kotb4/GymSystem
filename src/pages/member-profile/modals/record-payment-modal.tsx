import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { PublicMember } from "@/core/services/members.service";
import type { Subscription } from "@/core/services/subscriptions.service";
import { toMinor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DateRange } from "@/components/ui/date-range";
import { Send } from "lucide-react";
import { todayKey } from "@/core/dates";
import { buildPaymentReceiptMessage, buildWhatsAppDirectUrl } from "@/core/whatsapp";

interface RecordPaymentModalProps {
  open: boolean;
  onClose: () => void;
  member: PublicMember;
  activeSub: Subscription | null;
  onSaved: () => void;
}

export function RecordPaymentModal({ open, onClose, member, activeSub, onSaved }: RecordPaymentModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [subscriptionId, setSubscriptionId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [methodCode, setMethodCode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !actor) return;
    let alive = true;
    api.payments
      .methods()
      .then((rows) => {
        if (!alive) return;
        setMethods(rows);
        if (rows[0]) setMethodCode(rows[0].code);
      })
      .catch(() => undefined);
    setSubscriptionId(activeSub?.id ?? "");
    setAmount("");
    setNotes("");
    setError(null);
    return () => {
      alive = false;
    };
  }, [open, actor, activeSub?.id]);

  const onSubmit = async (sendWhatsApp = false) => {
    if (!actor) return;
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError(t("errors.finance.paymentAmountInvalid"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.payments.record({
        memberId: member.id,
        subscriptionId: subscriptionId || null,
        baseAmountMinor: toMinor(numAmount),
        paidAmountMinor: toMinor(numAmount),
        methodCode,
        notes: notes || null,
      });
      toast("success", t("toast.saved"));
      if (sendWhatsApp && member.phone) {
        const msg = buildPaymentReceiptMessage({
          memberName: member.fullName,
          memberCode: member.memberCode,
          receiptNo: res?.receiptNo || undefined,
          amountPaid: numAmount,
          planName: activeSub?.planName || undefined,
          date: todayKey(),
          notes: notes || undefined,
        });
        let sentDirectly = false;
        try {
          const sendRes = await api.messages.send({
            memberId: member.id,
            segment: "payment",
            body: msg,
          });
          if (sendRes && sendRes.status === "sent") {
            sentDirectly = true;
            toast("success", "تم إرسال إيصال القبض عبر الواتساب تلقائياً! ✅");
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
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("members.qaRecordPayment")} widthClass="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
        className="space-y-3.5"
      >
        <p className="text-[12px] text-faint">{t("members.profileTitle")}: {member.fullName}</p>
        {activeSub && (
          <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12px]">
            <p className="font-bold">{activeSub.planName ?? "—"}</p>
            <div className="mt-0.5">
              <DateRange start={activeSub.startDate} end={activeSub.endDate} />
            </div>
          </div>
        )}
        <Input
          label={`${t("members.paymentsAmount")} (ج.م)`}
          type="number"
          dir="ltr"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={submitting}
          required
        />
        <Select
          label={t("store.method")}
          value={methodCode}
          onChange={(e) => setMethodCode(e.target.value)}
          options={methods.length > 0 ? methods.map((m) => ({ value: m.code, label: m.labelAr })) : [{ value: "cash", label: "نقدي" }]}
          disabled={submitting}
        />
        <Input label={t("members.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          {member.phone && (
            <Button
              type="button"
              variant="secondary"
              loading={submitting}
              disabled={submitting || !amount}
              onClick={() => void onSubmit(true)}
              className="text-emerald-400 hover:text-emerald-300 border-emerald-500/30 gap-1.5"
              title="تسجيل الدفعة وفتح إيصال الواتساب مباشرة"
            >
              <Send className="size-3.5" />
              <span>تسجيل وإرسال واتساب</span>
            </Button>
          )}
          <Button type="submit" loading={submitting} disabled={submitting || !amount}>
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
