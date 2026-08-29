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

  const onSubmit = async () => {
    if (!actor) return;
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError(t("errors.finance.paymentAmountInvalid"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.payments.record({
        memberId: member.id,
        subscriptionId: subscriptionId || null,
        baseAmountMinor: toMinor(numAmount),
        paidAmountMinor: toMinor(numAmount),
        methodCode,
        notes: notes || null,
      });
      toast("success", t("toast.saved"));
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
            <p dir="ltr" className="mt-0.5 text-faint tabnum">
              {activeSub.startDate} ← {activeSub.endDate}
            </p>
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
