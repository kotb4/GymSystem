import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type Plan } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

interface PlanFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  plan?: Plan | null;
}

export function PlanFormModal({ open, onClose, onSaved, plan }: PlanFormModalProps) {
  const t = useT();
  const actor = useAuth().actor;
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(plan?.name ?? "");
    setDurationDays(plan ? String(plan.durationDays) : "30");
    setPrice(plan ? String(plan.price) : "");
    setDescription(plan?.description ?? "");
    setIsActive(plan ? plan.isActive : true);
    setError(null);
  }, [open, plan]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      if (plan) {
        await api.plans.update(plan.id, {
          name,
          durationDays: Number(durationDays),
          price: Number(price),
          description: description.trim() || null,
        });
      } else {
        await api.plans.create({
          name,
          durationDays: Number(durationDays),
          price: Number(price),
          description: description.trim() || null,
        });
      }
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
    <Modal
      open={open}
      onClose={onClose}
      title={plan ? t("plans.editPlan") : t("plans.addPlan")}
      footer={
        <>
          <Button type="submit" form="plan-form" loading={submitting} disabled={submitting}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={onSubmit} noValidate className="space-y-3.5">
        <Input
          label={t("plans.name")}
          placeholder={t("plans.namePh")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          autoFocus
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label={t("plans.durationDays")}
            type="number"
            min={1}
            dir="ltr"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={t("plans.price")}
            type="number"
            min={0}
            step="any"
            dir="ltr"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={submitting}
          />
        </div>
        <Input
          label={`${t("common.notes")} (${t("common.optional")})`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
        />
        {plan && <Checkbox checked={isActive} onCheckedChange={setIsActive}>{t("plans.active")}</Checkbox>}
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
