import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dumbbell,
  Flame,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  Trash2,
  Unlink,
  UserCheck,
  UserPlus,
  Banknote,
  History,
  Calendar,
  MessageCircle,
  LayoutGrid,
  List,
  Phone,
  FileText,
  Trophy,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicEmployee, type PublicTrainer, type TrainerScheduleSlot, type SalaryType } from "@/api";
import { formatDateShort, formatTime } from "@/services/format";
import { parseDateKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";
import { SearchInput } from "@/components/ui/search-input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TrainerFormModal } from "./trainer-form-modal";
import { TrainerProfileModal } from "./trainer-profile-modal";
import { TrainerPayoutModal } from "./trainer-payout-modal";
import { TrainerPayoutsHistoryModal } from "./trainer-payouts-history-modal";
import { TrainerStatementModal } from "./trainer-statement-modal";
import { PlanFormModal } from "@/components/subscriptions/plan-form-modal";

interface TrainerRowModel {
  id: string;
  fullName: string;
  phone: string | null;
  specialization: string | null;
  rankTitle: string | null;
  joinedDate: string;
  isActive: boolean;
  activePlans: number;
  defaultSessionFeeMinor: number;
  workingSchedule: TrainerScheduleSlot[] | null;
  employeeId: string | null;
  employeeName: string | null;
  assignedAcademies: string[];
}

function checkTrainerPresence(schedule?: TrainerScheduleSlot[] | null): {
  status: "unknown" | "day_off" | "working_today" | "present" | "not_present";
  isPresent: boolean;
  badgeText: string;
  badgeClass: string;
  description: string;
} {
  if (!schedule || schedule.length === 0) {
    return {
      status: "unknown",
      isPresent: false,
      badgeText: "غير محدد",
      badgeClass: "bg-surface/80 text-subtle border-border/40",
      description: "لم يتم تحديد جدول مواعيد عمل",
    };
  }

  const now = new Date();
  const currentDayOfWeek = now.getDay(); // 0=Sunday, ..., 6=Saturday
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const todaySlot = schedule.find((s) => s.dayOfWeek === currentDayOfWeek);
  if (!todaySlot || !todaySlot.isActive) {
    return {
      status: "day_off",
      isPresent: false,
      badgeText: "🏖️ يوم راحة",
      badgeClass: "bg-subtle/10 text-subtle border-border/40",
      description: "اليوم إجازة أسبوعية للمدرب",
    };
  }

  const { startTime, endTime } = todaySlot;
  if (!startTime || !endTime) {
    return {
      status: "working_today",
      isPresent: true,
      badgeText: "🗓️ يوم عمل",
      badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
      description: "يوم عمل رسمي للمدرب",
    };
  }

  const isPresent = currentTime >= startTime && currentTime <= endTime;
  if (isPresent) {
    return {
      status: "present",
      isPresent: true,
      badgeText: "🟢 متواجد الآن بالصالة",
      badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40 font-bold",
      description: `ميعاد اليوم: من ${formatTime(startTime)} إلى ${formatTime(endTime)}`,
    };
  }

  return {
    status: "not_present",
    isPresent: false,
    badgeText: "⚪ غير متواجد حالياً",
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    description: `ميعاد عمل اليوم: ${formatTime(startTime)} - ${formatTime(endTime)}`,
  };
}

function formatTrainerScheduleBrief(schedule?: TrainerScheduleSlot[] | null): string {
  if (!schedule || schedule.length === 0) return "لم يتم تحديد جدول بعد";
  const activeDays = schedule.filter((s) => s.isActive);
  if (activeDays.length === 0) return "إجازة طوال الأسبوع";
  if (activeDays.length === 7) return "طوال أيام الأسبوع";

  const dayNames = activeDays.map((d) => d.dayNameAr).join("، ");
  const firstSlot = activeDays[0];
  if (firstSlot.startTime && firstSlot.endTime) {
    return `${dayNames} (${formatTime(firstSlot.startTime)} - ${formatTime(firstSlot.endTime)})`;
  }
  return dayNames;
}

function getWhatsAppUrl(phone?: string | null) {
  if (!phone) return null;
  const cleaned = phone.replace(/[^0-9]/g, "");
  const formatted = cleaned.startsWith("0") ? `2${cleaned}` : cleaned;
  return `https://wa.me/${formatted}`;
}

export function TrainersTab({ onTrainerChanged }: { onTrainerChanged?: () => void } = {}) {
  const t = useT();
  const navigate = useNavigate();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("trainers.manage");
  const canPurge = hasPermission("trainers.purge");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "presentNow" | "linkedEmployee">("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [rows, setRows] = useState<TrainerRowModel[]>([]);

  const [profileTargetId, setProfileTargetId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicTrainer | null>(null);
  const [toggleTarget, setToggleTarget] = useState<PublicTrainer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicTrainer | null>(null);
  const [payoutTarget, setPayoutTarget] = useState<PublicTrainer | null>(null);
  const [historyTarget, setHistoryTarget] = useState<PublicTrainer | null>(null);
  const [statementTarget, setStatementTarget] = useState<PublicTrainer | null>(null);
  const [assignAcademyTrainerId, setAssignAcademyTrainerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [linkTarget, setLinkTarget] = useState<TrainerRowModel | null>(null);
  const [createEmpTarget, setCreateEmpTarget] = useState<TrainerRowModel | null>(null);
  const [availableEmployees, setAvailableEmployees] = useState<PublicEmployee[]>([]);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [createEmpForm, setCreateEmpForm] = useState({
    salaryType: "monthly" as SalaryType,
    salaryBaseMajor: "",
    department: "general" as "general" | "men" | "women",
    commissionPct: "",
  });

  const reload = useCallback(() => {
    if (!actor || !hasPermission("trainers.view")) return;
    let alive = true;
    void api.trainers
      .list({ search: search.trim() || undefined })
      .then((trainers) => {
        if (!alive) return;
        setRows(
          trainers.map((tr) => ({
            id: tr.id,
            fullName: tr.fullName,
            phone: tr.phone,
            specialization: tr.specialization,
            rankTitle: tr.rankTitle ?? null,
            joinedDate: tr.joinedDate,
            isActive: tr.isActive,
            activePlans: (tr as unknown as { activePlans?: number }).activePlans ?? 0,
            defaultSessionFeeMinor: tr.defaultSessionFeeMinor ?? 0,
            workingSchedule: tr.workingSchedule ?? null,
            employeeId: tr.employeeId ?? null,
            employeeName: (tr as unknown as { employeeName?: string | null }).employeeName ?? null,
            assignedAcademies: (tr as unknown as { assignedAcademies?: string[] }).assignedAcademies ?? [],
          })),
        );
        onTrainerChanged?.();
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, hasPermission, search, onTrainerChanged]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (linkTarget) {
      setSelectedEmpId(linkTarget.employeeId ?? "");
      void api.employees.list({ includeInactive: false }).then(setAvailableEmployees).catch(console.error);
    }
  }, [linkTarget]);

  const onToggleActive = async () => {
    if (!actor || !toggleTarget) return;
    setBusy(true);
    try {
      await api.trainers.setActive(toggleTarget.id, !toggleTarget.isActive);
      toast("success", t("trainers.statusToast"));
      setToggleTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onSaveLink = async () => {
    if (!linkTarget) return;
    setBusy(true);
    try {
      await api.trainers.linkEmployee(linkTarget.id, selectedEmpId || null);
      toast("success", t("trainers.linkEmployeeSuccess"));
      setLinkTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onUnlinkEmployee = async (trainerId: string) => {
    setBusy(true);
    try {
      await api.trainers.linkEmployee(trainerId, null);
      toast("success", t("trainers.linkEmployeeSuccess"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onCreateEmployee = async () => {
    if (!createEmpTarget) return;
    setBusy(true);
    try {
      await api.trainers.createEmployee(createEmpTarget.id, {
        salaryType: createEmpForm.salaryType,
        salaryBaseMinor: createEmpForm.salaryBaseMajor ? Math.round(Number(createEmpForm.salaryBaseMajor) * 100) : 0,
        department: createEmpForm.department,
        commissionPct: createEmpForm.commissionPct ? Number(createEmpForm.commissionPct) : 0,
      });
      toast("success", t("trainers.createEmployeeSuccess"));
      setCreateEmpTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteTrainer = async () => {
    if (!actor || !deleteTarget) return;
    setBusy(true);
    try {
      await api.trainers.delete(deleteTarget.id);
      toast("success", t("trainers.deletedToast"));
      setDeleteTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<TrainerRowModel>[] = [
    {
      key: "trainer",
      header: t("common.name"),
      render: (row) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={row.fullName} size="sm" />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-bold">{row.fullName}</span>
              {row.rankTitle && (
                <Badge variant="warning" className="text-[10px]">
                  {row.rankTitle}
                </Badge>
              )}
            </span>
            <span dir="ltr" className="block text-[11px] text-faint">
              {row.phone ?? "—"}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "specialization",
      header: t("trainers.specialization"),
      render: (row) => <span className="text-subtle">{row.specialization ?? "—"}</span>,
    },
    {
      key: "employee",
      header: t("trainers.linkedEmployee"),
      render: (row) =>
        row.employeeName ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-neon/10 px-2 py-0.5 text-xs font-semibold text-neon">
            <UserCheck className="size-3" />
            {row.employeeName}
          </span>
        ) : (
          <span className="text-xs text-faint">{t("trainers.noLinkedEmployee")}</span>
        ),
    },
    {
      key: "joined",
      header: t("trainers.joined"),
      render: (row) => (
        <span className="tabnum text-subtle">{formatDateShort(parseDateKey(row.joinedDate))}</span>
      ),
    },
    {
      key: "plans",
      header: t("trainers.activePlans"),
      render: (row) => <span className="font-bold tabnum">{t("rpt.count", { count: row.activePlans })}</span>,
    },
    {
      key: "status",
      header: t("users.activeCol"),
      render: (row) => (
        <Badge variant={row.isActive ? "success" : "neutral"} dot>
          {row.isActive ? t("status.active") : t("status.inactive")}
        </Badge>
      ),
    },
  ];

    columns.push({
      key: "academies",
      header: "الأكاديميات المسندة",
      render: (row) => (
        <div className="flex flex-wrap gap-1 max-w-48">
          {row.assignedAcademies && row.assignedAcademies.length > 0 ? (
            row.assignedAcademies.map((acad) => (
              <Badge key={acad} variant="warning" className="text-[10px] py-0 px-1.5 font-bold">
                {acad}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-faint">غير مسند</span>
          )}
        </div>
      ),
    });

    columns.push({
      key: "quickPayout",
      header: "المرتب والمستحقات",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs gap-1 h-8 px-2.5 shadow-glow-sm"
            title="صرف مرتب للمدرب وخصمه من الخزينة"
            onClick={() => {
              const original = rows.find((tr) => tr.id === row.id);
              if (!original) return;
              setPayoutTarget({
                id: original.id,
                fullName: original.fullName,
                phone: original.phone,
                email: null,
                specialization: original.specialization,
                rankTitle: original.rankTitle,
                joinedDate: original.joinedDate,
                isActive: original.isActive,
                notes: null,
                defaultSessionFeeMinor: original.defaultSessionFeeMinor ?? 0,
                workingSchedule: original.workingSchedule ?? null,
              });
            }}
          >
            <Banknote className="size-3.5" />
            <span>صرف مرتب</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-amber-400 hover:bg-amber-400/10 hover:text-amber-300 gap-1 text-[11px] h-8 px-2"
            title={t("trainers.assignPt")}
            onClick={() => navigate(`/private-training?trainerId=${row.id}&newSub=1`)}
          >
            <Flame className="size-3.5 text-amber-400" />
            <span>{t("trainers.assignPtShort")}</span>
          </Button>
        </div>
      ),
    });

  columns.push({
    key: "schedule",
    header: "مواعيد العمل والحضور",
    render: (row) => {
      if (!row.workingSchedule || !row.workingSchedule.some((s) => s.isActive)) {
        return <span className="text-subtle text-xs">—</span>;
      }
      const presence = checkTrainerPresence(row.workingSchedule);
      return (
        <div className="space-y-1">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] border ${presence.badgeClass}`}>
            {presence.badgeText}
          </span>
          <p className="text-[11px] text-subtle truncate max-w-44">
            {formatTrainerScheduleBrief(row.workingSchedule)}
          </p>
        </div>
      );
    },
  });

  if (canManage || canPurge) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) => {
        const original = rows.find((tr) => tr.id === row.id);
        if (!original) return null;
        const model: PublicTrainer = {
          id: original.id,
          fullName: original.fullName,
          phone: original.phone,
          email: null,
          specialization: original.specialization,
          rankTitle: original.rankTitle,
          joinedDate: original.joinedDate,
          isActive: original.isActive,
          notes: null,
          defaultSessionFeeMinor: original.defaultSessionFeeMinor ?? 0,
          workingSchedule: original.workingSchedule ?? null,
        };
        return (
          <Dropdown
            align="end"
            trigger={
              <button
                type="button"
                aria-label={t("common.actions")}
                className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
              >
                <MoreHorizontal className="size-4" />
              </button>
            }
          >
            {canManage && (
              <>
                <DropdownItem
                  icon={<UserCheck className="text-neon" />}
                  label={t("trainers.viewProfile")}
                  onClick={() => setProfileTargetId(original.id)}
                />
                <DropdownItem
                  icon={<Pencil />}
                  label={t("common.edit")}
                  onClick={() => {
                    setEditTarget(model);
                    setFormOpen(true);
                  }}
                />
                <DropdownItem
                  icon={<Flame className="text-amber-400" />}
                  label={t("trainers.assignPt")}
                  onClick={() => navigate(`/private-training?trainerId=${original.id}&newSub=1`)}
                />
                <DropdownDivider />
                <DropdownItem
                  icon={<Banknote className="text-emerald-400" />}
                  label="صرف مرتب للمدرب"
                  onClick={() => setPayoutTarget(model)}
                />
                <DropdownItem
                  icon={<History className="text-cyan-400" />}
                  label="سجل الدفعات والمصروفات"
                  onClick={() => setHistoryTarget(model)}
                />
                <DropdownItem
                  icon={<FileText className="text-amber-400" />}
                  label="كشف حساب مالي موحد"
                  onClick={() => setStatementTarget(model)}
                />
                <DropdownDivider />
                <DropdownItem
                  icon={<Link2 />}
                  label={t("trainers.linkToEmployee")}
                  onClick={() => setLinkTarget(original)}
                />
                {!original.employeeId && (
                  <DropdownItem
                    icon={<UserPlus />}
                    label={t("trainers.createEmployeeProfile")}
                    onClick={() => {
                      setCreateEmpForm({
                        salaryType: "monthly",
                        salaryBaseMajor: "",
                        department: "general",
                        commissionPct: "",
                      });
                      setCreateEmpTarget(original);
                    }}
                  />
                )}
                {original.employeeId && (
                  <DropdownItem
                    icon={<Unlink />}
                    label={t("trainers.unlinkEmployee")}
                    danger
                    onClick={() => void onUnlinkEmployee(original.id)}
                  />
                )}
                <DropdownDivider />
                <DropdownItem
                  icon={<Power />}
                  label={original.isActive ? t("trainers.deactivate") : t("trainers.activate")}
                  danger={original.isActive}
                  onClick={() => setToggleTarget(model)}
                />
              </>
            )}
            {canPurge && (
              <>
                {canManage && <DropdownDivider />}
                <DropdownItem
                  icon={<Trash2 />}
                  label={t("trainers.delete")}
                  danger
                  onClick={() => setDeleteTarget(model)}
                />
              </>
            )}
          </Dropdown>
        );
      },
    });
  }

  const filteredRows = rows.filter((r) => {
    if (filter === "active" && !r.isActive) return false;
    if (filter === "presentNow") {
      const presence = checkTrainerPresence(r.workingSchedule);
      if (!presence.isPresent) return false;
    }
    if (filter === "linkedEmployee" && !r.employeeId) return false;
    return true;
  });

  const activeCount = rows.filter((r) => r.isActive).length;
  const presentCount = rows.filter((r) => checkTrainerPresence(r.workingSchedule).isPresent).length;
  const linkedCount = rows.filter((r) => Boolean(r.employeeId)).length;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Dumbbell aria-hidden className="size-4 text-neon" />
            {t("cls.tabTrainers")}
          </span>
        }
        action={
          canManage && (
            <Button
              onClick={() => {
                setEditTarget(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("trainers.add")}
            </Button>
          )
        }
      />

      {/* Filter and View Mode Switcher */}
      <div className="flex flex-col gap-3 px-5 pb-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/40 mb-3">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={t("trainers.searchPlaceholder")}
          className="w-full sm:w-80"
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1 bg-surface rounded-xl p-1 border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                filter === "all" ? "bg-neon/15 text-neon" : "text-subtle hover:text-foreground"
              }`}
            >
              الكل ({rows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("active")}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                filter === "active" ? "bg-emerald-500/15 text-emerald-400" : "text-subtle hover:text-foreground"
              }`}
            >
              النشطين ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("presentNow")}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                filter === "presentNow" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-subtle hover:text-foreground"
              }`}
            >
              🟢 بالصالة الآن ({presentCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("linkedEmployee")}
              className={`px-2.5 py-1 rounded-lg font-bold transition ${
                filter === "linkedEmployee" ? "bg-cyan-500/15 text-cyan-400" : "text-subtle hover:text-foreground"
              }`}
            >
              رواتب ({linkedCount})
            </button>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 bg-surface rounded-xl p-1 border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-lg transition ${
                viewMode === "grid" ? "bg-neon/15 text-neon" : "text-subtle hover:text-foreground"
              }`}
              title="عرض بطاقات"
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded-lg transition ${
                viewMode === "table" ? "bg-neon/15 text-neon" : "text-subtle hover:text-foreground"
              }`}
              title="عرض جدول"
            >
              <List className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState
          icon={<Dumbbell />}
          title={t("trainers.emptyTitle")}
          description={t("trainers.emptyDesc")}
        />
      ) : viewMode === "table" ? (
        <DataTable columns={columns} data={filteredRows} rowKey={(r) => r.id} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
          {filteredRows.map((row) => {
            const presence = checkTrainerPresence(row.workingSchedule);
            const waUrl = getWhatsAppUrl(row.phone);
            const model: PublicTrainer = {
              id: row.id,
              fullName: row.fullName,
              phone: row.phone,
              email: null,
              specialization: row.specialization,
              rankTitle: row.rankTitle,
              joinedDate: row.joinedDate,
              isActive: row.isActive,
              notes: null,
              defaultSessionFeeMinor: row.defaultSessionFeeMinor,
              workingSchedule: row.workingSchedule,
            };

            return (
              <div
                key={row.id}
                className="flex flex-col justify-between rounded-2xl border border-border/70 bg-surface/50 hover:border-neon/40 hover:bg-surface/80 transition-all p-4 space-y-3.5 shadow-xs"
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={row.fullName} size="md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-foreground truncate text-sm">{row.fullName}</span>
                        {row.rankTitle && (
                          <Badge variant="warning" className="text-[10px] shrink-0">
                            {row.rankTitle}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-subtle truncate mt-0.5">
                        {row.specialization || "مدرب ألعاب رياضية"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant={row.isActive ? "success" : "neutral"} dot>
                      {row.isActive ? t("status.active") : t("status.inactive")}
                    </Badge>
                    {presence.status !== "unknown" && (
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] border ${presence.badgeClass}`}>
                        {presence.badgeText}
                      </span>
                    )}
                  </div>
                </div>

                {/* Schedule & Phone Box */}
                <div className="rounded-xl border border-border/40 bg-surface/70 p-2.5 space-y-2 text-xs">
                  {row.workingSchedule && row.workingSchedule.some((s) => s.isActive) && (
                    <div className="flex items-center justify-between">
                      <span className="text-subtle flex items-center gap-1 shrink-0">
                        <Calendar className="size-3.5 text-neon" />
                        <span>مواعيد العمل:</span>
                      </span>
                      <span className="font-semibold text-foreground text-[11px] truncate max-w-44" title={formatTrainerScheduleBrief(row.workingSchedule)}>
                        {formatTrainerScheduleBrief(row.workingSchedule)}
                      </span>
                    </div>
                  )}

                  {row.phone && (
                    <div className={`flex items-center justify-between ${row.workingSchedule && row.workingSchedule.some((s) => s.isActive) ? "pt-1 border-t border-border/30" : ""}`}>
                      <span className="text-subtle flex items-center gap-1">
                        <Phone className="size-3.5 text-cyan-400" />
                        <span dir="ltr" className="tabnum font-semibold text-[11px]">{row.phone}</span>
                      </span>
                      {waUrl && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition"
                          title="مراسلة عبر واتساب"
                        >
                          <MessageCircle className="size-3.5" />
                          <span>واتساب</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Assigned Academies */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-border/30">
                  <span className="text-subtle flex items-center gap-1">
                    <Trophy className="size-3.5 text-amber-400" />
                    <span>الأكاديميات المسندة:</span>
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end max-w-44">
                    {row.assignedAcademies && row.assignedAcademies.length > 0 ? (
                      row.assignedAcademies.map((acad) => (
                        <Badge key={acad} variant="warning" className="text-[10px] py-0 px-1.5 font-bold">
                          {acad}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[11px] text-faint">غير مسند</span>
                    )}
                  </div>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-surface/80 border border-border/30 p-1.5">
                    <span className="text-[10px] text-subtle block">مشتركي التدريب الخاص</span>
                    <span className="font-bold text-amber-400 tabnum">{row.activePlans} مشترك</span>
                  </div>
                  <div className="rounded-lg bg-surface/80 border border-border/30 p-1.5">
                    <span className="text-[10px] text-subtle block">سجل الرواتب</span>
                    {row.employeeName ? (
                      <span className="font-semibold text-neon text-[11px] truncate block">
                        {row.employeeName}
                      </span>
                    ) : (
                      <span className="text-faint text-[10px] block">غير مرتبط</span>
                    )}
                  </div>
                </div>

                {/* Direct Action Buttons */}
                <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-1.5">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex-1 gap-1 h-8"
                    onClick={() => setPayoutTarget(model)}
                  >
                    <Banknote className="size-3.5" />
                    <span>صرف مرتب</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-cyan-400 hover:text-cyan-300 text-xs px-2.5 h-8"
                    title="سجل الصرف والمصروفات"
                    onClick={() => setHistoryTarget(model)}
                  >
                    <History className="size-3.5" />
                  </Button>

                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-amber-400 hover:text-amber-300 text-xs px-2.5 h-8"
                    title="كشف الحساب المالي الموحد"
                    onClick={() => setStatementTarget(model)}
                  >
                    <FileText className="size-3.5" />
                  </Button>

                  {canManage && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-subtle hover:text-foreground text-xs px-2.5 h-8"
                      title="تعديل المدرب والمواعيد"
                      onClick={() => {
                        setEditTarget(model);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}

                  {/* Dropdown Menu */}
                  <Dropdown
                    align="end"
                    trigger={
                      <button
                        type="button"
                        aria-label={t("common.actions")}
                        className="grid size-8 place-items-center rounded-lg text-faint hover:bg-white/5 hover:text-subtle transition"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    }
                  >
                    {canManage && (
                      <>
                        <DropdownItem
                          icon={<UserCheck className="text-neon" />}
                          label={t("trainers.viewProfile")}
                          onClick={() => setProfileTargetId(row.id)}
                        />
                        <DropdownItem
                          icon={<Flame className="text-amber-400" />}
                          label={t("trainers.assignPt")}
                          onClick={() => navigate(`/private-training?trainerId=${row.id}&newSub=1`)}
                        />
                        <DropdownItem
                          icon={<Dumbbell className="text-cyan-400" />}
                          label={t("trainers.assignClass")}
                          onClick={() => setAssignAcademyTrainerId(row.id)}
                        />
                        <DropdownDivider />
                        <DropdownItem
                          icon={<Link2 />}
                          label={t("trainers.linkToEmployee")}
                          onClick={() => setLinkTarget(row)}
                        />
                        {!row.employeeId && (
                          <DropdownItem
                            icon={<UserPlus />}
                            label={t("trainers.createEmployeeProfile")}
                            onClick={() => {
                              setCreateEmpForm({
                                salaryType: "monthly",
                                salaryBaseMajor: "",
                                department: "general",
                                commissionPct: "",
                              });
                              setCreateEmpTarget(row);
                            }}
                          />
                        )}
                        {row.employeeId && (
                          <DropdownItem
                            icon={<Unlink />}
                            label={t("trainers.unlinkEmployee")}
                            danger
                            onClick={() => void onUnlinkEmployee(row.id)}
                          />
                        )}
                        <DropdownDivider />
                        <DropdownItem
                          icon={<Power />}
                          label={row.isActive ? t("trainers.deactivate") : t("trainers.activate")}
                          danger={row.isActive}
                          onClick={() => setToggleTarget(model)}
                        />
                      </>
                    )}
                    {canPurge && (
                      <>
                        {canManage && <DropdownDivider />}
                        <DropdownItem
                          icon={<Trash2 />}
                          label={t("trainers.delete")}
                          danger
                          onClick={() => setDeleteTarget(model)}
                        />
                      </>
                    )}
                  </Dropdown>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TrainerFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        target={editTarget}
        onSaved={() => {
          setFormOpen(false);
          reload();
        }}
      />

      <ConfirmDialog
        open={toggleTarget !== null}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => void onToggleActive()}
        title={
          toggleTarget?.isActive
            ? t("trainers.deactivateTitle", { name: toggleTarget.fullName })
            : t("trainers.activateTitle", { name: toggleTarget?.fullName ?? "" })
        }
        message={
          toggleTarget?.isActive
            ? t("trainers.deactivateMessage", { name: toggleTarget.fullName })
            : t("trainers.activateMessage")
        }
        confirmLabel={t(toggleTarget?.isActive ? "trainers.deactivate" : "trainers.activate")}
        loading={busy}
        tone={toggleTarget?.isActive ? "danger" : "primary"}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void onDeleteTrainer()}
        title={t("trainers.deleteTitle", { name: deleteTarget?.fullName ?? "" })}
        message={t("trainers.deleteMessage", { name: deleteTarget?.fullName ?? "" })}
        confirmLabel={t("common.delete")}
        loading={busy}
        tone="danger"
      />

      {linkTarget && (
        <Modal
          open
          onClose={() => setLinkTarget(null)}
          title={t("trainers.linkToEmployee")}
          widthClass="max-w-md"
          footer={
            <>
              <Button loading={busy} onClick={() => void onSaveLink()}>
                {t("common.save")}
              </Button>
              <Button variant="secondary" onClick={() => setLinkTarget(null)}>
                {t("common.cancel")}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-subtle">
              {t("trainers.editTitle")}: <strong className="text-white">{linkTarget.fullName}</strong>
            </p>
            <Select
              label={t("trainers.selectEmployee")}
              value={selectedEmpId}
              onChange={(e) => setSelectedEmpId(e.target.value)}
              options={[
                { value: "", label: t("trainers.noLinkedEmployee") },
                ...availableEmployees.map((e) => ({
                  value: e.id,
                  label: `${e.fullName} (${e.roleTitle || "موظف"})`,
                })),
              ]}
            />
          </div>
        </Modal>
      )}

      {createEmpTarget && (
        <Modal
          open
          onClose={() => setCreateEmpTarget(null)}
          title={t("trainers.createEmployeeProfile")}
          widthClass="max-w-md"
          footer={
            <>
              <Button loading={busy} onClick={() => void onCreateEmployee()}>
                {t("common.save")}
              </Button>
              <Button variant="secondary" onClick={() => setCreateEmpTarget(null)}>
                {t("common.cancel")}
              </Button>
            </>
          }
        >
          <div className="space-y-3.5">
            <div className="rounded-lg bg-surface p-3 text-sm">
              <span className="block text-faint">{t("trainers.tabTrainers")}:</span>
              <span className="font-bold text-white">{createEmpTarget.fullName}</span>
              {createEmpTarget.phone && <span dir="ltr" className="block text-xs text-subtle">{createEmpTarget.phone}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t("emp.salaryType")}
                value={createEmpForm.salaryType}
                onChange={(e) => setCreateEmpForm((f) => ({ ...f, salaryType: e.target.value as SalaryType }))}
                options={[
                  { value: "monthly", label: t("emp.stMonthly") },
                  { value: "daily", label: t("emp.stDaily") },
                  { value: "per_class", label: t("emp.stPerClass") },
                  { value: "custom", label: t("emp.stCustom") },
                ]}
              />
              <Select
                label={t("members.department")}
                value={createEmpForm.department}
                onChange={(e) => setCreateEmpForm((f) => ({ ...f, department: e.target.value as typeof f.department }))}
                options={[
                  { value: "general", label: t("members.deptGeneral") },
                  { value: "men", label: t("members.deptMen") },
                  { value: "women", label: t("members.deptWomen") },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t("emp.salaryBase")}
                type="number"
                step="0.01"
                min={0}
                dir="ltr"
                value={createEmpForm.salaryBaseMajor}
                onChange={(e) => setCreateEmpForm((f) => ({ ...f, salaryBaseMajor: e.target.value }))}
              />
              <Input
                label={t("emp.commissionPct")}
                type="number"
                step="0.1"
                min={0}
                max={100}
                dir="ltr"
                value={createEmpForm.commissionPct}
                onChange={(e) => setCreateEmpForm((f) => ({ ...f, commissionPct: e.target.value }))}
              />
            </div>
          </div>
        </Modal>
      )}

      <TrainerProfileModal
        open={profileTargetId !== null}
        onClose={() => setProfileTargetId(null)}
        trainerId={profileTargetId}
      />

      {payoutTarget && (
        <TrainerPayoutModal
          open
          trainer={payoutTarget}
          onClose={() => setPayoutTarget(null)}
          onSaved={reload}
        />
      )}

      {historyTarget && (
        <TrainerPayoutsHistoryModal
          open
          trainer={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {statementTarget && (
        <TrainerStatementModal
          open
          trainer={statementTarget}
          onClose={() => setStatementTarget(null)}
          onPayoutRecorded={reload}
        />
      )}

      {assignAcademyTrainerId && (
        <PlanFormModal
          open
          defaultCategory="academy"
          plan={{
            id: "",
            name: "",
            category: "academy",
            durationDays: 30,
            price: 0,
            kind: "sessions",
            sessionsCount: 8,
            isActive: true,
            trainerId: assignAcademyTrainerId,
            capacity: 15,
            scheduleSlots: [],
            invitationsCount: 0,
          }}
          onClose={() => setAssignAcademyTrainerId(null)}
          onSaved={() => {
            setAssignAcademyTrainerId(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}