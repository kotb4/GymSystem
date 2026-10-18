import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Banknote, CheckSquare, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { PublicMember } from "@/core/services/members.service";
import { formatMinor, toMinor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DateRange } from "@/components/ui/date-range";

export interface SettleMemberDuesModalProps {
  open: boolean;
  onClose: () => void;
  member: PublicMember;
  onSaved: () => void;
}

interface DuesItemRow {
  key: string;
  type: "subscription" | "store_debt";
  id: string;
  title: string;
  subTitle: React.ReactNode;
  originalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  payingMajor: string;
  selected: boolean;
}

export function SettleMemberDuesModal({
  open,
  onClose,
  member,
  onSaved,
}: SettleMemberDuesModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DuesItemRow[]>([]);
  const [methods, setMethods] = useState<Array<{ code: string; labelAr: string }>>([]);
  const [methodCode, setMethodCode] = useState("cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [totalCustomMajor, setTotalCustomMajor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load member dues & payment methods
  useEffect(() => {
    if (!open || !member) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setReferenceNo("");
    setNotes("");
    setTotalCustomMajor("");

    Promise.all([
      api.finance.outstandingForMember(member.id),
      api.payments.methods().catch(() => []),
    ])
      .then(([outstanding, methodRows]) => {
        if (!alive) return;
        setMethods(methodRows);
        if (methodRows[0]) setMethodCode(methodRows[0].code);

        const rows: DuesItemRow[] = [];

        // Subscriptions
        for (const sub of outstanding.subscriptions) {
          rows.push({
            key: `sub_${sub.subscriptionId}`,
            type: "subscription",
            id: sub.subscriptionId,
            title: sub.planName,
            subTitle: <DateRange start={sub.startDate} end={sub.endDate} />,
            originalMinor: sub.priceMinor,
            paidMinor: sub.paidMinor + sub.discountMinor,
            remainingMinor: sub.remainingMinor,
            payingMajor: (sub.remainingMinor / 100).toFixed(2),
            selected: true,
          });
        }

        // Store Debts
        for (const debt of outstanding.storeDebts) {
          rows.push({
            key: `debt_${debt.debtId}`,
            type: "store_debt",
            id: debt.debtId,
            title: `${t("pay.settleItemStoreDebt")}: ${debt.saleNo}`,
            subTitle: debt.createdAt ? debt.createdAt.slice(0, 10) : "",
            originalMinor: debt.originalMinor,
            paidMinor: debt.paidMinor,
            remainingMinor: debt.remainingMinor,
            payingMajor: (debt.remainingMinor / 100).toFixed(2),
            selected: true,
          });
        }

        setItems(rows);
        setLoading(false);
      })
      .catch((err) => {
        if (alive) {
          setError(describeError(err, t));
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [open, member.id, t]);

  // Calculations
  const { totalOwedMinor, totalPayingMinor, remainingAfterMinor } = useMemo(() => {
    let owed = 0;
    let paying = 0;
    for (const item of items) {
      owed += item.remainingMinor;
      if (item.selected) {
        const val = toMinor(item.payingMajor || "0");
        if (Number.isFinite(val) && val > 0) {
          paying += Math.min(val, item.remainingMinor);
        }
      }
    }
    return {
      totalOwedMinor: owed,
      totalPayingMinor: paying,
      remainingAfterMinor: Math.max(0, owed - paying),
    };
  }, [items]);

  // Action: Select All / Deselect All
  const toggleSelectAll = (selectAll: boolean) => {
    setItems((prev) =>
      prev.map((i) => ({
        ...i,
        selected: selectAll,
        payingMajor: selectAll ? (i.remainingMinor / 100).toFixed(2) : "0",
      })),
    );
  };

  // Action: Set Full Payment for all items
  const handlePayAllInFull = () => {
    setItems((prev) =>
      prev.map((i) => ({
        ...i,
        selected: true,
        payingMajor: (i.remainingMinor / 100).toFixed(2),
      })),
    );
  };

  // Action: Distribute Custom Amount Across Items
  // Chronological/Order-based distribution (or selected items)
  const handleDistributeCustomAmount = () => {
    const totalToDistributeMinor = toMinor(totalCustomMajor);
    if (!Number.isFinite(totalToDistributeMinor) || totalToDistributeMinor <= 0) return;

    let remainingToAllocate = totalToDistributeMinor;

    setItems((prev) =>
      prev.map((item) => {
        if (remainingToAllocate <= 0) {
          return {
            ...item,
            payingMajor: "0",
            selected: false,
          };
        }
        const allocate = Math.min(item.remainingMinor, remainingToAllocate);
        remainingToAllocate -= allocate;
        return {
          ...item,
          payingMajor: (allocate / 100).toFixed(2),
          selected: allocate > 0,
        };
      }),
    );
  };

  // Update single row
  const updateRow = (key: string, updates: Partial<DuesItemRow>) => {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, ...updates } : i)),
    );
  };

  // Submit Payments
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor || submitting) return;

    const validPayments = items
      .filter((i) => i.selected)
      .map((i) => {
        const amountMinor = toMinor(i.payingMajor || "0");
        return {
          ...i,
          amountMinor: Math.min(amountMinor, i.remainingMinor),
        };
      })
      .filter((i) => i.amountMinor > 0);

    if (validPayments.length === 0) {
      setError(t("pay.settleNoSelection"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      for (const p of validPayments) {
        if (p.type === "subscription") {
          await api.payments.record({
            memberId: member.id,
            subscriptionId: p.id,
            baseAmountMinor: p.remainingMinor,
            paidAmountMinor: p.amountMinor,
            methodCode,
            referenceNo: referenceNo || null,
            notes: notes ? `${notes} (تسديد مديونية)` : null,
          });
        } else if (p.type === "store_debt") {
          await api.store.repayDebt({
            debtId: p.id,
            amountMinor: p.amountMinor,
            methodCode,
          });
        }
      }

      toast("success", t("pay.settleSuccessToast"));
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
      title={t("pay.settleDuesTitle")}
      widthClass="max-w-2xl"
    >
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
        {/* Header Member Info */}
        <div className="flex items-center justify-between rounded-xl border border-neon/30 bg-neon/5 px-4 py-3">
          <div className="min-w-0">
            <span className="block truncate text-base font-extrabold text-foreground">
              {member.fullName}
            </span>
            <span dir="ltr" className="block text-xs font-mono text-subtle">
              {member.memberCode}
            </span>
          </div>
          <div className="text-end">
            <span className="block text-[11px] font-semibold text-faint">
              {t("pay.settleTotalOwed")}
            </span>
            <span dir="ltr" className="text-base font-extrabold text-red tabnum font-mono">
              {formatMinor(totalOwedMinor)}
            </span>
          </div>
        </div>

        {/* Quick Automation Tools Bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/50 p-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePayAllInFull}
            className="gap-1.5 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
          >
            <CheckSquare className="size-3.5" />
            <span>{t("pay.settleModeFull")}</span>
          </Button>

          <div className="flex flex-1 items-center gap-2 min-w-[220px]">
            <Input
              type="number"
              min={0}
              step="0.01"
              dir="ltr"
              placeholder={t("pay.settleEnterAmount")}
              value={totalCustomMajor}
              onChange={(e) => setTotalCustomMajor(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleDistributeCustomAmount}
              disabled={!totalCustomMajor || Number(totalCustomMajor) <= 0}
              className="gap-1 text-xs shrink-0 border-neon/40 text-neon hover:bg-neon/10"
            >
              <Sparkles className="size-3.5" />
              <span>{t("pay.settleDistributeBtn")}</span>
            </Button>
          </div>
        </div>

        {/* Outstanding Items List */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-subtle">
              {t("members.outstandingTotal")} ({items.length})
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => toggleSelectAll(true)}
                className="text-[11px] font-semibold text-neon hover:underline"
              >
                {t("pay.settleSelectAll")}
              </button>
              <span className="text-faint">·</span>
              <button
                type="button"
                onClick={() => toggleSelectAll(false)}
                className="text-[11px] font-semibold text-subtle hover:underline"
              >
                {t("common.reset")}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-subtle animate-pulse">
              {t("common.loading")}…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-sm font-bold text-emerald-400">
              ✓ {t("members.noOutstanding")}
            </div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto space-y-2 pe-1">
              {items.map((item) => (
                <div
                  key={item.key}
                  className={`rounded-xl border p-3 transition-colors ${
                    item.selected
                      ? "border-neon/40 bg-white/[0.04]"
                      : "border-line bg-surface/30 opacity-70"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2.5 cursor-pointer min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          updateRow(item.key, {
                            selected: checked,
                            payingMajor: checked ? (item.remainingMinor / 100).toFixed(2) : "0",
                          });
                        }}
                        className="size-4 rounded border-line text-neon focus:ring-neon accent-cyan"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold">
                            {item.title}
                          </span>
                          <Badge
                            variant={item.type === "subscription" ? "info" : "warning"}
                            className="text-[10px] py-0"
                          >
                            {item.type === "subscription"
                              ? t("pay.settleItemSubscription")
                              : t("pay.settleItemStoreDebt")}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-subtle mt-0.5">
                          {item.subTitle && <span>{item.subTitle}</span>}
                          <span>•</span>
                          <span className="text-red font-semibold">
                            {t("pay.settleItemRemaining", {
                              amount: formatMinor(item.remainingMinor),
                            })}
                          </span>
                          <span>•</span>
                          <span className="text-faint">
                            {t("pay.settlePaidSoFar", {
                              amount: formatMinor(item.paidMinor),
                            })}
                          </span>
                        </div>
                      </div>
                    </label>

                    {/* Amount Input for this specific row */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="w-28">
                        <Input
                          type="number"
                          min={0}
                          max={item.remainingMinor / 100}
                          step="0.01"
                          dir="ltr"
                          value={item.payingMajor}
                          disabled={!item.selected || submitting}
                          onChange={(e) => {
                            updateRow(item.key, { payingMajor: e.target.value });
                          }}
                          className="h-8 text-xs font-mono text-center"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!item.selected || submitting}
                        onClick={() => {
                          updateRow(item.key, {
                            payingMajor: (item.remainingMinor / 100).toFixed(2),
                          });
                        }}
                        title={t("pay.fullRemainingBtn")}
                        className="h-8 text-[11px] px-2 text-cyan hover:underline"
                      >
                        {t("pay.fullRemainingBtn")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Payment Methods & Metadata */}
        <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-line/60">
          <Select
            label={t("pay.methodLabel")}
            value={methodCode}
            onChange={(e) => setMethodCode(e.target.value)}
            options={methods.map((m) => ({ value: m.code, label: m.labelAr }))}
            disabled={submitting}
          />
          <Input
            label={t("pay.referenceNo")}
            dir="ltr"
            value={referenceNo}
            onChange={(e) => setReferenceNo(e.target.value)}
            disabled={submitting}
          />
        </div>

        <Input
          label={t("common.notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
          placeholder={t("pay.notesPh")}
        />

        {/* Summary Footer Bar */}
        <div className="rounded-xl border border-line bg-surface/50 p-3.5">
          <dl className="grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <dt className="text-faint">{t("pay.settleTotalOwed")}</dt>
              <dd dir="ltr" className="mt-0.5 font-extrabold tabnum font-mono text-foreground">
                {formatMinor(totalOwedMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-faint">{t("pay.settleTotalPaying")}</dt>
              <dd dir="ltr" className="mt-0.5 font-extrabold tabnum font-mono text-emerald">
                {formatMinor(totalPayingMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-faint">{t("pay.settleRemainingAfter")}</dt>
              <dd
                dir="ltr"
                className={`mt-0.5 font-extrabold tabnum font-mono ${
                  remainingAfterMinor > 0 ? "text-amber" : "text-emerald"
                }`}
              >
                {formatMinor(remainingAfterMinor)}
              </dd>
            </div>
          </dl>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red"
          >
            {error}
          </p>
        )}

        {/* Modal Buttons */}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            loading={submitting}
            disabled={submitting || totalPayingMinor <= 0}
            className="gap-2"
          >
            <Banknote className="size-4" />
            <span>
              {t("pay.record")} ({formatMinor(totalPayingMinor)})
            </span>
          </Button>
        </div>
      </form>
    </Modal>
  );
}
