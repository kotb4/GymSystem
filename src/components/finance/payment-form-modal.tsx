import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Banknote, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";

import type { PublicMember } from "@/core/services/members.service";
import { computeDiscount, formatMinor, toMinor, type DiscountKind } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

interface PaymentFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  presetMember?: PublicMember | null;
}

export function PaymentFormModal({ open, onClose, onSaved, presetMember }: PaymentFormModalProps) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();

  const [selected, setSelected] = useState<PublicMember | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [subs, setSubs] = useState<Array<{ id: string; label: string; remainingMinor: number; priceMinor: number }>>([]);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [baseMajor, setBaseMajor] = useState("");
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountValue, setDiscountValue] = useState("");
  const [paidMajor, setPaidMajor] = useState("");
  const [methodCode, setMethodCode] = useState("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDiscount = hasPermission("payments.discount");

  useEffect(() => {
    if (!open) return;
    setSelected(presetMember ?? null);
    setSubscriptionId("");
    setBaseMajor("");
    setDiscountKind("none");
    setDiscountValue("");
    setPaidMajor("");
    setMethodCode("cash");
    setReferenceNo("");
    setNotes("");
    setError(null);
    void (async () => {
      try {
        setMethods(await api.payments.methods());
      } catch {
        setMethods([]);
      }
    })();
  }, [open, presetMember]);

  useEffect(() => {
    if (!open || !selected || !actor) return;
    let alive = true;
    void (async () => {
      try {
        const rows = (await api.subscriptions.listForMember(selected.id)).filter(
          (s: { effectiveStatus?: string }) => s.effectiveStatus !== "cancelled",
        );
        const mapped = rows.map((s) => ({
          id: (s as { id: string }).id,
          label: `${(s as { planName?: string }).planName ?? "—"} · ${(s as { startDate: string }).startDate} → ${(s as { endDate: string }).endDate}`,
          remainingMinor: Math.max(0, Math.round((s as { price: number }).price * 100)),
          priceMinor: Math.round((s as { price: number }).price * 100),
        }));
        for (const item of mapped) {
          if (!alive) return;
          try {
            item.remainingMinor = (await api.payments.subscriptionBalance(item.id)).remainingMinor;
          } catch {
            if (!alive) return;
            setSubs([]);
            return;
          }
        }
        if (alive) setSubs(mapped);
      } catch {
        if (alive) setSubs([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, selected, actor]);

  useEffect(() => {
    if (!subscriptionId) return;
    const sub = subs.find((s) => s.id === subscriptionId);
    if (sub && baseMajor === "") {
      setBaseMajor((sub.priceMinor / 100).toString());
      if (sub.remainingMinor > 0) setPaidMajor((sub.remainingMinor / 100).toString());
    }
  }, [subscriptionId, subs, baseMajor]);

  const summary = useMemo(() => {
    const baseMinor = toMinor(baseMajor || "0");
    if (!Number.isFinite(baseMinor)) return null;
    try {
      const disc = computeDiscount(baseMinor, discountKind, discountValue === "" ? 0 : Number(discountValue));
      const paidMinor = toMinor(paidMajor || "0");
      if (!Number.isFinite(paidMinor)) return null;
      return {
        netMinor: disc.netMinor,
        discountMinor: disc.discountMinor,
        paidMinor,
        remainingMinor: disc.netMinor - paidMinor,
        invalidRemaining: paidMinor > disc.netMinor,
      };
    } catch {
      return null;
    }
  }, [baseMajor, discountKind, discountValue, paidMajor]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor || !selected) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.payments.record({
        memberId: selected.id,
        subscriptionId: subscriptionId || null,
        baseAmountMinor: toMinor(baseMajor),
        discountKind: canDiscount ? discountKind : "none",
        discountValue:
          canDiscount && discountValue !== "" ? Number(discountValue) : undefined,
        paidAmountMinor: toMinor(paidMajor),
        methodCode,
        referenceNo: referenceNo || null,
        notes: notes || null,
      });
      toast("success", t("pay.recordedToast"));
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("pay.addPayment")} widthClass="max-w-2xl">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <span className="block text-[13px] font-semibold text-subtle">{t("pay.memberLabel")}</span>
          {selected ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-neon/40 bg-neon/5 px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{selected.fullName}</span>
                <span dir="ltr" className="block text-[11px] text-faint tabnum">
                  {selected.memberCode}
                </span>
              </span>
              <Button type="button" variant="ghost" onClick={() => setPickerOpen(true)}>
                <UserRound className="size-4" />
                {t("common.edit")}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="secondary" className="w-full" onClick={() => setPickerOpen(true)}>
              <UserRound className="size-4" />
              {t("pay.pickMemberPh")}
            </Button>
          )}
        </div>

        {selected && (
          <>
            {subs.length > 0 && (
              <Select
                label={t("pay.subscriptionLabel")}
                value={subscriptionId}
                onChange={(e) => {
                  setSubscriptionId(e.target.value);
                  setBaseMajor("");
                  setPaidMajor("");
                }}
                options={[
                  { value: "", label: t("pay.subscriptionAny") },
                  ...subs.map((s) => ({ value: s.id, label: s.label })),
                ]}
              />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t("pay.baseAmount")}
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={baseMajor}
                onChange={(e) => setBaseMajor(e.target.value)}
                disabled={submitting}
              />
              {canDiscount ? (
                <Select
                  label={t("pay.discountKind")}
                  value={discountKind}
                  onChange={(e) => setDiscountKind(e.target.value as DiscountKind)}
                  options={[
                    { value: "none", label: t("pay.discountNone") },
                    { value: "fixed", label: t("pay.discountFixed") },
                    { value: "percent", label: t("pay.discountPercent") },
                  ]}
                />
              ) : null}
            </div>

            {canDiscount && discountKind !== "none" && (
              <Input
                label={t("pay.discountValue")}
                type="number"
                min={0}
                step={discountKind === "percent" ? "1" : "0.01"}
                max={discountKind === "percent" ? 100 : undefined}
                dir="ltr"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                disabled={submitting}
              />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Input
                  label={t("pay.paidAmount")}
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={paidMajor}
                  onChange={(e) => setPaidMajor(e.target.value)}
                  disabled={submitting}
                />
                {summary && summary.remainingMinor > 0 && !summary.invalidRemaining && (
                  <button
                    type="button"
                    onClick={() => setPaidMajor((summary.netMinor / 100).toFixed(2))}
                    className="mt-1 text-[11px] font-semibold text-cyan hover:underline"
                  >
                    {t("pay.fullRemainingBtn")}
                  </button>
                )}
              </div>
              <Select
                label={t("pay.methodLabel")}
                value={methodCode}
                onChange={(e) => setMethodCode(e.target.value)}
                options={methods.map((m) => ({ value: m.code, label: m.labelAr }))}
              />
            </div>

            {summary && (
              <div className="rounded-xl border border-line bg-white/[0.03] px-4 py-3">
                <dl className="grid grid-cols-3 gap-2 text-center text-[12px]">
                  <div>
                    <dt className="text-faint">{t("pay.summaryNet")}</dt>
                    <dd dir="ltr" className="mt-0.5 font-extrabold tabnum">
                      {formatMinor(summary.netMinor)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-faint">{t("pay.colDiscount")}</dt>
                    <dd dir="ltr" className="mt-0.5 font-extrabold tabnum text-amber">
                      {formatMinor(summary.discountMinor)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-faint">{t("pay.summaryRemaining")}</dt>
                    <dd
                      dir="ltr"
                      className={`mt-0.5 font-extrabold tabnum ${
                        summary.remainingMinor > 0 ? "text-red" : "text-emerald"
                      }`}
                    >
                      {formatMinor(Math.max(0, summary.remainingMinor))}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t("pay.referenceNo")}
                dir="ltr"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                disabled={submitting}
              />
              <Input
                label={t("common.notes")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={submitting}
              />
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={submitting} disabled={!selected || submitting}>
            <Banknote className="size-4" />
            {t("pay.record")}
          </Button>
        </div>
      </form>

      <MemberPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(member) => {
          setSelected(member);
          setSubscriptionId("");
          setBaseMajor("");
          setPaidMajor("");
        }}
      />
    </Modal>
  );
}
