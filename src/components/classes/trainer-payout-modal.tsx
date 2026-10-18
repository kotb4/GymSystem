import { useState, useEffect, type FormEvent } from "react";
import { CheckCircle2, DollarSign, User, Sparkles, Receipt } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicTrainer, type TrainerPayoutType, type TrainerFinancialSummary } from "@/api";
import { toMinor, formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface Props {
  open: boolean;
  onClose: () => void;
  trainer: PublicTrainer | null;
  onSaved?: () => void;
}

const PAYOUT_TYPES: Array<{ value: TrainerPayoutType; label: string }> = [
  { value: "monthly_salary", label: "💼 مرتب شهري" },
  { value: "academy_fee", label: "🥋 بالحصة / أتعاب تدريب" },
  { value: "other", label: "📝 سبب آخر (تحديد في البيان أدناه)" },
  { value: "advance", label: "⏳ سلفة نقدية" },
  { value: "bonus", label: "⭐ مكافأة تشجيعية" },
];

export function TrainerPayoutModal({ open, onClose, trainer, onSaved }: Props) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();

  const [amountMajor, setAmountMajor] = useState("");
  const [payoutDate, setPayoutDate] = useState(todayKey());
  const [payoutType, setPayoutType] = useState<TrainerPayoutType>("monthly_salary");
  const [methodCode, setMethodCode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [summary, setSummary] = useState<TrainerFinancialSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !actor || !trainer) return;
    setAmountMajor("");
    setPayoutDate(todayKey());
    setPayoutType("monthly_salary");
    setNotes("");
    setError(null);
    setSummary(null);
    api.payments.methods().then(setMethods).catch(() => setMethods([]));

    api.trainers
      .getFinancialSummary(trainer.id)
      .then(setSummary)
      .catch((err) => console.error(err));
  }, [open, actor, trainer]);

  if (!open || !trainer) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = toMinor(amountMajor || "0");
    if (minor <= 0) {
      setError("يرجى إدخال مبلغ صحيح أكبر من الصفر");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.trainers.recordPayout({
        trainerId: trainer.id,
        amountMinor: minor,
        payoutDate,
        payoutType,
        methodCode,
        notes: notes.trim() || undefined,
      });

      toast("success", `تم تسجيل صرف مرتب بقيمة ${formatMinor(minor)} للمدرب ${trainer.fullName} وخصمه من الخزينة بنجاح`);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="صرف مرتب / مستحقات المدرب"
      footer={
        <>
          <Button
            type="submit"
            form="trainer-payout-form"
            loading={submitting}
            disabled={submitting || !amountMajor}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
          >
            <CheckCircle2 className="size-4" />
            <span>تأكيد صرف المرتب والخصم من الخزينة</span>
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="trainer-payout-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Trainer Brief Card */}
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400 font-bold">
            <User className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold text-foreground text-sm">{trainer.fullName}</p>
            <p className="text-xs text-subtle">
              {trainer.specialization || "مدرب ألعاب رياضية"} · {trainer.phone || "بدون هاتف"}
            </p>
          </div>
          <span className="rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            صرف فوري
          </span>
        </div>

        {/* Financial Summary & Dues Card */}
        {summary && (
          <div className="rounded-2xl border border-border/70 bg-surface/60 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Receipt className="size-3.5 text-neon" />
                <span>كشف مستحقات المدرب التراكمية</span>
              </span>
              {summary.balanceDueMinor > 0 && (
                <button
                  type="button"
                  onClick={() => setAmountMajor(String(summary.balanceDueMinor / 100))}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded-lg transition"
                >
                  <Sparkles className="size-3" />
                  <span>تعبئة المتبقي ({formatMinor(summary.balanceDueMinor)})</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="rounded-xl bg-surface/90 border border-border/40 p-2">
                <p className="text-[10px] text-subtle">مستحقات PT</p>
                <p className="text-xs font-extrabold text-foreground mt-0.5">{formatMinor(summary.totalPtDuesMinor)}</p>
                <p className="text-[9px] text-subtle/80">{summary.ptSessionsCompleted} حصة خاصة</p>
              </div>

              <div className="rounded-xl bg-surface/90 border border-border/40 p-2">
                <p className="text-[10px] text-subtle">أتعاب الحصص</p>
                <p className="text-xs font-extrabold text-foreground mt-0.5">{formatMinor(summary.totalClassDuesMinor)}</p>
                <p className="text-[9px] text-subtle/80">{summary.classesCompleted} حصة جماعية</p>
              </div>

              <div className="rounded-xl bg-surface/90 border border-border/40 p-2">
                <p className="text-[10px] text-subtle">إجمالي المنصرف</p>
                <p className="text-xs font-extrabold text-amber-400 mt-0.5">{formatMinor(summary.totalPaidMinor)}</p>
                <p className="text-[9px] text-subtle/80">{summary.payoutsCount} دفعة سابقة</p>
              </div>

              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-2">
                <p className="text-[10px] text-emerald-400 font-medium">الصافي المستحق</p>
                <p className="text-xs font-black text-emerald-400 mt-0.5">{formatMinor(summary.balanceDueMinor)}</p>
                <p className="text-[9px] text-emerald-500/80">رصيد متبقي</p>
              </div>
            </div>
          </div>
        )}

        {/* Amount in EGP */}
        <div>
          <Input
            label="المبلغ المنصرف (بالجنيه)"
            type="number"
            min="1"
            step="any"
            value={amountMajor}
            onChange={(e) => setAmountMajor(e.target.value)}
            placeholder="مثال: 2500"
            required
            autoFocus
            icon={<DollarSign className="size-4 text-emerald-400" />}
          />
        </div>

        {/* Payout Category / Type */}
        <div className="space-y-1.5">
          <Select
            label="بند الصرف / نوع المستحقات"
            value={payoutType}
            onChange={(e) => setPayoutType(e.target.value as TrainerPayoutType)}
            options={PAYOUT_TYPES.map((pt) => ({
              value: pt.value,
              label: pt.label,
            }))}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Payout Date */}
          <Input
            label="تاريخ الصرف"
            type="date"
            dir="ltr"
            value={payoutDate}
            onChange={(e) => setPayoutDate(e.target.value)}
            required
          />

          {/* Payment Method / Box */}
          <Select
            label="طريقة الدفع / الخزينة"
            value={methodCode}
            onChange={(e) => setMethodCode(e.target.value)}
            options={methods.map((m) => ({
              value: m.code,
              label: m.labelAr,
            }))}
          />
        </div>

        {/* Statement / Notes */}
        <Input
          label="البيان / تفاصيل الصرف (اختياري)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="مثال: مستحقات أكاديمية الكاراتيه عن شهر أكتوبر"
        />

        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2 text-xs font-semibold text-red">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
