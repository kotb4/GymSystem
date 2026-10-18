import { useCallback, useEffect, useState } from "react";
import { DollarSign, Filter, TrendingUp, UserCheck } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ClassProfitItem, type GymClass } from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";

function formatMoney(minor: number): string {
  return `${formatMinor(minor)} ج.م`;
}

export function ClassProfitsTab() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canExpenses = hasPermission("expenses.create");

  const [classes, setClasses] = useState<GymClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(todayKey());

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ClassProfitItem[]>([]);

  // Payout Modal
  const [payoutTarget, setPayoutTarget] = useState<ClassProfitItem | null>(null);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!actor) return;
    api.classes.list().then(setClasses).catch(console.error);
  }, [actor]);

  const loadData = useCallback(() => {
    if (!actor) return;
    setLoading(true);
    api.classes
      .getProfitsReport({
        classId: selectedClassId || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      })
      .then(setItems)
      .catch((err) => console.error("Error loading profits:", err))
      .finally(() => setLoading(false));
  }, [actor, selectedClassId, fromDate, toDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalGrossMinor = items.reduce((sum, i) => sum + i.grossRevenueMinor, 0);
  const totalCoachFeesMinor = items.reduce((sum, i) => sum + i.trainerFeeMinor, 0);
  const totalNetMinor = items.reduce((sum, i) => sum + i.netProfitMinor, 0);
  const totalAttended = items.reduce((sum, i) => sum + i.attendedCount, 0);

  const openPayoutModal = (item: ClassProfitItem) => {
    setPayoutTarget(item);
    // Auto fill coach fee (Suggestion 1)
    setPayoutAmount(item.trainerFeeMinor > 0 ? String(item.trainerFeeMinor / 100) : "");
    setPayoutNotes(`أتعاب حصة ${item.className} - ${item.sessionDate}`);
  };

  const submitPayout = async () => {
    if (!payoutTarget) return;
    const feeMinor = Math.round(Number(payoutAmount) * 100);
    if (feeMinor <= 0) {
      toast("error", t("errors.invalidAmount"));
      return;
    }
    setPaying(true);
    try {
      await api.classes.payTrainer({
        sessionId: payoutTarget.sessionId,
        trainerFeeMinor: feeMinor,
        notes: payoutNotes,
      });
      toast("success", t("cls.trainerPaidSuccess"));
      setPayoutTarget(null);
      loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-panel p-4 space-y-1">
          <span className="flex items-center gap-2 text-xs text-subtle font-medium">
            <TrendingUp className="size-4 text-neon" />
            {t("cls.totalGrossRevenue")}
          </span>
          <p className="text-2xl font-bold tabnum text-fg">{formatMoney(totalGrossMinor)}</p>
          <span className="text-[11px] text-faint tabnum">{t("cls.totalTraineesAttended", { count: totalAttended })}</span>
        </div>

        <div className="rounded-xl border border-white/5 bg-panel p-4 space-y-1">
          <span className="flex items-center gap-2 text-xs text-subtle font-medium">
            <UserCheck className="size-4 text-amber-400" />
            {t("cls.totalCoachFees")}
          </span>
          <p className="text-2xl font-bold tabnum text-amber-400">{formatMoney(totalCoachFeesMinor)}</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-panel p-4 space-y-1">
          <span className="flex items-center gap-2 text-xs text-subtle font-medium">
            <DollarSign className="size-4 text-emerald-400" />
            {t("cls.totalNetProfit")}
          </span>
          <p className="text-2xl font-bold tabnum text-emerald-400">{formatMoney(totalNetMinor)}</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-panel p-4 space-y-1">
          <span className="flex items-center gap-2 text-xs text-subtle font-medium">
            <Filter className="size-4 text-cyan-400" />
            {t("cls.totalSessionsCount")}
          </span>
          <p className="text-2xl font-bold tabnum text-fg">{items.length}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardHeader title={t("cls.filterProfits")} />
        <div className="p-4 grid gap-3 sm:grid-cols-3">
          <Select
            label={t("cls.class")}
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            options={[
              { value: "", label: t("common.all") },
              ...classes.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Input
            label={t("common.fromDate")}
            type="date"
            dir="ltr"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <Input
            label={t("common.toDate")}
            type="date"
            dir="ltr"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </Card>

      {/* Profits Table */}
      <Card>
        <CardHeader title={t("cls.profitsReportTitle")} />
        {loading ? (
          <div className="p-12 text-center text-sm text-subtle">{t("common.loading")}</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-sm text-faint">{t("cls.emptyProfitsReport")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-white/5 bg-surface/50 text-faint">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("cls.class")}</th>
                  <th className="px-4 py-3 font-semibold">{t("common.date")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cls.trainerCol")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cls.attendees")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cls.sessionRevenue")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cls.trainerFee")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cls.netProfit")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cls.payoutStatus")}</th>
                  <th className="px-4 py-3 font-semibold text-end">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {items.map((row) => (
                  <tr key={row.sessionId} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 font-bold text-fg">{row.className}</td>
                    <td className="px-4 py-3 tabnum text-subtle">
                      {row.sessionDate} <span className="text-faint" dir="ltr">({row.startTime})</span>
                    </td>
                    <td className="px-4 py-3 text-subtle">{row.trainerName ?? "—"}</td>
                    <td className="px-4 py-3 tabnum font-bold text-fg">{row.attendedCount}</td>
                    <td className="px-4 py-3 tabnum font-semibold text-fg">
                      {formatMoney(row.grossRevenueMinor)}
                    </td>
                    <td className="px-4 py-3 tabnum text-amber-400">
                      {row.trainerFeeMinor > 0 ? formatMoney(row.trainerFeeMinor) : "—"}
                    </td>
                    <td className="px-4 py-3 tabnum font-bold text-emerald-400">
                      {formatMoney(row.netProfitMinor)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={row.paidToTrainer ? "success" : "warning"}>
                        {row.paidToTrainer ? t("cls.paidToTrainer") : t("cls.pendingPayout")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-end">
                      {!row.paidToTrainer && canExpenses ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2.5 text-xs text-amber-400 hover:text-amber-300 gap-1 font-semibold"
                          onClick={() => openPayoutModal(row)}
                        >
                          <DollarSign className="size-3" />
                          <span>{t("cls.payTrainerBtn")}</span>
                        </Button>
                      ) : (
                        <span className="text-[11px] text-faint">
                          {row.paidToTrainer ? t("cls.paid") : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pay Trainer Modal */}
      {payoutTarget && (
        <Modal
          open
          onClose={() => setPayoutTarget(null)}
          title={`${t("cls.payTrainerTitle")} — ${payoutTarget.trainerName ?? payoutTarget.className}`}
          widthClass="max-w-md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPayoutTarget(null)} disabled={paying}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void submitPayout()} loading={paying} disabled={paying}>
                {t("cls.confirmPayoutBtn")}
              </Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div className="rounded-xl border border-white/5 bg-panel p-3 text-xs space-y-1.5 text-subtle">
              <div className="flex justify-between">
                <span>{t("cls.class")}:</span>
                <b className="text-fg">{payoutTarget.className}</b>
              </div>
              <div className="flex justify-between">
                <span>{t("common.date")}:</span>
                <b className="text-fg">{payoutTarget.sessionDate} ({payoutTarget.startTime})</b>
              </div>
              <div className="flex justify-between">
                <span>{t("cls.attendees")}:</span>
                <b className="text-fg">{payoutTarget.attendedCount} {t("cls.person")}</b>
              </div>
              <div className="flex justify-between">
                <span>{t("cls.sessionRevenue")}:</span>
                <b className="text-fg">{formatMoney(payoutTarget.grossRevenueMinor)}</b>
              </div>
            </div>

            <Input
              label={t("cls.payoutAmountEgp")}
              type="number"
              dir="ltr"
              value={payoutAmount}
              onChange={(e) => setPayoutAmount(e.target.value)}
              autoFocus
              required
            />

            <Input
              label={t("members.notes")}
              value={payoutNotes}
              onChange={(e) => setPayoutNotes(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
