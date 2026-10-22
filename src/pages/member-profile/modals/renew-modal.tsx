import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { Subscription } from "@/core/services/subscriptions.service";
import type { PublicMember } from "@/core/services/members.service";
import { formatMinor, toMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Send } from "lucide-react";
import { buildPaymentReceiptMessage, buildWhatsAppDirectUrl } from "@/core/whatsapp";
import { cn } from "@/utils/cn";
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
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canEditPrice = hasPermission("payments.discount") || hasPermission("subscriptions.edit");
  const canCreatePayment = hasPermission("payments.create");

  const [priceMajor, setPriceMajor] = useState(String(sub.price));
  const [payMode, setPayMode] = useState<"full" | "partial" | "later">("full");
  const [paidMajor, setPaidMajor] = useState(String(sub.price));
  const [methodCode, setMethodCode] = useState("cash");
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPriceMajor(String(sub.price));
    setPayMode("full");
    setPaidMajor(String(sub.price));
    setError(null);
    api.payments
      .methods()
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) setMethods(list);
      })
      .catch((err) => console.error("Failed to load payment methods:", err));
  }, [open, sub.price]);

  const baseMinor = toMinor(priceMajor.trim() === "" ? "0" : priceMajor);
  const paidNowMinor =
    payMode === "full"
      ? baseMinor
      : payMode === "partial"
        ? toMinor(paidMajor.trim() === "" ? "0" : paidMajor)
        : 0;
  const remainingMinor = Math.max(0, baseMinor - paidNowMinor);

  const onSubmit = async (sendWhatsApp = false) => {
    if (!actor) return;
    if (payMode === "partial" && paidNowMinor > baseMinor) {
      setError(t("errors.finance.overpay"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const numPrice = Number(priceMajor);
      const hasPrice = priceMajor.trim() !== "" && Number.isFinite(numPrice) && numPrice >= 0;
      const result = await api.subscriptions.renew(sub.id, {
        price: canEditPrice && hasPrice ? numPrice : undefined,
        notes: notes || null,
      });
      if (canCreatePayment && payMode !== "later" && paidNowMinor > 0 && baseMinor > 0) {
        await api.payments.record({
          memberId: sub.memberId,
          subscriptionId: result.next.id,
          baseAmountMinor: baseMinor,
          paidAmountMinor: paidNowMinor,
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
          amountPaid: paidNowMinor > 0 ? (paidNowMinor / 100).toFixed(2) : "0",
          amountRemaining: remainingMinor > 0 ? (remainingMinor / 100).toFixed(2) : undefined,
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

  const methodOptions =
    methods.length > 0
      ? methods.map((m) => ({ value: m.code, label: m.labelAr }))
      : [
          { value: "cash", label: "نقدي" },
          { value: "bank_card", label: "بطاقة بنكية" },
          { value: "instapay", label: "إنستاباي (InstaPay)" },
          { value: "vodafone_cash", label: "فودافون كاش / محفظة" },
          { value: "transfer", label: "تحويل بنكي" },
          { value: "other", label: "أخرى" },
        ];

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
          label={`${t("subs.price")} (ج.م)`}
          type="number"
          dir="ltr"
          min={0}
          step="0.01"
          value={priceMajor}
          onChange={(e) => {
            setPriceMajor(e.target.value);
            if (payMode === "full") setPaidMajor(e.target.value);
          }}
          disabled={submitting || !canEditPrice}
        />
        {canCreatePayment && (
          <div className="space-y-3 rounded-xl border border-line bg-white/[0.03] p-3">
            <div className="grid grid-cols-3 gap-2">
              {([
                { mode: "full" as const, label: t("subs.payModeFull") },
                { mode: "partial" as const, label: t("subs.payModePartial") },
                { mode: "later" as const, label: t("subs.payModeLater") },
              ]).map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setPayMode(mode);
                    if (mode === "full") setPaidMajor(priceMajor);
                  }}
                  className={cn(
                    "rounded-xl border px-2 py-2 text-[12px] font-bold transition-colors",
                    payMode === mode
                      ? "border-neon bg-neon/10 text-neon shadow-glow-sm"
                      : "border-line text-subtle hover:border-line-strong hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {payMode === "partial" && (
              <Input
                label={`${t("subs.pricePaid")} (ج.م)`}
                type="number"
                dir="ltr"
                min={0}
                max={Number(priceMajor) || undefined}
                step="0.01"
                value={paidMajor}
                onChange={(e) => setPaidMajor(e.target.value)}
                disabled={submitting}
              />
            )}
            {payMode !== "later" && (
              <Select
                label={t("store.method")}
                value={methodCode}
                onChange={(e) => setMethodCode(e.target.value)}
                options={methodOptions}
                disabled={submitting}
              />
            )}
            <div className="flex items-center justify-between text-xs pt-1 border-t border-line/50">
              <span className="text-subtle">المتبقي بعد العملية:</span>
              <span dir="ltr" className={cn("font-bold tabnum", remainingMinor > 0 ? "text-amber" : "text-emerald")}>
                {formatMinor(remainingMinor)}
              </span>
            </div>
          </div>
        )}
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
