import { useState, useEffect, useMemo } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  MessageCircle,
  Search,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type EnrolledClassMember, type GymClass } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";
import { SubscriptionFormModal } from "@/components/subscriptions/subscription-form-modal";

interface Props {
  open: boolean;
  onClose: () => void;
  gymClass: GymClass | null;
  onAttendanceChanged?: () => void;
}

export function GroupRosterModal({ open, onClose, gymClass, onAttendanceChanged }: Props) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canCheckIn = hasPermission("classes.checkin");
  const canSubscribe = hasPermission("subscriptions.create");

  const [members, setMembers] = useState<EnrolledClassMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [batchChecking, setBatchChecking] = useState(false);
  const [subModalOpen, setSubModalOpen] = useState(false);

  const loadData = () => {
    if (!gymClass) return;
    setLoading(true);
    api.classes
      .listEnrolledMembers(gymClass.id)
      .then(setMembers)
      .catch((err) => toast("error", describeError(err, t)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open && gymClass) {
      loadData();
      setSearch("");
    }
  }, [open, gymClass]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.memberName.toLowerCase().includes(q) ||
        m.memberCode.toLowerCase().includes(q) ||
        (m.phone && m.phone.includes(q)),
    );
  }, [members, search]);

  if (!open || !gymClass) return null;

  const handleSingleCheckin = async (member: EnrolledClassMember) => {
    setCheckingId(member.memberId);
    try {
      const res = await api.classes.recordDirectAttendance({
        classId: gymClass.id,
        memberId: member.memberId,
        subscriptionId: member.subscriptionId,
      });

      toast(
        "success",
        `تم تسجيل حضور ${member.memberName} بنجاح ${
          res.sessionsRemaining !== null ? `(متبقي: ${res.sessionsRemaining} حصة)` : ""
        }`,
      );

      if (res.warning) {
        toast("info", res.warning);
      }

      loadData();
      onAttendanceChanged?.();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setCheckingId(null);
    }
  };

  const handleBatchCheckin = async () => {
    const eligible = filtered.filter((m) => m.status !== "exhausted" && m.status !== "expired");
    if (eligible.length === 0) {
      toast("error", "لا يوجد مشتركون مؤهلون للتحضير في هذه المجموعة حالياً");
      return;
    }

    if (
      !window.confirm(
        `هل تريد تسجيل حضور جميع المشتركين المؤهلين (${eligible.length} مشترك) لحصة ${gymClass.name} اليوم وخصم حصة واحدة من كل مشترك؟`,
      )
    ) {
      return;
    }

    setBatchChecking(true);
    try {
      const res = await api.classes.recordBatchAttendance({
        classId: gymClass.id,
        memberIds: eligible.map((m) => m.memberId),
      });

      toast("success", `تم تسجيل حضور ${res.attendedCount} مشترك بنجاح وخصم الحصص من رصيدهم`);
      if (res.errors.length > 0) {
        toast("error", `تعذر تحضير ${res.errors.length} مشترك`);
      }

      loadData();
      onAttendanceChanged?.();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBatchChecking(false);
    }
  };

  const totalCount = members.length;
  const activeCount = members.filter((m) => m.status === "active").length;
  const warningCount = members.filter((m) => m.status === "warning").length;
  const exhaustedCount = members.filter((m) => m.status === "exhausted" || m.status === "expired").length;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={gymClass ? `كشف حضور مشتركي المجموعة: ${gymClass.name}` : "كشف حضور المشتركين"}
        widthClass="max-w-4xl"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div className="text-xs text-subtle">
              إجمالي المقيدين: <strong className="text-foreground">{totalCount}</strong>
            </div>
            <div className="flex items-center gap-2">
              {canCheckIn && (
                <Button
                  variant="primary"
                  onClick={handleBatchCheckin}
                  loading={batchChecking}
                  disabled={batchChecking || members.length === 0}
                  className="font-bold gap-1.5"
                >
                  <CheckCircle2 className="size-4" />
                  <span>تحضير جميع الحاضرين اليوم</span>
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Header Info Banner */}
          <div className="rounded-2xl border border-line bg-panel p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-lg text-foreground">{gymClass.name}</h3>
                  <Badge variant="primary" className="text-xs">
                    {gymClass.trainerName ? `كابتن: ${gymClass.trainerName}` : "بدون مدرب"}
                  </Badge>
                  {gymClass.planName && (
                    <Badge variant="neutral" className="text-xs text-cyan-400 border-cyan-500/20">
                      {gymClass.planName}
                    </Badge>
                  )}
                </div>
                {/* Detailed Schedule Display */}
                {gymClass.scheduleText ? (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                    <Clock className="size-3.5 shrink-0" />
                    <span>مواعيد الحصص: {gymClass.scheduleText}</span>
                  </p>
                ) : (
                  <p className="text-xs text-subtle flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" />
                    <span>سعة القاعة: {gymClass.capacity} مشترك</span>
                  </p>
                )}
              </div>

              {canSubscribe && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSubModalOpen(true)}
                  className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                >
                  <UserPlus className="size-3.5" />
                  <span>تسجيل مشترك جديد في المجموعة</span>
                </Button>
              )}
            </div>

            {/* Stats Chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-line/60">
              <div className="rounded-xl border border-line/50 bg-surface/50 p-2 text-center">
                <span className="text-[11px] text-subtle block">إجمالي المشتركين</span>
                <span className="font-mono text-sm font-extrabold text-foreground">{totalCount}</span>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2 text-center">
                <span className="text-[11px] text-emerald-400 block">رصيد حصص كافٍ</span>
                <span className="font-mono text-sm font-extrabold text-emerald-400">{activeCount}</span>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2 text-center">
                <span className="text-[11px] text-amber-400 block">متبقي حصة واحدة</span>
                <span className="font-mono text-sm font-extrabold text-amber-400">{warningCount}</span>
              </div>
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-2 text-center">
                <span className="text-[11px] text-red-400 block">حصص منتهية (تجديد)</span>
                <span className="font-mono text-sm font-extrabold text-red-400">{exhaustedCount}</span>
              </div>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو كود العضوية أو رقم الهاتف..."
              className="w-full rounded-xl border border-line bg-surface py-2.5 ps-10 pe-4 text-xs text-foreground placeholder:text-faint focus:border-neon focus:outline-none"
            />
          </div>

          {/* Members Table */}
          {loading ? (
            <p className="py-12 text-center text-xs text-subtle">جاري تحميل كشف المجموعة...</p>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Users className="size-6 text-faint" />}
              title="لا يوجد مشتركون في هذه المجموعة"
              description="لم يشترك أي عضو في باقة هذه المجموعة بعد، أو لا توجد نتائج مطابقة للبحث."
            />
          ) : (
            <div className="divide-y divide-line rounded-2xl border border-line bg-surface overflow-hidden max-h-[50vh] overflow-y-auto">
              {filtered.map((m) => {
                const isExhausted = m.status === "exhausted" || m.status === "expired";
                const isWarning = m.status === "warning";

                return (
                  <div
                    key={m.subscriptionId}
                    className={`flex flex-wrap items-center justify-between gap-3 p-3.5 transition-colors ${
                      isExhausted ? "bg-red-500/[0.03]" : isWarning ? "bg-amber-500/[0.03]" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    {/* Member Info */}
                    <div className="flex items-center gap-3 min-w-[200px]">
                      {m.photoFileId ? (
                        <img
                          src={api.files.url(m.photoFileId)}
                          alt={m.memberName}
                          className="size-10 rounded-xl object-cover shrink-0 border border-line"
                        />
                      ) : (
                        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-subtle font-bold text-xs">
                          {m.memberName.slice(0, 2)}
                        </div>
                      )}
                      <div>
                        <p className="font-bold text-sm text-foreground">{m.memberName}</p>
                        <p className="text-xs text-subtle flex items-center gap-1.5">
                          <span dir="ltr" className="font-mono text-cyan-400 font-semibold">
                            {m.memberCode}
                          </span>
                          {m.phone && (
                            <>
                              <span>·</span>
                              <span dir="ltr">{m.phone}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Sessions Count & Status */}
                    <div className="flex items-center gap-2">
                      {m.sessionsTotal !== null ? (
                        <div className="text-center sm:text-end">
                          <span className="text-[11px] text-subtle block">رصيد الحصص</span>
                          <span
                            dir="ltr"
                            className={`font-mono text-sm font-extrabold ${
                              isExhausted
                                ? "text-red-400"
                                : isWarning
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }`}
                          >
                            {m.sessionsRemaining ?? 0} / {m.sessionsTotal}
                          </span>
                        </div>
                      ) : (
                        <Badge variant="primary" className="text-xs">
                          مفتوح
                        </Badge>
                      )}

                      {isExhausted ? (
                        <span className="rounded-lg bg-red-500/10 px-2 py-1 text-[11px] font-bold text-red-400 border border-red-500/20">
                          {m.status === "expired" ? "منتهي الصلاحية" : "الحصص خلصت (جدد)"}
                        </span>
                      ) : isWarning ? (
                        <span className="rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-400 border border-amber-500/20">
                          فاضل حصة واحدة
                        </span>
                      ) : (
                        <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                          نشط
                        </span>
                      )}
                    </div>

                    {/* Actions: Direct Checkin & WhatsApp */}
                    <div className="flex items-center gap-2">
                      {(m.emergencyContactPhone || m.phone) && (
                        <a
                          href={
                            buildWhatsAppDirectUrl(
                              m.emergencyContactPhone || m.phone || "",
                              `🥋 *إشعار حضور تمرين الأكاديمية - جيم جيت*

مرحباً ولي أمر بطلنا: *${m.memberName}* 👋
نحيطكم علماً بأنه تم تسجيل حضور التمرين اليوم بنجاح:
• الحصة: *${gymClass.name}*
• التاريخ: ${new Date().toISOString().slice(0, 10)}
• رصيد الحصص المتبقي: ${m.sessionsRemaining !== null ? `${m.sessionsRemaining} حصة` : "مفتوح"}

نتمنى لبطلنا حصة تدريبية ممتعة وموفقة دائماً! 🥊💪`,
                            ) || "#"
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          title={
                            m.emergencyContactPhone
                              ? `إرسال إشعار حضور لولي الأمر (${m.emergencyContactName || "هاتف الطوارئ/ولي الأمر"})`
                              : "إرسال إشعار حضور عبر واتساب"
                          }
                        >
                          <MessageCircle className="size-3.5" />
                          <span className="hidden sm:inline">
                            {m.emergencyContactPhone ? "إشعار ولي الأمر" : "واتساب"}
                          </span>
                        </a>
                      )}

                      {canCheckIn && (
                        <Button
                          size="sm"
                          variant={isExhausted ? "danger" : "primary"}
                          onClick={() => handleSingleCheckin(m)}
                          loading={checkingId === m.memberId}
                          disabled={checkingId !== null || batchChecking || isExhausted}
                          className="font-bold text-xs gap-1.5"
                        >
                          <UserCheck className="size-3.5" />
                          <span>{isExhausted ? "مغلق" : "تحضير ✅"}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* Subscription Form for quick enrollment */}
      {subModalOpen && (
        <SubscriptionFormModal
          open={subModalOpen}
          onClose={() => setSubModalOpen(false)}
          defaultCategory="academy"
          onSaved={() => {
            setSubModalOpen(false);
            loadData();
          }}
        />
      )}
    </>
  );
}
