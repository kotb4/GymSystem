import { useEffect, useState } from "react";
import { Send, Phone, AlertCircle } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type RenewalCandidate } from "@/api";
import { formatDateShort } from "@/services/format";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface RenewalAlertsModalProps {
  open: boolean;
  onClose: () => void;
}

export function RenewalAlertsModal({ open, onClose }: RenewalAlertsModalProps) {
  const t = useT();
  const { toast } = useToast();

  const [candidates, setCandidates] = useState<RenewalCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [daysAhead, setDaysAhead] = useState(7);

  const loadCandidates = async () => {
    setLoading(true);
    try {
      const res = await api.renewalAlerts.listExpiring(daysAhead);
      setCandidates(res);
      // Auto-select pending candidates with valid phone
      const initial = new Set<string>();
      res.forEach((c) => {
        if (c.reminderStatus === "pending") {
          initial.add(c.subscriptionId);
        }
      });
      setSelectedIds(initial);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadCandidates();
    }
  }, [open, daysAhead]);

  const toggleSelect = (subId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(subId)) next.delete(subId);
      else next.add(subId);
      return next;
    });
  };

  const selectAll = () => {
    const next = new Set<string>();
    candidates.forEach((c) => {
      if (c.phone) next.add(c.subscriptionId);
    });
    setSelectedIds(next);
  };

  const clearAll = () => {
    setSelectedIds(new Set());
  };

  const onSendBatch = async () => {
    if (selectedIds.size === 0) {
      toast("error", "يرجى تحديد مشترك واحد على الأقل لإرسال التذكير إليه");
      return;
    }

    setSending(true);
    try {
      const res = await api.renewalAlerts.sendBatch(Array.from(selectedIds));
      toast(
        "success",
        `تم إرسال ${res.sentCount} رسالة واتساب بنجاح (فشل: ${res.failedCount}، تم التخطي: ${res.skippedCount})`,
      );
      void loadCandidates();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تنبيهات ورسائل تجديد الاشتراكات (WhatsApp Renewal Reminders)"
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-subtle">
              إرسال تذكيرات تجديد ذكية عبر الواتساب للأعضاء الذين تقترب اشتراكاتهم من الانتهاء، مع منع تكرار الإرسال في نفس اليوم.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-subtle">الاشتراكات التي تنتهي خلال:</span>
            <select
              value={daysAhead}
              onChange={(e) => setDaysAhead(Number(e.target.value))}
              className="rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-bold"
            >
              <option value={3}>3 أيام</option>
              <option value={7}>7 أيام (أسبوع)</option>
              <option value={14}>14 يوماً</option>
              <option value={30}>30 يوماً (شهر)</option>
            </select>
          </div>
        </div>

        {/* Selection actions & counter */}
        <div className="flex items-center justify-between rounded-xl border border-line bg-panel/70 p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-foreground">
              المحدد للإرسال: <span className="text-neon tabnum">{selectedIds.size}</span> من {candidates.length}
            </span>
            <button
              type="button"
              onClick={selectAll}
              className="text-subtle hover:text-foreground underline me-2"
            >
              تحديد الكل
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-subtle hover:text-foreground underline"
            >
              إلغاء التحديد
            </button>
          </div>

          <Button
            size="sm"
            onClick={() => void onSendBatch()}
            loading={sending}
            disabled={sending || selectedIds.size === 0}
          >
            <Send className="size-3.5" />
            <span>إرسال عبر الواتساب ({selectedIds.size})</span>
          </Button>
        </div>

        {/* List of expiring subscriptions */}
        <div className="rounded-xl border border-line overflow-hidden bg-panel">
          {candidates.length > 0 ? (
            <div className="divide-y divide-line/60">
              {candidates.map((c) => {
                const isSelected = selectedIds.has(c.subscriptionId);
                return (
                  <div
                    key={c.subscriptionId}
                    className={`p-3.5 flex items-center justify-between text-sm transition-colors ${
                      isSelected ? "bg-white/[0.02]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(c.subscriptionId)}
                        disabled={!c.phone}
                        className="rounded border-line text-neon focus:ring-neon"
                      />
                      <div>
                        <div className="font-bold text-foreground flex items-center gap-2">
                          <span>{c.memberName}</span>
                          <span className="text-xs text-faint tabnum" dir="ltr">
                            ({c.memberCode})
                          </span>
                          <Badge variant="neutral">{c.planName}</Badge>
                        </div>
                        <div className="text-xs text-subtle flex items-center gap-2 mt-0.5">
                          {c.phone ? (
                            <span dir="ltr" className="flex items-center gap-1">
                              <Phone className="size-3 text-emerald" />
                              {c.phone}
                            </span>
                          ) : (
                            <span className="text-red flex items-center gap-1">
                              <AlertCircle className="size-3" />
                              بدون رقم هاتف
                            </span>
                          )}
                          <span>• ينتهي: {c.endDate}</span>
                          <span className="font-semibold text-amber">
                            (متبقي {c.daysRemaining} يوم)
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-end">
                      {c.reminderStatus === "already_sent" ? (
                        <Badge variant="success">تم الإرسال اليوم</Badge>
                      ) : c.reminderStatus === "no_phone" ? (
                        <Badge variant="danger">لا يمكن الإرسال</Badge>
                      ) : (
                        <Badge variant="warning">جاهز للإرسال</Badge>
                      )}
                      {c.lastReminderSentAt && (
                        <div className="text-[10px] text-faint mt-1" dir="ltr">
                          آخر إرسال: {formatDateShort(new Date(c.lastReminderSentAt))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-subtle">
              {loading ? "جارٍ جلب الاشتراكات..." : "لا توجد اشتراكات تنتهي في هذه الفترة"}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
