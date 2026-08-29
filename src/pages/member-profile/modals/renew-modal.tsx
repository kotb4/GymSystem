import { useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { Subscription } from "@/core/services/subscriptions.service";
import { toMinor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface RenewModalProps {
  sub: Subscription;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function RenewModal({ sub, open, onClose, onDone }: RenewModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [priceMajor, setPriceMajor] = useState(String(sub.price));
  const [methodCode, setMethodCode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
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
          <p dir="ltr" className="mt-0.5 text-faint tabnum">{sub.startDate} ← {sub.endDate}</p>
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
