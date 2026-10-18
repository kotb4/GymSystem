import { useCallback, useEffect, useState } from "react";
import {
  DollarSign,
  FileSpreadsheet,
  MessageCircle,
  Printer,
  Wallet,
} from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type PublicTrainer,
  type TrainerDetailedStatement,
} from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";
import { downloadCsvWithBom } from "@/utils/csv-helper";

interface Props {
  open: boolean;
  onClose: () => void;
  trainer: PublicTrainer | null;
  onPayoutRecorded?: () => void;
}

export function TrainerStatementModal({ open, onClose, trainer, onPayoutRecorded }: Props) {
  const t = useT();
  const { toast } = useToast();

  const [statement, setStatement] = useState<TrainerDetailedStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1); // 1st of current month
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(todayKey());

  // Quick Payout inline modal
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("cash");
  const [paying, setPaying] = useState(false);

  const loadData = useCallback(() => {
    if (!trainer) return;
    setLoading(true);
    api.trainers
      .getDetailedStatement({
        trainerId: trainer.id,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      })
      .then(setStatement)
      .catch((err) => toast("error", describeError(err, t)))
      .finally(() => setLoading(false));
  }, [trainer, fromDate, toDate, t, toast]);

  useEffect(() => {
    if (open && trainer) {
      loadData();
    }
  }, [open, trainer, loadData]);

  if (!open || !trainer) return null;

  const handleQuickPayout = async () => {
    const amountNum = Number(payoutAmount);
    if (!amountNum || amountNum <= 0) {
      toast("error", "يرجى إدخال مبلغ صحيح للصرف");
      return;
    }
    setPaying(true);
    try {
      await api.trainers.recordPayout({
        trainerId: trainer.id,
        amountMinor: Math.round(amountNum * 100),
        payoutDate: todayKey(),
        payoutType: "other",
        methodCode: payoutMethod,
        notes: payoutNotes.trim() || `صرف مستحقات من كشف الحساب`,
      });
      toast("success", "تم صرف المبلغ وتسجيله في الخزينة وكشف الحساب بنجاح");
      setPayoutOpen(false);
      setPayoutAmount("");
      setPayoutNotes("");
      loadData();
      onPayoutRecorded?.();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPaying(false);
    }
  };

  const handleExportCsv = () => {
    if (!statement || statement.items.length === 0) return;
    const headers = [
      "التاريخ",
      "النوع",
      "البيان",
      "التفاصيل",
      "المستحق للمدرب (له)",
      "المنصرف للمدرب (منه)",
      "الرصيد التراكمي",
      "ملاحظات",
      "رقم الإيصال",
    ];
    const typeNames: Record<string, string> = {
      pt_session: "تدريب خاص PT",
      class_session: "حصة جماعية/أكاديمية",
      salary_base: "راتب أساسي",
      payout: "صرف دفعة نقدية",
    };
    const rows = statement.items.map((i) => [
      i.date,
      typeNames[i.type] || i.type,
      i.title,
      i.subtitle || "",
      (i.creditMinor / 100).toFixed(2),
      (i.debitMinor / 100).toFixed(2),
      (i.balanceMinor / 100).toFixed(2),
      i.notes || "",
      i.receiptNo || "",
    ]);
    downloadCsvWithBom(`كشف_حساب_المدرب_${trainer.fullName}_${todayKey()}.csv`, headers, rows);
    toast("success", "تم تصدير كشف الحساب إلى Excel بنجاح");
  };

  const buildWhatsAppText = () => {
    if (!statement) return "";
    const totals = statement.totals;
    return `📄 *كشف حساب ومستحقات المدرب - جيم جيت*
كابتن: *${trainer.fullName}*
الفترة: من ${fromDate || "البداية"} إلى ${toDate || "اليوم"}

📊 *ملخص الحساب المالي:*
• إجمالي مستحقات التدريب الخاص (PT): *${formatMinor(totals.totalPtEarningsMinor)} ج.م* (${totals.ptSessionsCount} حصة)
• إجمالي أتعاب الأكاديميات والحصص: *${formatMinor(totals.totalClassEarningsMinor)} ج.م* (${totals.classSessionsCount} حصة)
• إجمالي المستحقات الإجمالية: *${formatMinor(totals.totalGrossEarningsMinor)} ج.م*
• إجمالي الدفعات المنصرفة: *${formatMinor(totals.totalPayoutsMinor)} ج.م*
━━━━━━━━━━━━━━━
💰 *الصافي المستحق للمدرب:* *${formatMinor(totals.netBalanceDueMinor)} ج.م*

شكراً لجهودكم المتميزة في صالة التمرين! 🥊💪`;
  };

  const waUrl = trainer.phone ? buildWhatsAppDirectUrl(trainer.phone, buildWhatsAppText()) : null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`كشف الحساب المالي الموحد: كابتن ${trainer.fullName}`}
        widthClass="max-w-5xl"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.print()}
                className="gap-1.5 text-xs font-semibold"
              >
                <Printer className="size-3.5" />
                <span>طباعة الكشف</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportCsv}
                className="gap-1.5 text-xs font-semibold"
              >
                <FileSpreadsheet className="size-3.5 text-emerald-400" />
                <span>تصدير Excel</span>
              </Button>
              {waUrl && (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all"
                >
                  <MessageCircle className="size-3.5" />
                  <span>إرسال عبر واتساب</span>
                </a>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setPayoutAmount(
                    statement && statement.totals.netBalanceDueMinor > 0
                      ? String(statement.totals.netBalanceDueMinor / 100)
                      : "",
                  );
                  setPayoutOpen(true);
                }}
                className="gap-1.5 font-bold text-xs"
              >
                <DollarSign className="size-3.5" />
                <span>صرف دفعة للمدرب</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={onClose}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Header Card & Filter Bar */}
          <div className="rounded-2xl border border-white/5 bg-panel p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-extrabold text-foreground">{trainer.fullName}</h3>
                  <Badge variant="primary" className="text-xs">
                    {trainer.specialization || "مدرب معتمد"}
                  </Badge>
                  {trainer.rankTitle && (
                    <Badge variant="neutral" className="text-xs text-amber-400 border-amber-500/30">
                      {trainer.rankTitle}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-subtle mt-0.5">
                  هاتف: <span dir="ltr">{trainer.phone || "غير مسجل"}</span> · تاريخ الانضمام: {trainer.joinedDate}
                </p>
              </div>

              {/* Date Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-faint">من:</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-foreground focus:border-neon focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-faint">إلى:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-foreground focus:border-neon focus:outline-none"
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={loadData} className="text-xs">
                  تحديث
                </Button>
              </div>
            </div>

            {/* KPI Summary Cards */}
            {statement && (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 pt-2 border-t border-white/5">
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-center">
                  <span className="text-[11px] text-cyan-400 block font-medium">مستحقات تدريب خاص PT</span>
                  <div className="mt-1 flex items-baseline justify-center gap-1">
                    <span className="font-mono text-lg font-black text-foreground">
                      {formatMinor(statement.totals.totalPtEarningsMinor)}
                    </span>
                    <span className="text-[10px] text-faint">ج.م</span>
                  </div>
                  <span className="text-[10px] text-subtle block">({statement.totals.ptSessionsCount} حصة منفذة)</span>
                </div>

                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                  <span className="text-[11px] text-amber-400 block font-medium">أتعاب الأكاديميات والحصص</span>
                  <div className="mt-1 flex items-baseline justify-center gap-1">
                    <span className="font-mono text-lg font-black text-foreground">
                      {formatMinor(statement.totals.totalClassEarningsMinor)}
                    </span>
                    <span className="text-[10px] text-faint">ج.م</span>
                  </div>
                  <span className="text-[10px] text-subtle block">({statement.totals.classSessionsCount} حصة منتهية)</span>
                </div>

                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-center">
                  <span className="text-[11px] text-rose-400 block font-medium">إجمالي المنصرف (دفعات/سلف)</span>
                  <div className="mt-1 flex items-baseline justify-center gap-1">
                    <span className="font-mono text-lg font-black text-rose-400">
                      {formatMinor(statement.totals.totalPayoutsMinor)}
                    </span>
                    <span className="text-[10px] text-faint">ج.م</span>
                  </div>
                  <span className="text-[10px] text-subtle block">({statement.totals.payoutsCount} دفعة مسجلة)</span>
                </div>

                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                  <span className="text-[11px] text-emerald-400 block font-extrabold">صافي الرصيد المستحق</span>
                  <div className="mt-1 flex items-baseline justify-center gap-1">
                    <span className="font-mono text-xl font-black text-emerald-400">
                      {formatMinor(statement.totals.netBalanceDueMinor)}
                    </span>
                    <span className="text-[10px] text-emerald-500">ج.م</span>
                  </div>
                  <span className="text-[10px] text-emerald-300/80 block">جاهز للصرف والتسليم</span>
                </div>
              </div>
            )}
          </div>

          {/* Statement Detailed Ledger Table */}
          {loading ? (
            <p className="py-12 text-center text-xs text-subtle">جاري إعداد كشف الحساب التفصيلي...</p>
          ) : !statement || statement.items.length === 0 ? (
            <EmptyState
              icon={<Wallet className="size-6 text-faint" />}
              title="لا توجد حركات مالية في هذه الفترة"
              description="لم يتم تسجيل أي حصص PT أو حصص جماعية أو دفعات منصرفة للمدرب خلال هذه الفترة الزمنية."
            />
          ) : (
            <div className="rounded-2xl border border-line bg-surface overflow-hidden">
              <div className="max-h-[50vh] overflow-y-auto">
                <table className="w-full text-start text-xs">
                  <thead className="bg-panel/80 sticky top-0 border-b border-line text-[11px] font-bold text-subtle">
                    <tr>
                      <th className="py-2.5 ps-4 pe-2 text-start">التاريخ</th>
                      <th className="py-2.5 px-2 text-start">النوع والبيان</th>
                      <th className="py-2.5 px-2 text-start">التفاصيل / ملاحظات</th>
                      <th className="py-2.5 px-2 text-end text-emerald-400">مستحق للمدرب (+)</th>
                      <th className="py-2.5 px-2 text-end text-rose-400">منصرف منه (-)</th>
                      <th className="py-2.5 ps-2 pe-4 text-end">الرصيد التراكمي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {statement.items.map((item) => {
                      const isPt = item.type === "pt_session";
                      const isClass = item.type === "class_session";

                      return (
                        <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-2.5 ps-4 pe-2 font-mono text-[11px] text-subtle whitespace-nowrap">
                            {item.date}
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-1.5">
                              {isPt ? (
                                <Badge variant="primary" className="text-[10px] px-1.5 py-0.5">
                                  PT خاص
                                </Badge>
                              ) : isClass ? (
                                <Badge variant="neutral" className="text-[10px] text-amber-400 border-amber-500/20 px-1.5 py-0.5">
                                  حصة جماعية
                                </Badge>
                              ) : (
                                <Badge variant="danger" className="text-[10px] px-1.5 py-0.5">
                                  سداد دفعة
                                </Badge>
                              )}
                              <span className="font-bold text-foreground truncate max-w-[220px]" title={item.title}>
                                {item.title}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-subtle text-[11px]">
                            {item.subtitle && <span className="block">{item.subtitle}</span>}
                            {item.notes && <span className="text-faint text-[10px] block">{item.notes}</span>}
                          </td>
                          <td className="py-2.5 px-2 text-end font-mono font-bold text-emerald-400 whitespace-nowrap tabnum">
                            {item.creditMinor > 0 ? `+${formatMinor(item.creditMinor)}` : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-end font-mono font-bold text-rose-400 whitespace-nowrap tabnum">
                            {item.debitMinor > 0 ? `-${formatMinor(item.debitMinor)}` : "—"}
                          </td>
                          <td className="py-2.5 ps-2 pe-4 text-end font-mono font-black text-foreground whitespace-nowrap tabnum">
                            {formatMinor(item.balanceMinor)} ج.م
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Quick Payout Modal */}
      {payoutOpen && (
        <Modal
          open={payoutOpen}
          onClose={() => setPayoutOpen(false)}
          title={`تسجيل صرف دفعة للمدرب: ${trainer.fullName}`}
          widthClass="max-w-md"
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setPayoutOpen(false)} disabled={paying}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={handleQuickPayout} loading={paying} disabled={paying}>
                تأكيد الصرف وتحديث الخزينة
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5">
            <Input
              label="المبلغ المراد صرفه (بالجنيه)"
              type="number"
              min={1}
              value={payoutAmount}
              onChange={(e) => setPayoutAmount(e.target.value)}
              placeholder="0.00"
              dir="ltr"
              autoFocus
            />

            <div>
              <label className="block text-xs font-medium text-subtle mb-1">طريقة الدفع والصرف</label>
              <select
                value={payoutMethod}
                onChange={(e) => setPayoutMethod(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs text-foreground focus:border-neon focus:outline-none"
              >
                <option value="cash">نقداً من الخزينة الرئيسية (كاش)</option>
                <option value="card">تحويل بنكي / فودافون كاش / إنستاباي</option>
                <option value="check">شيك مصرفي</option>
              </select>
            </div>

            <Input
              label="ملاحظات وسند الصرف"
              value={payoutNotes}
              onChange={(e) => setPayoutNotes(e.target.value)}
              placeholder="مثال: سداد أتعاب حصص الأسبوع الثاني"
            />
          </div>
        </Modal>
      )}
    </>
  );
}
