import { useEffect, useMemo, useState } from "react";
import { UserCheck, Clock, LogIn, LogOut, User, CheckCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type TrainerAttendanceItem, type TrainerAttendanceSummary, type PublicTrainer } from "@/api";
import { todayKey } from "@/core/dates";
import { formatTime } from "@/services/format";
import { cn } from "@/utils/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";

export function TrainerAttendancePage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [date, setDate] = useState<string>(todayKey());
  const [trainerId, setTrainerId] = useState<string>("");
  const [items, setItems] = useState<TrainerAttendanceItem[]>([]);
  const [summary, setSummary] = useState<TrainerAttendanceSummary>({
    totalTrainers: 0,
    presentToday: 0,
    currentlyPresent: 0,
    absentToday: 0,
  });
  const [trainers, setTrainers] = useState<PublicTrainer[]>([]);

  // Check-in modal
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [selectedTrainer, setSelectedTrainer] = useState("");
  const [checkInTime, setCheckInTime] = useState("");
  const [status, setStatus] = useState<"present" | "late" | "absent" | "excused">("present");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    try {
      const [listRes, sumRes] = await Promise.all([
        api.trainerAttendance.list(date, trainerId || undefined),
        api.trainerAttendance.getSummary(date),
      ]);
      setItems(listRes);
      setSummary(sumRes);
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const loadTrainers = async () => {
    try {
      const res = await api.trainers.list({ activeOnly: true });
      setTrainers(res);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadData();
  }, [date, trainerId]);

  useEffect(() => {
    void loadTrainers();
  }, []);

  const handleOpenCheckIn = () => {
    const now = new Date();
    setCheckInTime(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
    setSelectedTrainer(trainers[0]?.id || "");
    setStatus("present");
    setNotes("");
    setShowCheckInModal(true);
  };

  const handleRecordCheckIn = async () => {
    if (!selectedTrainer) {
      toast("error", "يرجى اختيار المدرب");
      return;
    }
    setSaving(true);
    try {
      await api.trainerAttendance.checkIn({
        trainerId: selectedTrainer,
        date,
        time: checkInTime || undefined,
        status,
        notes: notes.trim() || undefined,
      });
      toast("success", "تم تسجيل حضور المدرب بنجاح");
      setShowCheckInModal(false);
      void loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const handleRecordCheckOut = async (attendanceId: string) => {
    try {
      await api.trainerAttendance.checkOut({ attendanceId });
      toast("success", "تم تسجيل انصراف المدرب بنجاح");
      void loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const statusBadge = (s: string) => {
    switch (s) {
      case "present":
        return <Badge variant="success">حاضر</Badge>;
      case "late":
        return <Badge variant="warning">متأخر</Badge>;
      case "excused":
        return <Badge variant="neutral">معتذر</Badge>;
      case "absent":
        return <Badge variant="danger">غائب</Badge>;
      default:
        return <Badge variant="neutral">{s}</Badge>;
    }
  };

  const [statusFilter, setStatusFilter] = useState<"all" | "present_now" | "present" | "late" | "absent">("all");

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "present_now") return !item.check_out_time && !!item.check_in_time && item.status !== "absent";
      if (statusFilter === "present") return item.status === "present";
      if (statusFilter === "late") return item.status === "late";
      if (statusFilter === "absent") return item.status === "absent";
      return true;
    });
  }, [items, statusFilter]);

  const columns: Column<TrainerAttendanceItem>[] = [
    {
      key: "trainer_name",
      header: "المدرب",
      render: (item) => (
        <div>
          <div className="font-semibold text-foreground">{item.trainer_name}</div>
          {item.trainer_specialization && (
            <div className="text-xs text-subtle">{item.trainer_specialization}</div>
          )}
        </div>
      ),
    },
    {
      key: "check_in_time",
      header: "وقت الحضور",
      render: (item) => (
        <span className="font-mono text-sm text-foreground flex items-center gap-1">
          <LogIn className="w-3.5 h-3.5 text-emerald-400" />
          {formatTime(item.check_in_time)}
        </span>
      ),
    },
    {
      key: "check_out_time",
      header: "وقت الانصراف",
      render: (item) =>
        item.check_out_time ? (
          <span className="font-mono text-sm text-foreground flex items-center gap-1">
            <LogOut className="w-3.5 h-3.5 text-amber-400" />
            {formatTime(item.check_out_time)}
          </span>
        ) : hasPermission("trainer_attendance.manage") ? (
          <Button
            size="sm"
            variant="secondary"
            className="text-xs py-1 h-7"
            onClick={() => handleRecordCheckOut(item.id)}
          >
            <LogOut className="w-3 h-3 me-1" />
            تسجيل انصراف
          </Button>
        ) : (
          <span className="text-xs text-subtle">متواجد حالياً</span>
        ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (item) => statusBadge(item.status),
    },
    {
      key: "notes",
      header: "ملاحظات",
      render: (item) => item.notes || "—",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCheck className="w-7 h-7 text-primary" />
            حضور وانصراف المدربين
          </h1>
          <p className="text-sm text-subtle mt-1">
            متابعة حضور المدربين اليومي ومواعيد الدخول والخروج والغياب بالصيغة الموحدة 12 ساعة
          </p>
        </div>

        {hasPermission("trainer_attendance.manage") && (
          <Button variant="primary" onClick={handleOpenCheckIn}>
            <LogIn className="w-4 h-4 me-1.5" />
            تسجيل حضور مدرب
          </Button>
        )}
      </div>

      {/* Interactive Stats Telemetry Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            statusFilter === "all" ? "ring-2 ring-cyan shadow-md shadow-cyan/20" : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<User className="w-5 h-5 text-cyan" />}
            title="إجمالي المدربين"
            value={String(summary.totalTrainers)}
            accent="cyan"
          />
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("present")}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            statusFilter === "present" ? "ring-2 ring-emerald shadow-md shadow-emerald/20" : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<CheckCircle className="w-5 h-5 text-emerald" />}
            title="حضروا اليوم"
            value={String(summary.presentToday)}
            accent="emerald"
          />
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("present_now")}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            statusFilter === "present_now" ? "ring-2 ring-amber shadow-md shadow-amber/20" : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<Clock className="w-5 h-5 text-amber" />}
            title="متواجدون الآن"
            value={String(summary.currentlyPresent)}
            accent="amber"
          />
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("absent")}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            statusFilter === "absent" ? "ring-2 ring-red shadow-md shadow-red/20" : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<AlertTriangle className="w-5 h-5 text-red" />}
            title="لم يحضروا"
            value={String(summary.absentToday)}
            accent="red"
          />
        </button>
      </div>

      {/* Filters & Glass Capsule Status Pills */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-panel-border/50 bg-panel/60 p-1.5 backdrop-blur-md shadow-sm">
          {[
            { value: "all", label: "جميع السجلات", count: items.length },
            { value: "present_now", label: "متواجدون الآن 🟢", count: summary.currentlyPresent },
            { value: "present", label: "حاضرون في الموعد ✓", count: items.filter((i) => i.status === "present").length },
            { value: "late", label: "متأخرون ⚠️", count: items.filter((i) => i.status === "late").length },
            { value: "absent", label: "غياب ✕", count: summary.absentToday },
          ].map((pill) => {
            const isActive = statusFilter === pill.value;
            return (
              <button
                key={pill.value}
                type="button"
                onClick={() => setStatusFilter(pill.value as any)}
                className={cn(
                  "group relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-200",
                  isActive
                    ? "border border-primary bg-primary/20 text-white shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
                    : "border border-panel-border/40 bg-surface/50 text-subtle hover:text-white hover:bg-surface/80",
                )}
              >
                <span>{pill.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                    isActive ? "bg-primary text-black font-bold" : "bg-surface-2 text-subtle",
                  )}
                >
                  {pill.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40 text-xs"
          />
          <Select
            value={trainerId}
            onChange={(e) => setTrainerId(e.target.value)}
            options={[
              { value: "", label: "-- جميع المدربين --" },
              ...trainers.map((t) => ({ value: t.id, label: t.fullName })),
            ]}
            className="w-48 text-xs"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader title={`سجل الحضور - ${date} (${filteredItems.length} سجل)`} />
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<UserCheck className="w-10 h-10 text-subtle" />}
            title="لا توجد سجلات مطابقة"
            description={
              statusFilter !== "all"
                ? "لا توجد سجلات للحالة المحددة. جرب اختيار تصفية أخرى أو تاريخ مختلف."
                : "اضغط على زر «تسجيل حضور مدرب» لتسجيل حضور اليوم"
            }
          />
        ) : (
          <DataTable<TrainerAttendanceItem>
            rowKey={(item) => item.id}
            data={filteredItems}
            columns={columns}
          />
        )}
      </Card>

      {/* Check In Modal */}
      <Modal
        open={showCheckInModal}
        onClose={() => setShowCheckInModal(false)}
        title="تسجيل حضور مدرب"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCheckInModal(false)}>
              إلغاء
            </Button>
            <Button variant="primary" loading={saving} onClick={handleRecordCheckIn}>
              تأكيد الحضور
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold block mb-1">المدرب *</label>
            <Select
              value={selectedTrainer}
              onChange={(e) => setSelectedTrainer(e.target.value)}
              options={[
                { value: "", label: "-- اختر المدرب --" },
                ...trainers.map((t) => ({ value: t.id, label: t.fullName })),
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold block mb-1">وقت الحضور</label>
              <Input
                type="time"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1">حالة الحضور</label>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                options={[
                  { value: "present", label: "حاضر في الموعد" },
                  { value: "late", label: "متأخر" },
                  { value: "excused", label: "معتذر ومبرر" },
                  { value: "absent", label: "غياب" },
                ]}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1">ملاحظات</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي ملاحظات إضافية بخصوص الوردية..."
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
