import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { todayKey, isValidDateKey, diffDaysKeys } from "@/core/dates";
import { api, type FreezeInfo, type Subscription } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";

interface FreezeSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  subscription: Subscription | null;
}

const FREEZE_REASONS: Array<{ value: string; labelKey: string }> = [
  { value: "illness", labelKey: "subs.freezeReasonIllness" },
  { value: "travel", labelKey: "subs.freezeReasonTravel" },
  { value: "work", labelKey: "subs.freezeReasonWork" },
  { value: "personal", labelKey: "subs.freezeReasonPersonal" },
  { value: "other", labelKey: "subs.freezeReasonOther" },
];

export function FreezeSubscriptionModal({
  open,
  onClose,
  onSaved,
  subscription,
}: FreezeSubscriptionModalProps) {
  const t = useT();
  const { toast } = useToast();
  const { hasPermission } = useAuth();

  const sub = subscription;
  if (!open || !sub) return null;

  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState(sub.endDate);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<FreezeInfo[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStartDate(todayKey());
    setEndDate(sub.endDate);
    setReason("");
    setNotes("");
    setError(null);
    setHistory([]);
    void (async () => {
      setLoadingHistory(true);
      try {
        const data = await api.subscriptions.freezes(sub.id);
        setHistory(data);
      } catch {
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, [open, sub.id, sub.endDate]);

  const durationDays = useMemo(() => {
    if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) return 0;
    if (endDate < startDate) return 0;
    return diffDaysKeys(startDate, endDate) + 1;
  }, [startDate, endDate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!hasPermission("subscriptions.freeze")) {
      setError(t("errors.forbidden"));
      return;
    }
    if (!isValidDateKey(startDate)) {
      setError(t("errors.freezeStartDateInvalid"));
      return;
    }
    if (!isValidDateKey(endDate)) {
      setError(t("errors.freezeEndDateInvalid"));
      return;
    }
    if (endDate < startDate) {
      setError(t("errors.freezeEndDateInvalid"));
      return;
    }
    if (startDate < sub.startDate || endDate > sub.endDate) {
      setError(t("errors.freezeWindowInvalid"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.subscriptions.freeze(sub.id, {
        startDate,
        endDate,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
      });
      toast("success", t("subs.freezeSavedToast"));
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
      title={t("subs.freezeTitle")}
      footer={
        <>
          <Button
            type="submit"
            form="freeze-form"
            loading={submitting}
            disabled={submitting || durationDays <= 0}
          >
            {t("subs.freezeConfirm")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="freeze-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t("subs.freezeStartDateLabel")}
            type="date"
            dir="ltr"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            min={sub.startDate}
            max={sub.endDate}
            disabled={submitting}
            required
          />
          <Input
            label={t("subs.freezeEndDateLabel")}
            type="date"
            dir="ltr"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={startDate}
            max={sub.endDate}
            disabled={submitting}
            required
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] px-3.5 py-2.5 text-[12px]">
          <span className="text-faint">{t("subs.freezeDurationLabel")}</span>
          <span dir="ltr" className="tabnum font-bold text-ink">
            {durationDays > 0 ? `${durationDays} ${t("common.days")}` : "—"}
          </span>
        </div>
        <div className="space-y-1.5">
          <p className="text-[13px] font-semibold text-subtle">{t("subs.freezeReasonLabel")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FREEZE_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                disabled={submitting}
                onClick={() => setReason(r.value)}
                className={
                  reason === r.value
                    ? "rounded-xl border border-neon bg-neon/10 px-2.5 py-2 text-[12px] font-bold text-neon shadow-glow-sm"
                    : "rounded-xl border border-line px-2.5 py-2 text-[12px] font-bold text-subtle hover:border-line-strong hover:text-ink"
                }
              >
                {t(r.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-semibold text-subtle">
            {t("subs.freezeNotesLabel")}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder={t("subs.freezeNotesPlaceholder")}
            className="flex w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm transition-colors focus:border-neon focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber">
          {t("subs.freezeExtendNotice")}
        </div>
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold leading-relaxed text-red">
            {error}
          </p>
        )}
        {history.length > 0 && (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-[12px] font-bold text-subtle">{t("subs.freezeHistory")}</p>
            <div className="max-h-32 space-y-1.5 overflow-y-auto">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5 text-[11px]"
                >
                  <span dir="ltr" className="tabnum text-subtle">
                    {h.startDate} → {h.endDate}
                  </span>
                  <span className="font-bold text-ink">
                    {h.durationDays} {t("common.days")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {loadingHistory && (
          <p className="text-[11px] text-faint">{t("common.loading")}</p>
        )}
      </form>
    </Modal>
  );
}
