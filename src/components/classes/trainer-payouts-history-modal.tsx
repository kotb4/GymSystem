import { useState, useEffect } from "react";
import { Banknote, Calendar, Trash2, User } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicTrainer, type TrainerPayout } from "@/api";
import { formatMinor } from "@/core/money";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";

interface Props {
  open: boolean;
  onClose: () => void;
  trainer: PublicTrainer | null;
}

const TYPE_LABELS: Record<string, string> = {
  monthly_salary: "مرتب شهري",
  academy_fee: "أتعاب أكاديمية",
  pt_commission: "نسبة تدريب خاص",
  bonus: "مكافأة",
  advance: "سلفة نقدية",
  other: "دفعة نقدية",
};

export function TrainerPayoutsHistoryModal({ open, onClose, trainer }: Props) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("trainers.manage");

  const [payouts, setPayouts] = useState<TrainerPayout[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = () => {
    if (!trainer) return;
    setLoading(true);
    api.trainers
      .listPayouts(trainer.id)
      .then(setPayouts)
      .catch((err) => toast("error", describeError(err, t)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open && trainer) {
      loadData();
    }
  }, [open, trainer]);

  if (!open || !trainer) return null;

  const totalPaidMinor = payouts.reduce((sum, p) => sum + p.amountMinor, 0);

  const handleDelete = async (payoutId: string) => {
    if (!window.confirm("هل أنت متأكد من حذف هذه الدفعة وإلغاء تسجيل المصروف من الخزينة؟")) return;
    setDeletingId(payoutId);
    try {
      await api.trainers.deletePayout(payoutId);
      toast("success", "تم حذف الدفعة بنجاح");
      loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={trainer ? `سجل دفعات ومستحقات المدرب: ${trainer.fullName}` : "سجل دفعات المدرب"}
      widthClass="max-w-2xl"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Summary Card */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel p-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <User className="size-4" />
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">{trainer.fullName}</p>
              <p className="text-xs text-subtle">{trainer.specialization || "مدرب صالة"}</p>
            </div>
          </div>
          <div className="text-end">
            <span className="text-xs text-subtle block">إجمالي ما تم صرفه</span>
            <span dir="ltr" className="font-mono text-base font-extrabold text-emerald-400">
              {formatMinor(totalPaidMinor)}
            </span>
          </div>
        </div>

        {/* Payouts List */}
        {loading ? (
          <p className="py-8 text-center text-xs text-subtle">جاري تحميل السجل...</p>
        ) : payouts.length === 0 ? (
          <EmptyState
            icon={<Banknote className="size-6 text-faint" />}
            title="لا توجد دفعات منصرفة"
            description="لم يتم صرف أي دفعات نقدية مسجلة لهذا المدرب بعد."
          />
        ) : (
          <div className="divide-y divide-line rounded-2xl border border-line bg-surface overflow-hidden max-h-[50vh] overflow-y-auto">
            {payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 p-3.5 hover:bg-white/[0.02] transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span dir="ltr" className="font-mono font-bold text-sm text-emerald-400">
                      {formatMinor(p.amountMinor)}
                    </span>
                    <Badge variant="primary" className="text-[11px]">
                      {TYPE_LABELS[p.payoutType] || p.payoutType}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-subtle">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3 text-faint" />
                      <span dir="ltr">{p.payoutDate}</span>
                    </span>
                    <span>·</span>
                    <span>طريقة الدفع: {p.methodCode}</span>
                    {p.notes && (
                      <>
                        <span>·</span>
                        <span className="text-foreground font-medium">{p.notes}</span>
                      </>
                    )}
                  </div>
                </div>

                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red hover:bg-red/10"
                    title="حذف الدفعة"
                    loading={deletingId === p.id}
                    disabled={deletingId !== null}
                    onClick={() => handleDelete(p.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
