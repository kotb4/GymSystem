import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { todayKey } from "@/core/dates";
import { api, type Plan } from "@/api";


import type { PublicMember } from "@/core/services/members.service";
import { computeDiscount, formatMinor, toMinor } from "@/core/money";
import { cn } from "@/utils/cn";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  const [payMode, setPayMode] = useState<"full" | "partial" | "later">("full");
  const [paidMajor, setPaidMajor] = useState("");
  const [customPrice, setCustomPrice] = useState(false);
  const [payMethod, setPayMethod] = useState("cash");
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const canDiscount = hasPermission("payments.discount");
  const [discountKind, setDiscountKind] = useState<"none" | "fixed" | "percent">("none");
  const [discountValue, setDiscountValue] = useState("");

  useEffect(() => {
    if (!open || !actor) return;
    setMember(presetMember ?? null);
    setError(null);
    setPayMode("full");
    setPaidMajor("");
    setDiscountKind("none");
    setDiscountValue("");
    setCustomPrice(false);
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

  const baseMinor = toMinor(price === "" ? "0" : price);
  let discount: ReturnType<typeof computeDiscount>;
  let discountError: string | null = null;
  try {
    discount = computeDiscount(
      baseMinor,
      canDiscount ? discountKind : "none",
      canDiscount && discountKind !== "none"
        ? discountKind === "fixed"
          ? toMinor(discountValue || "0")
          : Number(discountValue || 0)
        : 0,
    );
  } catch (e) {
    discount = {
      kind: discountKind,
      inputValue: Number(discountValue || 0),
      discountMinor: 0,
      netMinor: baseMinor,
    };
    discountError = describeError(e, t);
  }
  const netMinor = discount.netMinor;
  const paidNowMinor =
    payMode === "full" ? netMinor : payMode === "partial" ? toMinor(paidMajor || "0") : 0;
  const remainingAfter = Math.max(0, netMinor - paidNowMinor);

  const showDiscount = payMode !== "later" && canDiscount;

  useEffect(() => {
    if (payMode === "partial" && paidMajor === "") {
      setPaidMajor((netMinor / 100).toFixed(2));
    }
  }, [payMode, netMinor, paidMajor]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor || !member || !planId) return;
    if (discountError && payMode !== "later") {
      setError(discountError);
      return;
    }
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
      if (payMode !== "later" && hasPermission("payments.create") && paidNowMinor > 0) {
        try {
          await api.payments.record({
            memberId: member.id,
            subscriptionId: created.id,
            baseAmountMinor: baseMinor,
            discountKind: discount.kind,
            discountValue: canDiscount && discount.kind !== "none"
              ? discount.kind === "fixed"
                ? toMinor(discountValue || "0")
                : Number(discountValue || 0)
              : undefined,
            paidAmountMinor: paidNowMinor,
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
          <Input
            label={t("subs.startAt")}
            type="date"
            dir="ltr"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={submitting}
          />
          {!customPrice ? (
            <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] px-3.5 py-2.5">
              <span className="text-[12px] text-subtle">
                {t("subs.usingPlanPrice", { price: price || "0" })}
              </span>
              <button
                type="button"
                className="text-[12px] font-bold text-neon hover:underline"
                onClick={() => setCustomPrice(true)}
              >
                {t("subs.customPriceToggle")}
              </button>
            </div>
          ) : (
            <Input
              label={t("subs.price")}
              type="number"
              min={0}
              step="any"
              dir="ltr"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          )}
          {error && (
            <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold leading-relaxed text-red">
              {error}
            </p>
          )}
          {hasPermission("payments.create") && (
            <div className="space-y-3 rounded-xl border border-line bg-white/[0.03] p-3.5">
              <p className="text-[13px] font-bold text-ink">{t("subs.paymentSection")}</p>
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
                    onClick={() => setPayMode(mode)}
                    className={cn(
                      "rounded-xl border px-2 py-2.5 text-[12px] font-bold transition-colors",
                      payMode === mode
                        ? "border-neon bg-neon/10 text-neon shadow-glow-sm"
                        : "border-line text-subtle hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {showDiscount && (
                <div className="grid gap-3 sm:grid-cols-2">
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
                      label={discountKind === "fixed" ? t("pay.discountFixed") : t("pay.discountPercent")}
                      type="number"
                      min={0}
                      step={discountKind === "percent" ? "1" : "0.01"}
                      dir="ltr"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      disabled={submitting}
                    />
                  )}
                </div>
              )}

              {payMode !== "later" && (
                <Select
                  label={t("pay.methodLabel")}
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  disabled={submitting}
                  options={methods.map((m) => ({ value: m.code, label: m.labelAr }))}
                />
              )}

              {payMode === "partial" && (
                <Input
                  label={t("subs.paidNow")}
                  type="number"
                  min={0}
                  max={netMinor / 100}
                  step="0.01"
                  dir="ltr"
                  value={paidMajor}
                  onChange={(e) => setPaidMajor(e.target.value)}
                  disabled={submitting}
                />
              )}

              {discountError && (
                <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">
                  {discountError}
                </p>
              )}

              {payMode === "later" ? (
                <div className="flex items-center justify-between border-t border-line pt-2.5 text-[12px] font-bold">
                  <span className="text-faint">{t("subs.balanceDue")}</span>
                  <span dir="ltr" className="tabnum text-amber">
                    {formatMinor(netMinor)}
                  </span>
                </div>
              ) : payMode === "partial" ? (
                <div className="flex items-center justify-between border-t border-line pt-2.5 text-[12px] font-bold">
                  <span className="text-faint">{t("subs.remainingAfter")}</span>
                  <span dir="ltr" className={cn("tabnum", remainingAfter > 0 ? "text-amber" : "text-emerald")}>
                    {formatMinor(remainingAfter)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between border-t border-line pt-2.5 text-[12px] font-bold">
                  <span className="text-faint">{t("subs.balancePaid")}</span>
                  <span dir="ltr" className="tabnum text-emerald">
                    {formatMinor(netMinor)}
                  </span>
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
