import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { todayKey } from "@/core/dates";
import { api, type Plan } from "@/api";


import type { PublicMember } from "@/core/services/members.service";
import { computeDiscount, toMinor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

interface SubscriptionFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  presetMember?: PublicMember | null;
}

export function SubscriptionFormModal({ open, onClose, onSaved, presetMember }: SubscriptionFormModalProps) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [price, setPrice] = useState("");
  const [startDate, setStartDate] = useState(todayKey());
  const [member, setMember] = useState<PublicMember | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payNow, setPayNow] = useState(true);
  const [payMethod, setPayMethod] = useState("cash");
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const canDiscount = hasPermission("payments.discount");
  const [discountKind, setDiscountKind] = useState<"none" | "fixed" | "percent">("none");
  const [discountValue, setDiscountValue] = useState("");

  useEffect(() => {
    if (!open || !actor) return;
    setMember(presetMember ?? null);
    setError(null);
    void (async () => {
      try {
        const activePlans = await api.plans.list(false);
        const typed = activePlans as unknown as Plan[];
        setPlans(typed);
        const first = typed[0];
        setPlanId(first?.id ?? "");
        setPrice(first ? String(first.price) : "");
        setMethods(await api.payments.methods());
      } catch (err) {
        setError(describeError(err, t));
      }
    })();
  }, [open, presetMember, actor, t]);

  const onPlanChange = (nextId: string) => {
    setPlanId(nextId);
    const plan = plans.find((p) => p.id === nextId);
    if (plan) setPrice(String(plan.price));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor || !member || !planId) return;
    setSubmitting(true);
    setError(null);
    let paymentErrorKey: string | null = null;
    try {
      const created = await api.subscriptions.create({
        memberId: member.id,
        planId,
        startDate,
        price: price === "" ? undefined : Number(price),
      });
      if (payNow && hasPermission("payments.create")) {
        try {
          const baseMinor = toMinor(price === "" ? "0" : price);
          const discount = computeDiscount(
            baseMinor,
            canDiscount ? discountKind : "none",
            canDiscount ? Number(discountValue || 0) : 0,
          );
          await api.payments.record({
            memberId: member.id,
            subscriptionId: created.id,
            baseAmountMinor: baseMinor,
            discountKind: discount.kind,
            discountValue: canDiscount && discount.kind !== "none" ? Number(discountValue) : undefined,
            paidAmountMinor: discount.netMinor,
            methodCode: payMethod,
          });
        } catch (payErr) {
          paymentErrorKey = describeError(payErr, t);
        }
      }
      toast("success", t("subs.createdToast"));
      if (paymentErrorKey) toast("error", paymentErrorKey);
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={presetMember ? t("members.addSubFor") : t("subs.addSubscription")}
        footer={
          <>
            <Button
              type="submit"
              form="sub-form"
              loading={submitting}
              disabled={submitting || !member || !planId}
            >
              {t("common.save")}
            </Button>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <form id="sub-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[13px] font-semibold text-subtle">{t("common.member")}</p>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={submitting || Boolean(presetMember)}
              className="flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-panel px-3.5 text-start text-sm transition-colors hover:border-neon/50 disabled:opacity-50"
            >
              {member ? (
                <span dir="ltr" className="min-w-0 flex-1 truncate tabnum">
                  {member.fullName} · {member.memberCode}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-faint">{t("subs.pickMember")}</span>
              )}
            </button>
          </div>
          <Select
            label={t("subs.pickPlan")}
            value={planId}
            onChange={(e) => onPlanChange(e.target.value)}
            disabled={submitting || plans.length === 0}
            options={plans.map((p) => ({
              value: p.id,
              label: `${p.name} — ${p.durationDays} ${t("common.days")} — ${p.price}`,
            }))}
          />
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Input
              label={t("subs.startAt")}
              type="date"
              dir="ltr"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={submitting}
            />
            <Input
              label={t("subs.pricePaid")}
              type="number"
              min={0}
              step="any"
              dir="ltr"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={submitting}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold leading-relaxed text-red">
              {error}
            </p>
          )}
          {hasPermission("payments.create") && (
            <div className="space-y-3 rounded-xl border border-line bg-white/[0.03] p-3.5">
              <Checkbox
                checked={payNow}
                onCheckedChange={(checked) => setPayNow(checked)}
                disabled={submitting}
              >
                {t("subs.payNow")}
              </Checkbox>
              {payNow && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label={t("pay.methodLabel")}
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    disabled={submitting}
                    options={methods.map((m) => ({ value: m.code, label: m.labelAr }))}
                  />
                  {canDiscount && (
                    <>
                      <Select
                        label={t("pay.discountKind")}
                        value={discountKind}
                        onChange={(e) => setDiscountKind(e.target.value as "none" | "fixed" | "percent")}
                        disabled={submitting}
                        options={[
                          { value: "none", label: t("pay.discountNone") },
                          { value: "fixed", label: t("pay.discountFixed") },
                          { value: "percent", label: t("pay.discountPercent") },
                        ]}
                      />
                      {discountKind !== "none" && (
                        <Input
                          label={t("pay.discountValue")}
                          type="number"
                          min={0}
                          step={discountKind === "percent" ? "1" : "0.01"}
                          dir="ltr"
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          disabled={submitting}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </form>
      </Modal>
      {!presetMember && (
        <MemberPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={setMember} />
      )}
    </>
  );
}
