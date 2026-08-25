import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type Payment } from "@/api";
import { formatMinor, minorToMajor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface RefundModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  payment: Payment | null;
}

export function PaymentRefundModal({ open, onClose, onDone, payment }: RefundModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [amountMajor, setAmountMajor] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !payment) return;
    const refundable = payment.paidAmountMinor - payment.refundedAmountMinor;
    setAmountMajor((refundable / 100).toFixed(2));
    setReason("");
    setError(null);
  }, [open, payment]);

  if (!payment) return null;

  const refundableMinor = payment.paidAmountMinor - payment.refundedAmountMinor;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.payments.refund(payment.id, Math.round(Number(amountMajor) * 100), reason);
      toast("success", t("pay.refundedToast"));
      onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("pay.refundTitle")} widthClass="max-w-md">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        <div className="rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-faint">{t("pay.colMember")}</span>
            <span className="font-bold">{payment.memberName}</span>
          </div>
          <div className="mt-1.5 flex justify-between">
            <span className="text-faint">{t("pay.refundable")}</span>
            <span dir="ltr" className="font-extrabold tabnum text-amber">
              {formatMinor(refundableMinor)}
            </span>
          </div>
        </div>
        <Input
          label={t("pay.refundAmount")}
          type="number"
          min={0}
          step="0.01"
          max={minorToMajor(refundableMinor)}
          dir="ltr"
          value={amountMajor}
          onChange={(e) => setAmountMajor(e.target.value)}
          disabled={submitting}
          autoFocus
        />
        <Input
          label={t("pay.refundReason")}
          placeholder={t("pay.refundReasonPh")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="danger" loading={submitting} disabled={submitting}>
            {t("pay.refundConfirm")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface VoidModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  payment: Payment | null;
}

export function PaymentVoidModal({ open, onClose, onDone, payment }: VoidModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
  }, [open]);

  if (!payment) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.payments.void(payment.id, reason);
      toast("success", t("pay.voidedToast"));
      onDone();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("pay.voidTitle")} widthClass="max-w-md">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        <p className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[13px] font-semibold text-amber">
          {t("pay.voidWarning")}
        </p>
        <Input
          label={t("pay.voidReason")}
          placeholder={t("pay.voidReasonPh")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
          autoFocus
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="danger" loading={submitting} disabled={submitting}>
            {t("pay.voidConfirm")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
