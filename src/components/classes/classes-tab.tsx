import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Clock,
  Trash2,
  Users,
  CheckCircle2,
  Dumbbell,
  Flame,
  Shield,
  Swords,
  Activity,
  MapPin,
  Plus,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type ClassRecurrence,
  type GymClass,
  type CombatDiscipline,
  type TargetCategory,
  type Plan,
} from "@/api";
import { todayKey } from "@/core/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/utils/cn";
import { formatTime } from "@/services/format";
import { RecurrenceFormModal } from "./recurrence-form-modal";
import { GroupRosterModal } from "./group-roster-modal";
import { PlanFormModal } from "@/components/subscriptions/plan-form-modal";

function recurrenceDaysLabel(t: (k: string) => string, days: number[]): string {
  return days
    .map((d) => t(`dow.day${d}`))
    .join("، ");
}

const DISCIPLINE_KEYS: CombatDiscipline[] = [
  "general", "combat_fitness", "boxing", "kickboxing", "mma", "karate", "taekwondo",
  "wrestling", "judo", "bjj", "kung_fu", "self_defense", "muay_thai"
];

const CATEGORY_KEYS: TargetCategory[] = ["all", "kids", "teens", "adults", "ladies"];

function getDisciplineMeta(discipline: string) {
  switch (discipline) {
    case "boxing":
    case "kickboxing":
    case "muay_thai":
      return {
        icon: Flame,
        badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/25",
        borderHoverClass: "group-hover:border-amber-500/30",
      };
    case "mma":
    case "wrestling":
      return {
        icon: Swords,
        badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/25",
        borderHoverClass: "group-hover:border-rose-500/30",
      };
    case "karate":
    case "taekwondo":
    case "judo":
    case "bjj":
    case "kung_fu":
    case "self_defense":
      return {
        icon: Shield,
        badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/25",
        borderHoverClass: "group-hover:border-purple-500/30",
      };
    case "combat_fitness":
    case "general":
    default:
      return {
        icon: Activity,
        badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
        borderHoverClass: "group-hover:border-emerald-500/30",
      };
  }
}

