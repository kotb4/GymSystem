import { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api";
import { todayKey, diffDaysKeys, addDaysKey } from "@/core/dates";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { useT } from "@/i18n";
import { Snowflake, CheckCircle2, X, User } from "lucide-react";
import { playSuccessChime, playErrorBuzz } from "@/utils/sound";

export interface FrozenDecisionModalProps {
  open: boolean;
  onClose: () => void;
  member: {
    id: string;
    fullName: string;
    memberCode: string;
    photoFileId?: string | null;
  };
  subscription: {
    id: string;
    planName: string | null;
    endDate: string;
    startDate?: string;
  };
  freeze: {
    startDate: string;
    durationDays?: number;
    notes?: string | null;
  };
  onSuccess: (checkInResult: any) => void;
}

export function FrozenDecisionModal({
  open,
  onClose,
  member,
  subscription,
  freeze,
  onSuccess,
}: FrozenDecisionModalProps) {
  const t = useT();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayKey();
  const rawElapsed = diffDaysKeys(freeze.startDate, today);
  const maxAllowed = freeze.durationDays != null ? Number(freeze.durationDays) : 999;
  const actualFrozenDays = Math.max(0, Math.min(rawElapsed, maxAllowed));
  const projectedEndDate = addDaysKey(subscription.endDate, actualFrozenDays);

  const handleConfirm = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Unfreeze subscription with exact elapsed days compensation
      await api.subscriptions.unfreeze(subscription.id);
      // 2. Check-in immediately
      const result = await api.reception.checkIn({
        memberId: member.id,
        deviceIdentifier: "reception",
      });
      void api.settings.soundEnabled().then((on) => {
        if (on) playSuccessChime();
      });
      toast("success", `تم فك تجميد الاشتراك وتسجيل حضور (${member.fullName}) بنجاح`);
      onSuccess(result);
      onClose();
    } catch (err) {
      void api.settings.soundEnabled().then((on) => {
        if (on) playErrorBuzz();
      });
      setError(describeError(err, t));
    } finally {
      setLoading(false);
    }
  }, [loading, subscription.id, member.id, member.fullName, t, toast, onSuccess, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void handleConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, handleConfirm, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="قرار فك التجميد وتسجيل الحضور"
      widthClass="max-w-lg"
    >
      <div className="space-y-4 p-1">
        {/* Header alert */}
        <div className="flex items-start gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3.5 text-cyan-200">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-500/20 text-cyan-400">
            <Snowflake className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold text-foreground">الاشتراك متجمّد حالياً</h4>
            <p className="mt-0.5 text-xs text-subtle leading-relaxed">
              قام العضو بتمرير الكارت أثناء فترة التجميد. هل ترغب في فك التجميد وتسجيل الحضور الآن؟
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-red/30 bg-red/10 p-3 text-xs font-semibold text-red">
            {error}
          </div>
        )}

        {/* Member profile snippet */}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface/50 p-3">
          {member.photoFileId ? (
            <img
              src={api.files.url(member.photoFileId)}
              alt={member.fullName}
              className="size-12 shrink-0 rounded-xl object-cover border border-line"
            />
          ) : (
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/5 text-subtle">
              <User className="size-6" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-foreground truncate">{member.fullName}</span>
              <Badge variant="warning">
                مجمّد
              </Badge>
            </div>
            <p className="text-xs text-subtle font-mono mt-0.5">{member.memberCode}</p>
          </div>
        </div>

        {/* Subscription & Compensation Breakdown */}
        <div className="rounded-xl border border-line/80 bg-surface/30 p-3.5 space-y-3 text-xs">
          <div className="flex items-center justify-between border-b border-line/50 pb-2">
            <span className="text-subtle font-medium">اسم الباقة / الاشتراك:</span>
            <span className="font-bold text-foreground">{subscription.planName || "اشتراك عام"}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 border-b border-line/50 pb-2.5">
            <div>
              <span className="block text-subtle font-medium text-[11px]">تاريخ بدء التجميد:</span>
              <span dir="ltr" className="font-mono font-bold text-foreground">{freeze.startDate}</span>
            </div>
            <div>
              <span className="block text-subtle font-medium text-[11px]">الأيام الفعلية المستحقة:</span>
              <span className="font-mono font-bold text-neon">
                {actualFrozenDays > 0 ? `+${actualFrozenDays} يوم تعويض` : "0 يوم (فك في نفس اليوم)"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-0.5">
            <div>
              <span className="block text-subtle font-medium text-[11px]">تاريخ الانتهاء الحالي:</span>
              <span dir="ltr" className="font-mono text-subtle">{subscription.endDate}</span>
            </div>
            <div>
              <span className="block text-cyan-300 font-bold text-[11px]">تاريخ الانتهاء الجديد المتوقع:</span>
              <span dir="ltr" className="font-mono font-black text-cyan-400 text-sm">
                {projectedEndDate}
              </span>
            </div>
          </div>
        </div>

        {/* Keyboard hints info */}
        <div className="flex items-center justify-between text-[11px] text-subtle px-1">
          <span>
            اضغط <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">Enter</kbd> للتأكيد والحضور
          </span>
          <span>
            اضغط <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground">Esc</kbd> للإلغاء وتركه مجمداً
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-line/60">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <X className="size-3.5" />
            <span>إلغاء وفحص فقط (Esc)</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={() => void handleConfirm()}
            loading={loading}
            disabled={loading}
            className="gap-2 text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white border-cyan-400"
          >
            {!loading && <CheckCircle2 className="size-4" />}
            <span>فك التجميد وتسجيل الحضور (Enter)</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
