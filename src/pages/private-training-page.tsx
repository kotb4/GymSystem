import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Flame, Plus, Search, Dumbbell, CheckCircle2, Award, History } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type PTPackageRow,
  type PrivateTrainingRow,
  type PublicMember,
} from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { formatTime } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/utils/cn";

export function PrivateTrainingPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"subscriptions" | "packages">("subscriptions");

  // Summary stats
  const [summary, setSummary] = useState({
    activeCount: 0,
    completedCount: 0,
    totalRevenueMinor: 0,
    totalCompletedSessions: 0,
  });

  // PT Subscriptions state
  const [subscriptions, setSubscriptions] = useState<PrivateTrainingRow[]>([]);
  const [subsTotal, setSubsTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [trainerFilter, setTrainerFilter] = useState("all");
  const [loadingSubs, setLoadingSubs] = useState(false);

  // Packages state
  const [packages, setPackages] = useState<PTPackageRow[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);

  // Common data
  const [trainers, setTrainers] = useState<Array<{ id: string; fullName: string }>>([]);
  const [members, setMembers] = useState<PublicMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");

  // New Subscription modal
  const [newSubModalOpen, setNewSubModalOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedTrainerId, setSelectedTrainerId] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [totalSessions, setTotalSessions] = useState("12");
  const [priceMajor, setPriceMajor] = useState("600");
  const [paidMajor, setPaidMajor] = useState("600");
  const [methodCode, setMethodCode] = useState("cash");
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState("");
  const [subNotes, setSubNotes] = useState("");
  const [savingSub, setSavingSub] = useState(false);

  // New Package modal
  const [newPkgModalOpen, setNewPkgModalOpen] = useState(false);
  const [pkgName, setPkgName] = useState("");
  const [pkgSessions, setPkgSessions] = useState("12");
  const [pkgPriceMajor, setPkgPriceMajor] = useState("600");
  const [pkgDurationDays, setPkgDurationDays] = useState("30");
  const [pkgCommissionPercent, setPkgCommissionPercent] = useState("30");
  const [savingPkg, setSavingPkg] = useState(false);

  // Record Session modal
  const [recordTarget, setRecordTarget] = useState<PrivateTrainingRow | null>(null);
  const [sessionDate, setSessionDate] = useState(todayKey());
  const [sessionTime, setSessionTime] = useState("18:00");
  const [sessionNotes, setSessionNotes] = useState("");
  const [recording, setRecording] = useState(false);

  // View Sessions History modal
  const [viewHistoryTarget, setViewHistoryTarget] = useState<PrivateTrainingRow | null>(null);

  const loadSummary = async () => {
    try {
      const res = await api.privateTraining.getSummary();
      setSummary(res);
    } catch {
      // ignore
    }
  };

  const loadSubscriptions = async () => {
    setLoadingSubs(true);
    try {
      const res = await api.privateTraining.listTrainings({
        status: statusFilter !== "all" ? statusFilter : undefined,
        trainerId: trainerFilter !== "all" ? trainerFilter : undefined,
        search: search.trim() || undefined,
        limit: 100,
      });
      setSubscriptions(res.items);
      setSubsTotal(res.total);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoadingSubs(false);
    }
  };

  const loadPackages = async () => {
    setLoadingPackages(true);
    try {
      const res = await api.privateTraining.listPackages();
      setPackages(res);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoadingPackages(false);
    }
  };

  const loadTrainers = async () => {
    try {
      const res = await api.trainers.list();
      setTrainers(res.map((tr) => ({ id: tr.id, fullName: tr.fullName })));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadSummary();
    void loadTrainers();
    const trainerFromUrl = searchParams.get("trainerId");
    const openNewFromUrl = searchParams.get("newSub");
    if (trainerFromUrl) {
      setTrainerFilter(trainerFromUrl);
      setSelectedTrainerId(trainerFromUrl);
    }
    if (openNewFromUrl === "1") {
      void loadPackages();
      setNewSubModalOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeTab === "subscriptions") {
      void loadSubscriptions();
    } else {
      void loadPackages();
    }
  }, [activeTab, statusFilter, trainerFilter, search]);

  useEffect(() => {
    if (memberSearch.trim().length >= 2) {
      void api.members.list({ search: memberSearch.trim(), pageSize: 10 }).then((res) => {
        setMembers(res.items);
      });
    }
  }, [memberSearch]);

  const handlePackageSelect = (pkgId: string) => {
    setSelectedPackageId(pkgId);
    const pkg = packages.find((p) => p.id === pkgId);
    if (pkg) {
      setTotalSessions(pkg.sessions_count.toString());
      setPriceMajor((pkg.price_minor / 100).toString());
      setPaidMajor((pkg.price_minor / 100).toString());

      // Calculate end date based on duration days
      const d = new Date(startDate || todayKey());
      d.setDate(d.getDate() + pkg.duration_days);
      setEndDate(d.toISOString().slice(0, 10));
    }
  };

  const handleOpenNewSub = () => {
    void loadPackages();
    setSelectedMemberId("");
    setSelectedTrainerId("");
    setSelectedPackageId("");
    setTotalSessions("12");
    setPriceMajor("600");
    setPaidMajor("600");
    setMethodCode("cash");
    setStartDate(todayKey());

    const d = new Date();
    d.setDate(d.getDate() + 30);
    setEndDate(d.toISOString().slice(0, 10));

    setSubNotes("");
    setNewSubModalOpen(true);
  };

  const handleSaveSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId) {
      toast("error", "يرجى اختيار العضو");
      return;
    }
    if (!selectedTrainerId) {
      toast("error", "يرجى اختيار المدرب (كابتن التدريب الخاص)");
      return;
    }

    setSavingSub(true);
    try {
      const priceMinor = Math.round(parseFloat(priceMajor || "0") * 100);
      const paidAmountMinor = Math.round(parseFloat(paidMajor || "0") * 100);

      await api.privateTraining.createTraining({
        memberId: selectedMemberId,
        trainerId: selectedTrainerId,
        packageId: selectedPackageId || undefined,
        totalSessions: parseInt(totalSessions || "1"),
        priceMinor,
        paidAmountMinor,
        methodCode,
        startDate,
        endDate: endDate || startDate,
        notes: subNotes.trim() || undefined,
      });

      toast("success", "تم تسجيل اشتراك التدريب الخاص (PT) بنجاح");
      setNewSubModalOpen(false);
      void loadSubscriptions();
      void loadSummary();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingSub(false);
    }
  };

  const handleSavePkg = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPkg(true);
    try {
      const priceMinor = Math.round(parseFloat(pkgPriceMajor || "0") * 100);
      await api.privateTraining.createPackage({
        name: pkgName.trim(),
        sessionsCount: parseInt(pkgSessions || "1"),
        priceMinor,
        durationDays: parseInt(pkgDurationDays || "30"),
        coachCommissionPercent: parseFloat(pkgCommissionPercent || "0"),
      });

      toast("success", "تم إنشاء باقة التدريب الخاص بنجاح");
      setNewPkgModalOpen(false);
      setPkgName("");
      void loadPackages();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingPkg(false);
    }
  };

  const handleRecordSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recordTarget) return;

    setRecording(true);
    try {
      await api.privateTraining.recordSession({
        privateTrainingId: recordTarget.id,
        trainerId: recordTarget.trainer_id,
        sessionDate,
        sessionTime,
        notes: sessionNotes.trim() || undefined,
      });

      toast("success", "تم خصم وتسجيل حصة التدريب الخاص بنجاح");
      setRecordTarget(null);
      void loadSubscriptions();
      void loadSummary();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setRecording(false);
    }
  };

  const handleViewHistory = async (sub: PrivateTrainingRow) => {
    try {
      const full = await api.privateTraining.getById(sub.id);
      if (full) {
        setViewHistoryTarget(full);
      }
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success">نشط وساري</Badge>;
      case "completed":
        return <Badge variant="info">مكتمل الحصص</Badge>;
      case "cancelled":
        return <Badge variant="danger">ملغي</Badge>;
      default:
        return <Badge variant="neutral">منتهي الصلاحية</Badge>;
    }
  };

  const subColumns: Column<PrivateTrainingRow>[] = [
    {
      key: "member",
      header: "المتدرب (العضو)",
      render: (r) => (
        <div>
          <span className="font-medium text-main block">{r.member_name}</span>
          <span className="text-xs text-muted font-mono">{r.member_phone || r.member_code}</span>
        </div>
      ),
    },
    {
      key: "trainer",
      header: "المدرب الخاص (Coach)",
      render: (r) => (
        <span className="font-semibold text-amber-400 text-xs">
          كابتن / {r.trainer_name}
        </span>
      ),
    },
    {
      key: "sessions",
      header: "الحصص المنفذة",
      render: (r) => {
        const percent = Math.min(Math.round((r.completed_sessions / r.total_sessions) * 100), 100);
        return (
          <div className="w-32">
            <div className="flex justify-between text-xs mb-1 font-mono">
              <span className="font-semibold text-main">{r.completed_sessions} من {r.total_sessions}</span>
              <span className="text-muted">{r.total_sessions - r.completed_sessions} متبقي</span>
            </div>
            <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-400 rounded-full transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: "financial",
      header: "المالية",
      render: (r) => (
        <div className="text-xs">
          <span className="font-mono block">{formatMinor(r.price_minor)}</span>
          {r.remaining_amount_minor > 0 ? (
            <span className="text-rose-400 font-semibold font-mono block">
              متبقي: {formatMinor(r.remaining_amount_minor)}
            </span>
          ) : (
            <span className="text-emerald-400 font-mono block">مسدد بالكامل</span>
          )}
        </div>
      ),
    },
    {
      key: "dates",
      header: "الصلاحية",
      render: (r) => (
        <div className="text-xs text-muted font-mono">
          <span>{r.start_date}</span>
          <span className="mx-1">←</span>
          <span>{r.end_date}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (r) => statusBadge(r.status),
    },
    {
      key: "actions",
      header: "الإجراءات",
      render: (r) => (
        <div className="flex items-center gap-1.5">
          {r.status === "active" && r.completed_sessions < r.total_sessions && hasPermission("private_training.manage") && (
            <Button
              size="sm"
              onClick={() => {
                setRecordTarget(r);
                setSessionDate(todayKey());
                setSessionTime(new Date().toTimeString().slice(0, 5));
                setSessionNotes("");
              }}
              className="gap-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold h-7 text-xs"
            >
              <CheckCircle2 className="size-3.5" />
              تسجيل حصة
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleViewHistory(r)}
            className="h-7 text-xs text-muted hover:text-main"
            title="عرض سجل الحصص"
          >
            <History className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const pkgColumns: Column<PTPackageRow>[] = [
    {
      key: "name",
      header: "اسم الباقة",
      render: (r) => <span className="font-medium text-main">{r.name}</span>,
    },
    {
      key: "sessions",
      header: "عدد الحصص",
      render: (r) => <span className="font-mono font-semibold">{r.sessions_count} حصة</span>,
    },
    {
      key: "price",
      header: "سعر الباقة",
      render: (r) => <span className="font-mono text-emerald-400">{formatMinor(r.price_minor)}</span>,
    },
    {
      key: "duration",
      header: "مدة الصلاحية",
      render: (r) => <span className="text-xs">{r.duration_days} يوم</span>,
    },
    {
      key: "commission",
      header: "عمولة المدرب (%)",
      render: (r) => <span className="text-xs font-mono text-amber-400">{r.coach_commission_percent}%</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-main flex items-center gap-2">
            <Flame className="size-6 text-amber-500" />
            التدريب الخاص والمتابعة الشخصية (Private Training - PT)
          </h1>
          <p className="text-sm text-muted mt-1">
            إدارة اشتراكات البرايفت، تعيين الكباتن والمدربين، ومتابعة رصيد الحصص المستهلكة والمتبقية
          </p>
        </div>

        <div className="flex items-center gap-2">
          {hasPermission("private_training.manage") && (
            <>
              <Button
                variant="secondary"
                onClick={() => setNewPkgModalOpen(true)}
                className="gap-2"
              >
                <Plus className="size-4" />
                إنشاء باقة PT جديدة
              </Button>
              <Button
                onClick={handleOpenNewSub}
                className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
              >
                <Plus className="size-4" />
                اشتراك برايفت جديد
              </Button>
            </>
          )}
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => {
            setActiveTab("subscriptions");
            setStatusFilter("active");
          }}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            activeTab === "subscriptions" && statusFilter === "active" ? "ring-2 ring-amber shadow-md shadow-amber/20" : "hover:opacity-90",
          )}
        >
          <StatCard
            title="الاشتراكات الخاصة النشطة"
            value={String(summary.activeCount)}
            icon={<Flame className="size-5" />}
            accent="amber"
            subtitle="متدرب ساري اشتراكه حالياً"
          />
        </button>
        <StatCard
          title="إجمالي إيرادات البرايفت"
          value={formatMinor(summary.totalRevenueMinor)}
          icon={<Dumbbell className="size-5" />}
          accent="cyan"
          subtitle="المبالغ المحصلة من الاشتراكات"
        />
        <StatCard
          title="الحصص المنفذة فعلياً"
          value={String(summary.totalCompletedSessions)}
          icon={<CheckCircle2 className="size-5" />}
          accent="emerald"
          subtitle="حصة تدريب خاص تم حضورها"
        />
        <button
          type="button"
          onClick={() => {
            setActiveTab("subscriptions");
            setStatusFilter("completed");
          }}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            activeTab === "subscriptions" && statusFilter === "completed" ? "ring-2 ring-neon shadow-md shadow-neon/20" : "hover:opacity-90",
          )}
        >
          <StatCard
            title="الاشتراكات المكتملة"
            value={String(summary.completedCount)}
            icon={<Award className="size-5" />}
            accent="neon"
            subtitle="استهلكت جميع الحصص المخصصة"
          />
        </button>
      </div>

      {/* Glass Capsule Tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line/60 bg-panel/70 p-2 backdrop-blur-xl shadow-lg shadow-black/20">
        {[
          { value: "subscriptions", label: "اشتراكات المتدربين (PT Subscriptions)", icon: Flame, badge: subsTotal || undefined },
          { value: "packages", label: "باقات وأسعار التدريب الخاص (Packages)", icon: Award, badge: packages.length || undefined },
        ].map((item) => {
          const isActive = activeTab === item.value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setActiveTab(item.value as "subscriptions" | "packages")}
              className={cn(
                "group relative flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all duration-200",
                isActive
                  ? "bg-gradient-to-r from-amber-500/20 via-amber-500/15 to-transparent text-white border border-amber-500/50 shadow-md shadow-amber-500/10"
                  : "text-subtle hover:text-white hover:bg-surface/60 border border-transparent",
              )}
            >
              <Icon
                className={cn(
                  "size-4 transition-transform duration-200 group-hover:scale-110",
                  isActive ? "text-amber-400" : "text-subtle",
                )}
              />
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span className="ms-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === "subscriptions" ? (
        <Card>
          <CardHeader
            title="سجل اشتراكات التدريب الخاص"
            description={`إجمالي ${subsTotal} اشتراك`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={trainerFilter}
                  onChange={(e) => setTrainerFilter(e.target.value)}
                  options={[
                    { value: "all", label: "كل المدربين" },
                    ...trainers.map((tr) => ({ value: tr.id, label: `كابتن / ${tr.fullName}` })),
                  ]}
                  className="w-40 text-xs"
                />

                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  options={[
                    { value: "all", label: "كل الحالات" },
                    { value: "active", label: "نشط وساري" },
                    { value: "completed", label: "مكتمل الحصص" },
                    { value: "cancelled", label: "ملغي" },
                  ]}
                  className="w-32 text-xs"
                />

                <div className="relative w-52">
                  <Search className="size-4 absolute right-2.5 top-2.5 text-muted pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="بحث باسم المتدرب أو الهاتف..."
                    className="pr-8 text-xs"
                  />
                </div>
              </div>
            }
          />

          {subscriptions.length === 0 && !loadingSubs ? (
            <div className="p-8">
              <EmptyState
                icon={<Flame />}
                title="لا توجد اشتراكات تدريب خاص"
                description="لم يتم العثور على أي اشتراكات برايفت مطابقة للشروط."
              />
            </div>
          ) : (
            <DataTable<PrivateTrainingRow>
              columns={subColumns}
              data={subscriptions}
              rowKey={(r) => r.id}
            />
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="باقات التدريب الخاص المتاحة"
            description={`إجمالي ${packages.length} باقة مسجلة`}
          />

          {packages.length === 0 && !loadingPackages ? (
            <div className="p-8">
              <EmptyState
                icon={<Dumbbell />}
                title="لا توجد باقات برايفت"
                description="اضغط على «إنشاء باقة PT جديدة» لإضافة باقات التدريب الخاص وأسعارها."
              />
            </div>
          ) : (
            <DataTable<PTPackageRow>
              columns={pkgColumns}
              data={packages}
              rowKey={(r) => r.id}
            />
          )}
        </Card>
      )}

      {/* New PT Subscription Modal */}
      {newSubModalOpen && (
        <Modal
          open={newSubModalOpen}
          onClose={() => setNewSubModalOpen(false)}
          title="تسجيل اشتراك تدريب خاص جديد (New PT Subscription)"
        >
          <form onSubmit={handleSaveSub} className="space-y-4">
            <div className="space-y-2 p-3 bg-surface-2 rounded-lg border border-line">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  ابحث عن المتدرب (العضو)
                </label>
                <Input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="اكتب اسم العضو أو هاتفه..."
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  اختر العضو *
                </label>
                <Select
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  options={[
                    { value: "", label: "-- اضغط لاختيار العضو --" },
                    ...members.map((m) => ({
                      value: m.id,
                      label: `${m.fullName} (${m.memberCode}) - ${m.phone || "بدون هاتف"}`,
                    })),
                  ]}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  المدرب الخاص (الكابتن) *
                </label>
                <Select
                  value={selectedTrainerId}
                  onChange={(e) => setSelectedTrainerId(e.target.value)}
                  options={[
                    { value: "", label: "-- اختر المدرب --" },
                    ...trainers.map((tr) => ({
                      value: tr.id,
                      label: `كابتن / ${tr.fullName}`,
                    })),
                  ]}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  اختيار باقة جاهزة (اختياري)
                </label>
                <Select
                  value={selectedPackageId}
                  onChange={(e) => handlePackageSelect(e.target.value)}
                  options={[
                    { value: "", label: "-- تخصيص يدوي حر --" },
                    ...packages.map((pkg) => ({
                      value: pkg.id,
                      label: `${pkg.name} (${pkg.sessions_count} حصة - ${formatMinor(pkg.price_minor)})`,
                    })),
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  عدد الحصص *
                </label>
                <Input
                  type="number"
                  min="1"
                  value={totalSessions}
                  onChange={(e) => setTotalSessions(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  السعر الإجمالي (ج.م) *
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={priceMajor}
                  onChange={(e) => {
                    setPriceMajor(e.target.value);
                    setPaidMajor(e.target.value);
                  }}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  المبلغ المدفوع (ج.م) *
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={paidMajor}
                  onChange={(e) => setPaidMajor(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  طريقة الدفع *
                </label>
                <Select
                  value={methodCode}
                  onChange={(e) => setMethodCode(e.target.value)}
                  options={[
                    { value: "cash", label: "نقدي (كاش)" },
                    { value: "instapay", label: "انستاباي (InstaPay)" },
                    { value: "wallet", label: "محفظة إلكترونية (فودافون كاش)" },
                    { value: "card", label: "فيزا / بطاقة بنكية" },
                  ]}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  تاريخ البداية *
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  تاريخ الانتهاء *
                </label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">
                ملاحظات أو هدف المتدرب
              </label>
              <Input
                value={subNotes}
                onChange={(e) => setSubNotes(e.target.value)}
                placeholder="خطة التدريب، التغذية، القياسات..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNewSubModalOpen(false)}
                disabled={savingSub}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                disabled={savingSub}
              >
                {savingSub ? "جارٍ الحفظ..." : "تأكيد الاشتراك والدفع"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* New Package Modal */}
      {newPkgModalOpen && (
        <Modal
          open={newPkgModalOpen}
          onClose={() => setNewPkgModalOpen(false)}
          title="إنشاء باقة تدريب خاص جديدة"
        >
          <form onSubmit={handleSavePkg} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">اسم الباقة *</label>
              <Input
                value={pkgName}
                onChange={(e) => setPkgName(e.target.value)}
                placeholder="مثال: باقة برايفت ذهبية (16 حصة)"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">عدد الحصص *</label>
                <Input
                  type="number"
                  min="1"
                  value={pkgSessions}
                  onChange={(e) => setPkgSessions(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted block mb-1">السعر (ج.م) *</label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={pkgPriceMajor}
                  onChange={(e) => setPkgPriceMajor(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">مدة الصلاحية (أيام) *</label>
                <Input
                  type="number"
                  min="1"
                  value={pkgDurationDays}
                  onChange={(e) => setPkgDurationDays(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted block mb-1">نسبة عمولة المدرب (%)</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={pkgCommissionPercent}
                  onChange={(e) => setPkgCommissionPercent(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNewPkgModalOpen(false)}
                disabled={savingPkg}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                disabled={savingPkg}
              >
                {savingPkg ? "جارٍ الحفظ..." : "حفظ الباقة"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Record Session Modal */}
      {recordTarget && (
        <Modal
          open={!!recordTarget}
          onClose={() => setRecordTarget(null)}
          title={`تسجيل حضور حصة تدريب خاص (${recordTarget.member_name})`}
        >
          <form onSubmit={handleRecordSessionSubmit} className="space-y-4">
            <div className="p-3 bg-surface-2 rounded-lg border border-line space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">المتدرب:</span>
                <span className="font-semibold text-main">{recordTarget.member_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">المدرب:</span>
                <span className="text-amber-400 font-medium">كابتن / {recordTarget.trainer_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">رصيد الحصص:</span>
                <span className="font-mono">
                  تم تنفيذ {recordTarget.completed_sessions} من {recordTarget.total_sessions} (متبقي {recordTarget.total_sessions - recordTarget.completed_sessions} حصة)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">تاريخ الحصة *</label>
                <Input
                  type="date"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted block mb-1">وقت الحصة *</label>
                <Input
                  type="time"
                  value={sessionTime}
                  onChange={(e) => setSessionTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">
                ملاحظات الحصة (التمارين / التطور)
              </label>
              <Input
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="أوزان جديدة، تمرين أرجل، تقييم الأداء..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRecordTarget(null)}
                disabled={recording}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                disabled={recording}
              >
                {recording ? "جارٍ التسجيل..." : "تأكيد خصم الحصة"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* History Modal */}
      {viewHistoryTarget && (
        <Modal
          open={!!viewHistoryTarget}
          onClose={() => setViewHistoryTarget(null)}
          title={`سجل الحصص المنفذة — ${viewHistoryTarget.member_name}`}
        >
          <div className="space-y-4">
            <div className="text-sm text-muted">
              المدرب المسؤول: <span className="text-main font-medium">كابتن / {viewHistoryTarget.trainer_name}</span> | المنفذ: <span className="text-main font-mono">{viewHistoryTarget.completed_sessions}</span> من <span className="text-main font-mono">{viewHistoryTarget.total_sessions}</span> حصة
            </div>

            {viewHistoryTarget.sessions && viewHistoryTarget.sessions.length > 0 ? (
              <div className="divide-y divide-line border border-line rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                {viewHistoryTarget.sessions.map((s, idx) => (
                  <div key={s.id} className="p-3 bg-surface-1 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-main block mb-0.5">
                        حصة #{viewHistoryTarget.sessions!.length - idx}
                      </span>
                      {s.notes && <span className="text-muted block">{s.notes}</span>}
                    </div>
                    <div className="text-right font-mono text-muted">
                      <div>{s.session_date}</div>
                      <div>{formatTime(s.session_time)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-muted text-sm">
                لم يتم تسجيل أي حصص منفذة لهذا الاشتراك بعد.
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="ghost" onClick={() => setViewHistoryTarget(null)}>
                إغلاق
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
export default PrivateTrainingPage;