export function ClassesTab() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("classes.manage");
  const canPurge = hasPermission("classes.purge");

  const [classesList, setClassesList] = useState<GymClass[]>([]);
  const [recurrences, setRecurrences] = useState<ClassRecurrence[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<"all" | "today" | "consumes" | "active">("all");
  const [filterDiscipline, setFilterDiscipline] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [planModal, setPlanModal] = useState<{ open: boolean; plan: Plan | null }>({ open: false, plan: null });
  const [rosterModalFor, setRosterModalFor] = useState<GymClass | null>(null);
  const [sessionModalFor, setSessionModalFor] = useState<GymClass | null>(null);
  const [recurrenceModalFor, setRecurrenceModalFor] = useState<GymClass | null>(null);
  const [extendTarget, setExtendTarget] = useState<ClassRecurrence | null>(null);
  const [stopTarget, setStopTarget] = useState<ClassRecurrence | null>(null);
  const [deleteClassTarget, setDeleteClassTarget] = useState<GymClass | null>(null);
  const [deleteRecurrenceTarget, setDeleteRecurrenceTarget] = useState<ClassRecurrence | null>(null);
  const [busy, setBusy] = useState(false);

  const todayDow = new Date().getDay();

  useEffect(() => {
    const openNew = searchParams.get("newClass");
    if (openNew === "1") {
      setPlanModal({ open: true, plan: null });
    }
  }, [searchParams]);

  const handleEditClass = async (c: GymClass) => {
    if (c.planId) {
      try {
        const plan = await api.plans.get(c.planId);
        if (plan) {
          setPlanModal({ open: true, plan });
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
    setPlanModal({
      open: true,
      plan: {
        id: "",
        classId: c.id,
        name: c.name,
        category: "academy",
        durationDays: 30,
        price: c.planPrice ?? 0,
        kind: "sessions",
        sessionsCount: 8,
        isActive: c.isActive,
        trainerId: c.trainerId ?? undefined,
        capacity: c.capacity,
        scheduleSlots: c.scheduleSlots,
        invitationsCount: 0,
      } as Plan,
    });
  };

  const reload = useCallback(() => {
    if (!actor || !hasPermission("classes.view")) return;
    api.classes.list({
      discipline: filterDiscipline || undefined,
      category: filterCategory || undefined,
    }).then(setClassesList).catch(console.error);
    api.classes.listRecurrences({}).then(setRecurrences).catch(console.error);
  }, [actor, hasPermission, filterDiscipline, filterCategory]);

  useEffect(() => { reload(); }, [reload]);

  const filteredClasses = useMemo(() => {
    let result = classesList;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.trainerName && c.trainerName.toLowerCase().includes(q)) ||
          (c.location && c.location.toLowerCase().includes(q)) ||
          (c.scheduleText && c.scheduleText.toLowerCase().includes(q)),
      );
    }
    if (quickFilter === "today") {
      result = result.filter((c) => c.scheduleSlots?.some((s) => s.dayOfWeek === todayDow));
    } else if (quickFilter === "consumes") {
      result = result.filter((c) => c.consumesSession);
    } else if (quickFilter === "active") {
      result = result.filter((c) => c.isActive);
    }
    return result;
  }, [classesList, searchQuery, quickFilter, todayDow]);

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-panel/80 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1 max-w-md">
            <SearchInput
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder="بحث باسم الحصة، المدرب، أو القاعة..."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-44 text-xs"
              value={filterDiscipline}
              onChange={(e) => setFilterDiscipline(e.target.value)}
              options={[
                { value: "", label: t("cls.allDisciplines") },
                ...DISCIPLINE_KEYS.map((k) => ({
                  value: k,
                  label: t(`cls.disciplines.${k}`),
                })),
              ]}
            />
            <Select
              className="w-40 text-xs"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              options={[
                { value: "", label: t("cls.allCategories") },
                ...CATEGORY_KEYS.map((k) => ({
                  value: k,
                  label: t(`cls.categories.${k}`),
                })),
              ]}
            />
            {canManage && (
              <Button
                variant="primary"
                onClick={() => setPlanModal({ open: true, plan: null })}
                className="gap-1.5 text-xs font-bold"
              >
                <Plus className="size-4" />
                <span>إضافة باقة أكاديمية</span>
              </Button>
            )}
          </div>
        </div>

        {/* Quick Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/5">
          <button
            type="button"
            onClick={() => setQuickFilter("all")}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
              quickFilter === "all"
                ? "bg-neon/15 text-neon border border-neon/30"
                : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
            )}
          >
            الكل ({classesList.length})
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("today")}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
              quickFilter === "today"
                ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
            )}
          >
            <Flame className="size-3" />
            حصص اليوم ({classesList.filter((c) => c.scheduleSlots?.some((s) => s.dayOfWeek === todayDow)).length})
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("consumes")}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
              quickFilter === "consumes"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
            )}
          >
            تستهلك رصيد ({classesList.filter((c) => c.consumesSession).length})
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("active")}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold transition-all",
              quickFilter === "active"
                ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                : "bg-surface/60 text-faint hover:text-subtle border border-white/5",
            )}
          >
            أكاديميات نشطة ({classesList.filter((c) => c.isActive).length})
          </button>
        </div>
      </div>

      {/* Grid of Classes */}
      <div className="grid gap-4 p-1 sm:grid-cols-2 xl:grid-cols-3">
        {filteredClasses.map((c) => {
          const recs = recurrences.filter((r) => r.classId === c.id);
          const meta = getDisciplineMeta(c.discipline ?? "general");
          const DisciplineIcon = meta.icon;
          const isScheduledToday = c.scheduleSlots?.some((s) => s.dayOfWeek === todayDow);

          const disciplineLabel = DISCIPLINE_KEYS.includes(c.discipline as CombatDiscipline)
            ? t(`cls.disciplines.${c.discipline || "general"}`)
            : (c.discipline || t("cls.disciplines.general"));

          const categoryLabel = CATEGORY_KEYS.includes(c.category as TargetCategory)
            ? t(`cls.categories.${c.category}`)
            : c.category;

          return (
            <div
              key={c.id}
              className={cn(
                "group relative flex flex-col justify-between rounded-2xl border border-line bg-panel p-5 transition-all duration-200 hover:border-white/20 hover:shadow-lg hover:shadow-black/30",
                meta.borderHoverClass,
              )}
            >
              {/* Card Header */}
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("grid size-11 place-items-center rounded-xl border shrink-0", meta.badgeClass)}>
                      <DisciplineIcon className="size-5" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-base text-white tracking-wide">{c.name}</h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold border", meta.badgeClass)}>
                          {disciplineLabel}
                        </span>
                        {c.category && c.category !== "all" && (
                          <Badge variant="primary" className="text-[10px] font-semibold">
                            {categoryLabel}
                          </Badge>
                        )}
                        {c.level && c.level !== "all_levels" && (
                          <Badge variant="neutral" className="text-[10px]">
                            {t(`cls.levels.${c.level}`)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status & Today Badge */}
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {isScheduledToday && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-400 border border-amber-500/30 animate-pulse">
                        <Flame className="size-3 text-amber-400" />
                        موعد اليوم
                      </span>
                    )}
                    <span className="text-[11px] font-medium text-faint">
                      {c.isActive ? (
                        <span className="text-emerald-400">● نشطة</span>
                      ) : (
                        <span className="text-slate-500">○ متوقفة</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* Coach & Location Bar */}
                <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-white/5 bg-surface/50 px-3 py-2 text-xs">
                  <div className="flex items-center gap-1.5 text-subtle">
                    <Dumbbell className="size-3.5 text-neon shrink-0" />
                    <span className="font-semibold text-slate-200">
                      {c.trainerName ? `المدرب: ${c.trainerName}` : "— بدون مدرب محدد —"}
                    </span>
                  </div>
                  {c.location && (
                    <div className="flex items-center gap-1.5 text-faint ms-auto">
                      <MapPin className="size-3.5 text-slate-400 shrink-0" />
                      <span>{c.location}</span>
                    </div>
                  )}
                </div>

                {/* Schedule Box */}
                <div className="mt-3 space-y-1.5">
                  {c.scheduleText ? (
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs">
                      <Clock className="size-3.5 shrink-0 text-amber-400" />
                      <span className="font-medium text-slate-200">{c.scheduleText}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-2 text-xs text-faint">
                      <Clock className="size-3.5 shrink-0" />
                      <span>لا يوجد جدول أسبوعي محدد</span>
                    </div>
                  )}

                  {/* Recurrences indicator if any */}
                  {recs.length > 0 && (
                    <div className="rounded-xl border border-line bg-black/20 p-2.5 space-y-1.5">
                      {recs.map((r) => (
                        <div key={r.id} className="flex items-center justify-between text-[11px]">
                          <span className="flex items-center gap-1.5 text-subtle">
                            <CalendarRange className="size-3 text-neon shrink-0" />
                            <span>تكرار: {recurrenceDaysLabel(t, r.daysOfWeek)} ({formatTime(r.startTime)})</span>
                          </span>
                          <div className="flex items-center gap-1">
                            {r.nextScheduledDate && (
                              <span className="text-faint tabnum">{r.nextScheduledDate}</span>
                            )}
                            {canPurge && (
                              <button
                                type="button"
                                onClick={() => setDeleteRecurrenceTarget(r)}
                                className="grid size-5 place-items-center rounded text-faint hover:text-red hover:bg-red/10"
                                title="حذف التكرار"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Financial & Linked Package Row */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-white/5 bg-surface/40 p-2.5">
                    <span className="block text-[10px] text-faint mb-0.5">الباقة المرتبطة</span>
                    {c.planName ? (
                      <span className="font-bold text-cyan-400 block truncate" title={c.planName}>
                        {c.planName} {c.planPrice ? `(${c.planPrice} ج.م)` : ""}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-medium">غير مقترنة بباقة</span>
                    )}
                  </div>

                  <div className="rounded-xl border border-white/5 bg-surface/40 p-2.5">
                    <span className="block text-[10px] text-faint mb-0.5">أتعاب المدرب المقررة</span>
                    {c.defaultTrainerFeeMinor ? (
                      <span className="font-bold text-emerald-400 tabnum block">
                        {c.defaultTrainerFeeMinor / 100} ج.م / للحصة
                      </span>
                    ) : (
                      <span className="text-slate-400 font-medium">غير محددة</span>
                    )}
                  </div>
                </div>

                {/* Capacity and Session Consumption */}
                <div className="mt-3 flex items-center justify-between text-xs text-subtle px-1">
                  <span className="flex items-center gap-1.5">
                    {c.consumesSession ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-neon font-semibold">
                        <CheckCircle2 className="size-3.5" />
                        تخصم حصة من رصيد العضو
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                        اشتراك مفتوح (لا يخصم)
                      </span>
                    )}
                  </span>
                  <span className="tabnum font-bold text-slate-300">
                    السعة: {c.capacity} متدرب
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 pt-3 border-t border-white/5 space-y-2">
                {/* Prominent Checkin / Roster Button */}
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setRosterModalFor(c)}
                  className="w-full justify-center gap-2 font-bold py-2.5 text-xs shadow-md shadow-neon/10"
                >
                  <Users className="size-4" />
                  <span>كشف الحضور والمشتركين (تحضير فوري)</span>
                </Button>

                {/* Secondary Actions Bar */}
                <div className="flex items-center gap-1.5">
                  {canManage && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setSessionModalFor(c)}
                        className="flex-1 text-[11px] py-1.5"
                        title="إضافة موعد أو جلسة تدريب اليوم"
                      >
                        <CalendarPlus className="size-3.5" />
                        حصة اليوم
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRecurrenceModalFor(c)}
                        className="flex-1 text-[11px] py-1.5"
                        title="جدولة تكرار أسبوعي آلي"
                      >
                        <CalendarRange className="size-3.5" />
                        تكرار أسبوعي
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleEditClass(c)}
                        className="text-[11px] py-1.5 px-2.5"
                        title="تعديل بيانات الحصة وباقة الأكاديمية"
                      >
                        {t("common.edit")}
                      </Button>
                    </>
                  )}

                  {canPurge && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red hover:bg-red/10 hover:text-red p-2"
                      aria-label={t("cls.deleteClass")}
                      onClick={() => setDeleteClassTarget(c)}
                      title="حذف الحصة"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {filteredClasses.length === 0 && (
        <EmptyState
          icon={<CalendarDays />}
          title={classesList.length === 0 ? t("cls.emptySessions") : "لا توجد حصص تطابق معايير البحث والتصفية"}
          description={classesList.length === 0 ? "قم بإضافة أكاديمية أو حصة تدريبية جديدة للبدء." : "جرّب تغيير كلمات البحث أو إعادة ضبط الفلاتر."}
        />
      )}

      {rosterModalFor && (
        <GroupRosterModal
          open
          gymClass={rosterModalFor}
          onClose={() => setRosterModalFor(null)}
          onAttendanceChanged={reload}
        />
      )}

      {planModal.open && (
        <PlanFormModal
          open
          plan={planModal.plan}
          defaultCategory="academy"
          onClose={() => setPlanModal({ open: false, plan: null })}
          onSaved={() => { setPlanModal({ open: false, plan: null }); reload(); }}
        />
      )}
      {sessionModalFor && (
        <SessionFormModal
          cls={sessionModalFor}
          onClose={() => setSessionModalFor(null)}
          onSaved={() => { setSessionModalFor(null); reload(); }}
        />
      )}
      {recurrenceModalFor && (
        <RecurrenceFormModal
          cls={recurrenceModalFor}
          onClose={() => setRecurrenceModalFor(null)}
          onSaved={() => { setRecurrenceModalFor(null); reload(); }}
        />
      )}

      <ConfirmDialog
        open={extendTarget !== null}
        onClose={() => setExtendTarget(null)}
        onConfirm={() => {
          if (!extendTarget) return;
          setBusy(true);
          api.classes.generateRecurrenceWeeks(extendTarget.id, 2)
            .then((res) => {
              toast("success", t("cls.recurrenceExtendedToast", { created: res.created }));
              setExtendTarget(null);
              reload();
            })
            .catch((err) => toast("error", describeError(err, t)))
            .finally(() => setBusy(false));
        }}
        title={t("cls.extendRecurring")}
        message={t("cls.extendRecurringConfirm")}
        confirmLabel={t("common.confirm")}
        loading={busy}
      />
      <ConfirmDialog
        open={stopTarget !== null}
        onClose={() => setStopTarget(null)}
        onConfirm={() => {
          if (!stopTarget) return;
          setBusy(true);
          api.classes.stopRecurrence(stopTarget.id)
            .then(() => {
              toast("success", t("cls.recurrenceStoppedToast"));
              setStopTarget(null);
              reload();
            })
            .catch((err) => toast("error", describeError(err, t)))
            .finally(() => setBusy(false));
        }}
        title={t("cls.stopRecurring")}
        message={t("cls.stopRecurringConfirm")}
        confirmLabel={t("cls.stopRecurring")}
        loading={busy}
        tone="danger"
      />
      <ConfirmDialog
        open={deleteClassTarget !== null}
        onClose={() => setDeleteClassTarget(null)}
        onConfirm={() => {
          if (!deleteClassTarget) return;
          setBusy(true);
          api.classes.delete(deleteClassTarget.id)
            .then(() => {
              toast("success", t("cls.classDeletedToast"));
              setDeleteClassTarget(null);
              reload();
            })
            .catch((err) => toast("error", describeError(err, t)))
            .finally(() => setBusy(false));
        }}
        title={t("cls.deleteClass")}
        message={t("cls.deleteClassConfirm")}
        confirmLabel={t("common.delete")}
        loading={busy}
        tone="danger"
      />
      <ConfirmDialog
        open={deleteRecurrenceTarget !== null}
        onClose={() => setDeleteRecurrenceTarget(null)}
        onConfirm={() => {
          if (!deleteRecurrenceTarget) return;
          setBusy(true);
          api.classes.deleteRecurrence(deleteRecurrenceTarget.id)
            .then(() => {
              toast("success", t("cls.recurrenceDeletedToast"));
              setDeleteRecurrenceTarget(null);
              reload();
            })
            .catch((err) => toast("error", describeError(err, t)))
            .finally(() => setBusy(false));
        }}
        title={t("cls.deleteRecurrence")}
        message={t("cls.deleteRecurrenceConfirm")}
        confirmLabel={t("common.delete")}
        loading={busy}
        tone="danger"
      />
    </div>
  );
}

function SessionFormModal({ cls, onClose, onSaved }: { cls: GymClass; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [sessionDate, setSessionDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("18:00");
  const [durationMin, setDurationMin] = useState("60");
  const [capacity, setCapacity] = useState(String(cls.capacity));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.classes.createSession(cls.id, {
        sessionDate, startTime, durationMin: Number(durationMin), capacity: Number(capacity),
      });
      toast("success", t("cls.saved"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t("cls.addSession")} — ${cls.name}`} widthClass="max-w-sm"
      footer={<><Button type="submit" form="session-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="session-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3.5">
        <Input label={t("cls.sessionDate")} type="date" dir="ltr" value={sessionDate} onChange={(e: ChangeEvent<HTMLInputElement>) => setSessionDate(e.target.value)} autoFocus />
        <Input label={t("cls.startTime")} type="time" dir="ltr" value={startTime} onChange={(e: ChangeEvent<HTMLInputElement>) => setStartTime(e.target.value)} />
        <Input label={t("cls.duration")} type="number" min={5} dir="ltr" value={durationMin} onChange={(e: ChangeEvent<HTMLInputElement>) => setDurationMin(e.target.value)} />
        <Input label={t("cls.capacity")} type="number" min={1} dir="ltr" value={capacity} onChange={(e: ChangeEvent<HTMLInputElement>) => setCapacity(e.target.value)} />
      </form>
    </Modal>
  );
}