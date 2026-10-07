import { useEffect, useState } from "react";
import { UserCheck, Clock, LockKeyhole } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type StaffShift, type ShiftSummary } from "@/api";
import { formatMinor, toMinor } from "@/core/money";
import { formatDateShort } from "@/services/format";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface StaffShiftsModalProps {
  open: boolean;
  onClose: () => void;
}

export function StaffShiftsModal({ open, onClose }: StaffShiftsModalProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [activeShift, setActiveShift] = useState<StaffShift | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [recentShifts, setRecentShifts] = useState<StaffShift[]>([]);
  const [openingCashMajor, setOpeningCashMajor] = useState("0");
  const [countedCashMajor, setCountedCashMajor] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const loadData = async () => {
    try {
      const active = await api.shifts.getActive();
      setActiveShift(active);
      if (active) {
        const sum = await api.shifts.getSummary(active.id);
        setSummary(sum);
      } else {
        setSummary(null);
      }
      const list = await api.shifts.list({ limit: 10 });
      setRecentShifts(list);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (open) {
      void loadData();
      setOpeningCashMajor("0");
      setCountedCashMajor("");
      setNotes("");
    }
  }, [open]);

  const onOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.shifts.open({
        openingCashMinor: toMinor(openingCashMajor || "0"),
        notes: notes.trim() || null,
      });
      toast("success", "تم فتح وردية الموظف بنجاح");
      setNotes("");
      void loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!countedCashMajor.trim()) {
      toast("error", "يرجى إدخال المبلغ الفعلي في الدرج");
      return;
    }
    setBusy(true);
    try {
      await api.shifts.close({
        countedCashMinor: toMinor(countedCashMajor),
        notes: notes.trim() || null,
      });
      toast("success", "تم إغلاق الوردية وحفظ تقرير التسليم بنجاح");
      setCountedCashMajor("");
      setNotes("");
      void loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ورديات الموظفين وتسليم الدرج (Staff Shifts)"
    >
      <div className="space-y-6">
        {/* Active Shift or Open Shift Form */}
        {activeShift ? (
          <div className="rounded-2xl border border-neon/30 bg-neon/5 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-neon/20 text-neon font-black">
                  <UserCheck className="size-5" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-base">
                    وردية مفتوحة حالياً: {activeShift.userName}
                  </h3>
                  <p className="text-xs text-subtle flex items-center gap-1.5 mt-0.5" dir="ltr">
                    <Clock className="size-3.5" />
                    بدأت: {formatDateShort(new Date(activeShift.openedAt))}
                  </p>
                </div>
              </div>
              <Badge variant="success">نشطة الآن</Badge>
            </div>

            {/* Shift Financial Stats */}
            {summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-line bg-panel p-3 text-center">
                  <span className="text-[11px] text-subtle block mb-1">الرصيد الافتتاحي</span>
                  <span className="text-base font-black text-foreground tabnum" dir="ltr">
                    {formatMinor(activeShift.openingCashMinor)}
                  </span>
                </div>
                <div className="rounded-xl border border-line bg-panel p-3 text-center">
                  <span className="text-[11px] text-subtle block mb-1">تحصيل اشتراكات (كاش)</span>
                  <span className="text-base font-black text-neon tabnum" dir="ltr">
                    {formatMinor(summary.paymentsCashMinor)}
                  </span>
                </div>
                <div className="rounded-xl border border-line bg-panel p-3 text-center">
                  <span className="text-[11px] text-subtle block mb-1">مبيعات متجر (كاش)</span>
                  <span className="text-base font-black text-cyan tabnum" dir="ltr">
                    {formatMinor(summary.storeSalesCashMinor)}
                  </span>
                </div>
                <div className="rounded-xl border border-line bg-panel p-3 text-center">
                  <span className="text-[11px] text-subtle block mb-1">مصروفات درج (كاش)</span>
                  <span className="text-base font-black text-amber tabnum" dir="ltr">
                    {formatMinor(summary.expensesCashMinor)}
                  </span>
                </div>
              </div>
            )}

            {/* Expected Cash in Hand */}
            {summary && (
              <div className="rounded-xl border border-line bg-panel/80 p-4 flex items-center justify-between">
                <div>
                  <span className="text-xs text-subtle block">النقد المتوقع تسليمه بالدرج (Expected Cash)</span>
                  <span className="text-xs text-faint">
                    (الافتتاحي + اشتراكات + متجر - مصروفات)
                  </span>
                </div>
                <div className="text-2xl font-black text-emerald tabnum" dir="ltr">
                  {formatMinor(summary.shift.expectedCashMinor)}
                </div>
              </div>
            )}

            {/* Close Shift Form */}
            {hasPermission("shifts.manage") && (
              <form onSubmit={onCloseShift} className="border-t border-line/60 pt-4 space-y-3">
                <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <LockKeyhole className="size-4 text-amber" />
                  إغلاق الوردية وتسليم النقدية
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="المبلغ الفعلي المحسوب في الدرج (ج.م) *"
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    value={countedCashMajor}
                    onChange={(e) => setCountedCashMajor(e.target.value)}
                    placeholder="0.00"
                    disabled={busy}
                    required
                  />
                  <Input
                    label="ملاحظات التسليم (اختياري)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="ملاحظات تسليم الوردية..."
                    disabled={busy}
                  />
                </div>
                {countedCashMajor && summary && (
                  <div className="text-xs p-2.5 rounded-lg border bg-panel">
                    الفارق المحسوب:{" "}
                    <span
                      dir="ltr"
                      className={`font-black ${
                        toMinor(countedCashMajor) >= summary.shift.expectedCashMinor
                          ? "text-emerald"
                          : "text-red"
                      }`}
                    >
                      {formatMinor(toMinor(countedCashMajor) - summary.shift.expectedCashMinor)}
                    </span>
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
                    <LockKeyhole className="size-4" />
                    إغلاق الوردية وترحيل الحساب
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : (
          hasPermission("shifts.manage") && (
            <form onSubmit={onOpenShift} className="rounded-2xl border border-line bg-panel p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-xl bg-neon/20 text-neon font-black">
                  <Clock className="size-5" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-base">بدء وردية جديدة للموظف الحالي</h3>
                  <p className="text-xs text-subtle">
                    قم بإدخال رصيد البداية في درج الكاشير إن وُجد لبدء احتساب الإيرادات والمصروفات بدقة.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="رصيد بداية الدرج (ج.م)"
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={openingCashMajor}
                  onChange={(e) => setOpeningCashMajor(e.target.value)}
                  placeholder="0.00"
                  disabled={busy}
                />
                <Input
                  label="ملاحظات البداية (اختياري)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات استلام الدرج..."
                  disabled={busy}
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={busy} disabled={busy}>
                  <UserCheck className="size-4" />
                  بدء الوردية الآن
                </Button>
              </div>
            </form>
          )
        )}

        {/* Recent Shifts Table */}
        <div>
          <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <Clock className="size-4 text-subtle" />
            سجل آخر الورديات السابقة
          </h4>
          {recentShifts.length > 0 ? (
            <div className="divide-y divide-line/60 border border-line rounded-xl overflow-hidden bg-panel">
              {recentShifts.map((s) => (
                <div key={s.id} className="p-3.5 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-bold text-foreground flex items-center gap-2">
                      <span>{s.userName}</span>
                      <Badge variant={s.status === "open" ? "success" : "neutral"}>
                        {s.status === "open" ? "مفتوحة" : "مغلقة"}
                      </Badge>
                    </div>
                    <div className="text-xs text-subtle mt-1" dir="ltr">
                      بدأت: {formatDateShort(new Date(s.openedAt))}
                      {s.closedAt && ` • أغلقت: ${formatDateShort(new Date(s.closedAt))}`}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="font-bold tabnum" dir="ltr">
                      المتوقع: {formatMinor(s.expectedCashMinor)}
                    </div>
                    {s.differenceMinor != null && (
                      <div
                        className={`text-xs tabnum ${
                          s.differenceMinor >= 0 ? "text-emerald" : "text-red"
                        }`}
                        dir="ltr"
                      >
                        الفارق: {formatMinor(s.differenceMinor)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-sm text-subtle border border-line/40 rounded-xl">
              لا توجد ورديات مسجلة حتى الآن
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
