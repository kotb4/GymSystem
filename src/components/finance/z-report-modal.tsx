import { useEffect, useState, type FormEvent } from "react";
import {
  Calculator,
  CheckCircle2,
  LockKeyhole,
  ReceiptText,
  ShieldAlert,
  Wallet,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type {
  CashTotalsForOpen,
  CashSession,
} from "@/core/services/cash-session.service";
import { formatMinor, toMinor } from "@/core/money";
import { formatDateShort, formatTime } from "@/services/format";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoucherActions } from "@/components/finance/voucher-actions";
import { cn } from "@/utils/cn";

export interface ZReportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ZReportModal({ open, onClose, onSuccess }: ZReportModalProps) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTotals, setOpenTotals] = useState<(CashTotalsForOpen & { session: CashSession }) | null>(null);

  const [countedMajor, setCountedMajor] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [calcOpen, setCalcOpen] = useState(false);

  const [closedResult, setClosedResult] = useState<{
    id: string;
    closingNo: string | null;
    countedMinor: number;
    expectedMinor: number;
    differenceMinor: number;
    closeNote: string | null;
  } | null>(null);

  const loadOpenSession = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.cash.openTotals();
      setOpenTotals(res as (CashTotalsForOpen & { session: CashSession }) | null);
      setCountedMajor("");
      setCloseNote("");
      setClosedResult(null);
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadOpenSession();
    }
  }, [open]);

  const isOpener = Boolean(actor && openTotals && actor.userId === openTotals.session.openedById);
  const isOwner = Boolean(actor && actor.roleId === "owner");
  const canClose = isOpener || isOwner;

  const countedMinor = countedMajor !== "" ? toMinor(countedMajor) : null;
  const differenceMinor =
    openTotals && countedMinor !== null ? countedMinor - openTotals.expectedMinor : null;

  const handleCloseSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!openTotals || countedMajor === "") return;
    setBusy(true);
    setError(null);
    try {
      const closed = await api.cash.close(openTotals.session.id, {
        countedClosingMinor: toMinor(countedMajor),
        closeNote: closeNote.trim() || null,
      });

      setClosedResult({
        id: closed.id,
        closingNo: closed.closingNo ?? null,
        countedMinor: toMinor(countedMajor),
        expectedMinor: openTotals.expectedMinor,
        differenceMinor: toMinor(countedMajor) - openTotals.expectedMinor,
        closeNote: closeNote.trim() || null,
      });

      toast("success", "تم إقفال الوردية بنجاح وإصدار تقرير Z-Report");
      onSuccess?.();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="⚡ إقفال الوردية اليومية (Daily Z-Report & Cash Closing)"
      widthClass="max-w-2xl"
    >
      <div className="space-y-4 py-1">
        {loading ? (
          <div className="flex h-44 items-center justify-center">
            <span className="text-xs text-subtle animate-pulse">جاري فحص حالة الوردية ورصيد الخزينة...</span>
          </div>
        ) : closedResult ? (
          /* Post-Closing Z-Report Summary & Voucher Actions */
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-400">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-6 shrink-0" />
                <div>
                  <h4 className="text-base font-extrabold text-white">
                    تم إقفال الوردية بنجاح وحفظ الجرد النهائي
                  </h4>
                  <p className="text-xs text-slate-300 mt-0.5">
                    رقم الإقفال المالي:{" "}
                    <span dir="ltr" className="font-mono font-bold text-emerald-400">
                      {closedResult.closingNo ?? closedResult.id.slice(0, 8)}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-line bg-panel p-3 text-center">
                <span className="text-[11px] font-medium text-subtle block">الرصيد المتوقع</span>
                <span dir="ltr" className="text-base font-black text-white tabnum">
                  {formatMinor(closedResult.expectedMinor)}
                </span>
                <span className="text-[10px] text-faint block">ج.م</span>
              </div>
              <div className="rounded-xl border border-line bg-panel p-3 text-center">
                <span className="text-[11px] font-medium text-subtle block">الرصيد الفعلي المعدود</span>
                <span dir="ltr" className="text-base font-black text-neon tabnum">
                  {formatMinor(closedResult.countedMinor)}
                </span>
                <span className="text-[10px] text-faint block">ج.م</span>
              </div>
              <div className="rounded-xl border border-line bg-panel p-3 text-center">
                <span className="text-[11px] font-medium text-subtle block">فرق الجرد (المطابقة)</span>
                <span
                  dir="ltr"
                  className={cn(
                    "text-base font-black tabnum",
                    closedResult.differenceMinor === 0
                      ? "text-emerald-400"
                      : closedResult.differenceMinor > 0
                      ? "text-amber-400"
                      : "text-rose-400",
                  )}
                >
                  {closedResult.differenceMinor === 0
                    ? "مطابق تماماً"
                    : `${closedResult.differenceMinor > 0 ? "+" : ""}${formatMinor(closedResult.differenceMinor)}`}
                </span>
                <span className="text-[10px] text-faint block">
                  {closedResult.differenceMinor === 0
                    ? "لا يوجد فرق"
                    : closedResult.differenceMinor > 0
                    ? "فائض بالخزينة"
                    : "عجز بالخزينة"}
                </span>
              </div>
            </div>

            {closedResult.closeNote && (
              <div className="rounded-xl border border-line bg-panel/50 p-3 text-xs text-subtle">
                <span className="font-bold text-white">ملاحظة الإغلاق: </span>
                {closedResult.closeNote}
              </div>
            )}

            {/* Official Voucher Printing & Export */}
            <div className="rounded-xl border border-neon/30 bg-neon/5 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-white flex items-center gap-1.5">
                  <ReceiptText className="size-4 text-neon" />
                  <span>محضر إقفال الخزينة وسند التسليم (Z-Report)</span>
                </p>
                <p className="text-[11px] text-subtle mt-0.5">
                  يمكنك طباعة سند الإقفال فورياً أو تحميل نسخة PDF موقعة للأرشيف الإداري.
                </p>
              </div>
              <div className="shrink-0">
                <VoucherActions kind="cash_closing" rowId={closedResult.id} size="md" />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={onClose} className="px-6 font-bold text-xs">
                إغلاق النافذة
              </Button>
            </div>
          </div>
        ) : !openTotals ? (
          /* No Open Session in Progress */
          <div className="space-y-4 py-6 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-zinc-800 text-zinc-400">
              <Wallet className="size-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">لا توجد وردية مفتوحة حالياً بالخزينة</h4>
              <p className="text-xs text-subtle mt-1 max-w-md mx-auto">
                الخزينة مغلقة حالياً. لا يمكنك عمل جرد أو إقفال Z-Report إلا بعد استلام الدرج وفتح وردية جديدة من شاشة الورديات.
              </p>
            </div>
            <div className="flex justify-center gap-2 pt-2">
              <Button variant="secondary" onClick={onClose}>
                إغلاق
              </Button>
            </div>
          </div>
        ) : (
          /* Active Open Session: Reconciliation & Closing Form */
          <form onSubmit={handleCloseSession} className="space-y-4">
            {/* Opener & Timing Telemetry Strip */}
            <div className="rounded-2xl border border-line bg-panel/70 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
                  </span>
                  <span className="font-bold text-white">الوردية الحالية نشطة ومفتوحة</span>
                </div>
                <span className="text-[11px] text-subtle">
                  بدأت:{" "}
                  <span className="font-bold text-foreground">
                    {formatDateShort(new Date(openTotals.session.openedAt.replace(" ", "T")))} •{" "}
                    {formatTime(openTotals.session.openedAt)}
                  </span>
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-white/5 text-xs">
                <div>
                  <span className="text-[10px] text-subtle block">الموظف المستلم</span>
                  <span className="font-bold text-white truncate block">{openTotals.session.openedByName}</span>
                </div>
                <div>
                  <span className="text-[10px] text-subtle block">الرصيد الافتتاحي</span>
                  <span dir="ltr" className="font-bold tabnum text-subtle block">
                    {formatMinor(openTotals.openingMinor)} ج.م
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-subtle block">المقبوضات النقدية (+)</span>
                  <span dir="ltr" className="font-bold tabnum text-emerald-400 block">
                    +{formatMinor(openTotals.cashInMinor)} ج.م
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-subtle block">المنصرفات والمسحوبات (-)</span>
                  <span dir="ltr" className="font-bold tabnum text-rose-400 block">
                    -{formatMinor(openTotals.cashOutMinor)} ج.م
                  </span>
                </div>
              </div>
            </div>

            {/* Expected Cash in Drawer */}
            <div className="rounded-2xl border border-neon/40 bg-neon/10 p-4 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">
                  الرصيد الدفتري المتوقع بالدرج (Expected Balance)
                </span>
                <span className="text-[11px] text-subtle">
                  = الافتتاحي ({formatMinor(openTotals.openingMinor)}) + المقبوضات ({formatMinor(openTotals.cashInMinor)}) − المنصرفات ({formatMinor(openTotals.cashOutMinor)})
                </span>
              </div>
              <div className="text-end">
                <span dir="ltr" className="text-2xl font-black text-neon tabnum">
                  {formatMinor(openTotals.expectedMinor)}
                </span>
                <span className="ms-1 text-xs font-bold text-neon">ج.م</span>
              </div>
            </div>

            {/* Ownership Warning */}
            {isOwner && !isOpener && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs font-bold text-amber-400 flex items-center gap-2">
                <ShieldAlert className="size-4 shrink-0" />
                <span>إغلاق استثنائي: أنت تقوم بإغلاق الوردية نيابة عن ({openTotals.session.openedByName}) بصلاحية المالك.</span>
              </div>
            )}

            {!canClose && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-bold text-rose-400 flex items-center gap-2">
                <ShieldAlert className="size-4 shrink-0" />
                <span>تنبيه: لا يحق إلا للموظف المستلم ({openTotals.session.openedByName}) أو المالك إغلاق هذه الوردية.</span>
              </div>
            )}

            {/* Counted Cash Input & Denomination Calculator Toggle */}
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-white">
                      الرصيد الفعلي المعدود بالدرج (ج.م) *
                    </label>
                    <button
                      type="button"
                      onClick={() => setCalcOpen((v) => !v)}
                      className="flex items-center gap-1 text-[11px] font-bold text-neon hover:underline"
                    >
                      <Calculator className="size-3" />
                      {calcOpen ? "إخفاء الحاسبة" : "🧮 حاسبة عد الفئات"}
                    </button>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    placeholder="0.00"
                    value={countedMajor}
                    onChange={(e) => setCountedMajor(e.target.value)}
                    disabled={busy || !canClose}
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-white">ملاحظات الإقفال (اختياري)</label>
                  <Input
                    placeholder="أي ملاحظات حول الجرد أو التسليم..."
                    value={closeNote}
                    onChange={(e) => setCloseNote(e.target.value)}
                    disabled={busy || !canClose}
                  />
                </div>
              </div>

              {/* Embedded Denomination Calculator */}
              {calcOpen && (
                <ModalDenominationCalculator
                  onApply={(totalVal) => {
                    setCountedMajor(totalVal);
                    setCalcOpen(false);
                    toast("info", `تم اعتماد الرصيد المعدود: ${totalVal} ج.م`);
                  }}
                />
              )}
            </div>

            {/* Live Discrepancy Alert */}
            {differenceMinor !== null && Number.isFinite(differenceMinor) && (
              <div
                className={cn(
                  "rounded-2xl border p-3.5 flex items-center justify-between text-sm font-extrabold transition-all",
                  differenceMinor === 0
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : differenceMinor > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-400",
                )}
              >
                <div className="flex items-center gap-2">
                  {differenceMinor === 0 ? (
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="size-5 shrink-0" />
                  )}
                  <div>
                    <span>نتيجة الجرد والمطابقة: </span>
                    <span className="text-xs block font-normal opacity-90">
                      {differenceMinor === 0
                        ? "الرصيد الفعلي مطابق تماماً للرصيد الدفتري المتوقع."
                        : differenceMinor > 0
                        ? "يوجد فائض نقدي في الدرج سيتم توثيقه في السجل الدائم."
                        : "يوجد عجز نقدي في الدرج سيتم توثيقه في السجل الدائم وتنبيه الإدارة."}
                    </span>
                  </div>
                </div>

                <div className="text-end">
                  <span dir="ltr" className="text-base font-black tabnum">
                    {differenceMinor === 0
                      ? "0.00 ج.م"
                      : `${differenceMinor > 0 ? "+" : ""}${formatMinor(differenceMinor)} ج.م`}
                  </span>
                  <span className="block text-[10px] font-bold">
                    {differenceMinor === 0
                      ? "مطابق 🟢"
                      : differenceMinor > 0
                      ? "فائض 🟡"
                      : "عجز 🔴"}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs font-semibold text-rose-400">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between border-t border-line/60 pt-3">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                إلغاء
              </Button>

              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={busy || countedMajor === "" || !canClose}
                className="gap-2 font-bold px-6 shadow-md shadow-neon/15"
              >
                <LockKeyhole className="size-4" />
                <span>إقفال الوردية واعتماد تقرير Z-Report</span>
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

/** Denomination Calculator Component */
function ModalDenominationCalculator({
  onApply,
}: {
  onApply: (totalMajor: string) => void;
}) {
  const [denoms, setDenoms] = useState<Record<number, number>>({
    200: 0,
    100: 0,
    50: 0,
    20: 0,
    10: 0,
    5: 0,
    1: 0,
  });

  const total = Object.entries(denoms).reduce((acc, [denom, count]) => {
    return acc + Number(denom) * (Number(count) || 0);
  }, 0);

  const reset = () => {
    setDenoms({ 200: 0, 100: 0, 50: 0, 20: 0, 10: 0, 5: 0, 1: 0 });
  };

  const update = (d: number, count: string) => {
    const val = Math.max(0, parseInt(count, 10) || 0);
    setDenoms((prev) => ({ ...prev, [d]: val }));
  };

  return (
    <div className="rounded-2xl border border-line/60 bg-panel p-3.5 space-y-3">
      <div className="flex items-center justify-between border-b border-line/30 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-white">
          <Calculator className="size-4 text-neon" />
          <span>حاسبة عد النقدية والفئات الورقية (الجنيه المصري)</span>
        </div>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1 text-[11px] text-faint hover:text-rose-400 transition-colors"
        >
          <RotateCcw className="size-3" />
          <span>تفريغ العداد</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {[200, 100, 50, 20, 10, 5, 1].map((d) => (
          <div key={d} className="flex flex-col gap-1 p-2 rounded-xl bg-surface border border-line/40">
            <div className="flex items-center justify-between text-[11px] font-semibold text-subtle">
              <span>فئة {d} ج.م</span>
              <span className="font-mono text-faint">={(denoms[d] || 0) * d}</span>
            </div>
            <input
              type="number"
              min={0}
              placeholder="0"
              value={denoms[d] || ""}
              onChange={(e) => update(d, e.target.value)}
              className="h-8 w-full rounded-lg border border-line/50 bg-panel px-2 text-center font-mono text-xs text-white focus:border-neon focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line/30">
        <div className="text-xs">
          <span className="text-subtle">الإجمالي المحسوب: </span>
          <span dir="ltr" className="font-mono text-sm font-black text-neon">{total} ج.م</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onApply(String(total))}
          disabled={total <= 0}
          className="text-xs h-7 px-3 border border-neon/40 text-neon hover:bg-neon/10 font-bold"
        >
          اعتماد المبلغ: {total} ج.م
        </Button>
      </div>
    </div>
  );
}
