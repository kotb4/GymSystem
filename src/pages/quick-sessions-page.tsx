import { useEffect, useState } from "react";
import { Zap, Plus, User, UserCheck, Search, Calendar, CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type QuickSessionRow, type PublicMember } from "@/api";
import { formatMinor } from "@/core/money";
import { todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";

export function QuickSessionsPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [clientType, setClientType] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>(todayKey());
  const [items, setItems] = useState<QuickSessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    totalSessionsToday: 0,
    totalRevenueTodayMinor: 0,
    memberSessionsToday: 0,
    guestSessionsToday: 0,
  });

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [trainers, setTrainers] = useState<Array<{ id: string; fullName: string }>>([]);
  const [members, setMembers] = useState<PublicMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");

  // Form fields
  const [formClientType, setFormClientType] = useState<"guest" | "member">("guest");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestGender, setGuestGender] = useState<"male" | "female">("male");
  const [sessionName, setSessionName] = useState("تذكرة يومية (Day Pass)");
  const [priceMajor, setPriceMajor] = useState("50");
  const [paidMajor, setPaidMajor] = useState("50");
  const [methodCode, setMethodCode] = useState("cash");
  const [trainerId, setTrainerId] = useState("");
  const [recordAttendance, setRecordAttendance] = useState(true);
  const [autoCreateLead, setAutoCreateLead] = useState(true);
  const [notes, setNotes] = useState("");

  const loadStats = async () => {
    try {
      const res = await api.quickSessions.getStats(dateFilter || todayKey());
      setStats(res);
    } catch {
      // ignore
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.quickSessions.list({
        startDate: dateFilter || undefined,
        endDate: dateFilter || undefined,
        clientType: clientType !== "all" ? clientType : undefined,
        search: search.trim() || undefined,
        limit: 100,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    void loadStats();
  }, [dateFilter, clientType, search]);

  useEffect(() => {
    // Load trainers when modal opens
    if (modalOpen) {
      void api.trainers.list().then((res) => {
        setTrainers(res.map((tr) => ({ id: tr.id, fullName: tr.fullName })));
      });
    }
  }, [modalOpen]);

  useEffect(() => {
    if (formClientType === "member" && memberSearch.trim().length >= 2) {
      void api.members.list({ search: memberSearch.trim(), pageSize: 10 }).then((res) => {
        setMembers(res.items);
      });
    }
  }, [memberSearch, formClientType]);

  const handleOpenCreate = () => {
    setFormClientType("guest");
    setSelectedMemberId("");
    setGuestName("");
    setGuestPhone("");
    setGuestGender("male");
    setSessionName("تذكرة يومية (Day Pass)");
    setPriceMajor("50");
    setPaidMajor("50");
    setMethodCode("cash");
    setTrainerId("");
    setRecordAttendance(true);
    setAutoCreateLead(true);
    setNotes("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const priceMinor = Math.round(parseFloat(priceMajor || "0") * 100);
      const paidAmountMinor = Math.round(parseFloat(paidMajor || "0") * 100);

      await api.quickSessions.create({
        clientType: formClientType,
        memberId: formClientType === "member" ? selectedMemberId : undefined,
        guestName: formClientType === "guest" ? guestName.trim() : undefined,
        guestPhone: formClientType === "guest" ? guestPhone.trim() : undefined,
        guestGender: formClientType === "guest" ? guestGender : undefined,
        sessionName: sessionName.trim(),
        priceMinor,
        paidAmountMinor,
        methodCode,
        trainerId: trainerId || undefined,
        recordAttendance,
        autoCreateLead: formClientType === "guest" ? autoCreateLead : undefined,
        notes: notes.trim() || undefined,
      });

      toast(
        "success",
        formClientType === "guest" && autoCreateLead
          ? "تم تسجيل الحصة السريعة وإضافة الزائر للـ CRM بنجاح ⚡"
          : "تم تسجيل الحصة السريعة بنجاح",
      );
      setModalOpen(false);
      void loadData();
      void loadStats();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const methodBadge = (code: string) => {
    switch (code) {
      case "instapay":
        return <Badge variant="info">انستاباي</Badge>;
      case "wallet":
        return <Badge variant="warning">محفظة إلكترونية</Badge>;
      case "card":
        return <Badge variant="neutral">بطاقة بنكية</Badge>;
      default:
        return <Badge variant="success">نقدي (كاش)</Badge>;
    }
  };

  const columns: Column<QuickSessionRow>[] = [
    {
      key: "time",
      header: "التوقيت",
      render: (r) => (
        <span className="text-xs font-mono text-muted">
          {r.session_time?.slice(0, 5)} {r.session_date}
        </span>
      ),
    },
    {
      key: "client",
      header: "العميل",
      render: (r) => (
        <div className="flex items-center gap-2">
          {r.client_type === "member" ? (
            <Badge variant="info" className="gap-1">
              <UserCheck className="size-3" /> عضو: {r.member_name || r.member_code}
            </Badge>
          ) : (
            <Badge variant="neutral" className="gap-1">
              <User className="size-3" /> زائر: {r.guest_name || "مجهول"}
            </Badge>
          )}
          {r.guest_phone && <span className="text-xs text-muted">({r.guest_phone})</span>}
        </div>
      ),
    },
    {
      key: "session",
      header: "الحصة / التذكرة",
      render: (r) => <span className="font-medium text-main">{r.session_name}</span>,
    },
    {
      key: "price",
      header: "المبلغ المدفوع",
      render: (r) => (
        <span className="font-semibold text-emerald-400">
          {formatMinor(r.paid_amount_minor)}
        </span>
      ),
    },
    {
      key: "method",
      header: "طريقة الدفع",
      render: (r) => methodBadge(r.method_code),
    },
    {
      key: "trainer",
      header: "المدرب",
      render: (r) => (
        <span className="text-xs text-muted">{r.trainer_name || "—"}</span>
      ),
    },
    {
      key: "attendance",
      header: "الحضور",
      render: (r) =>
        r.attendance_recorded ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="size-3" /> تم تسجيل الحضور
          </Badge>
        ) : (
          <Badge variant="neutral" className="gap-1">
            <XCircle className="size-3" /> بدون حضور
          </Badge>
        ),
    },
    {
      key: "creator",
      header: "الموظف",
      render: (r) => <span className="text-xs text-muted">{r.creator_name || "—"}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-main flex items-center gap-2">
            <Zap className="size-6 text-amber-400" />
            الحصص السريعة وتذاكر اليوم الواحد (Quick Sessions & Day Pass)
          </h1>
          <p className="text-sm text-muted mt-1">
            تسجيل دخول الحصص الحرة والتذاكر اليومية الفورية للأعضاء والزوار مع الدفع والتحصيل المباشر
          </p>
        </div>

        {hasPermission("quick_sessions.create") && (
          <Button onClick={handleOpenCreate} className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold">
            <Plus className="size-4" />
            تسجيل حصة سريعة جديدة
          </Button>
        )}
      </div>

      {/* KPI Stats Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="إجمالي تذاكر اليوم"
          value={String(stats.totalSessionsToday)}
          icon={<Zap className="size-5" />}
          accent="amber"
          subtitle="حصة تم حجزها اليوم"
        />
        <StatCard
          title="إيرادات اليوم"
          value={formatMinor(stats.totalRevenueTodayMinor)}
          icon={<Zap className="size-5" />}
          accent="emerald"
          subtitle="إجمالي النقدية المحصلة"
        />
        <StatCard
          title="حصص الأعضاء"
          value={String(stats.memberSessionsToday)}
          icon={<UserCheck className="size-5" />}
          accent="cyan"
          subtitle="أعضاء مسجلين بالنظام"
        />
        <StatCard
          title="تذاكر الزوار"
          value={String(stats.guestSessionsToday)}
          icon={<User className="size-5" />}
          accent="violet"
          subtitle="ضيوف وزوار خارجيون"
        />
      </div>

      {/* Filter and Table Card */}
      <Card>
        <CardHeader
          title="سجل الحصص السريعة"
          description={`إجمالي ${total} حصة مسجلة`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-surface-2 border border-line rounded-lg px-2 py-1">
                <Calendar className="size-4 text-muted" />
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="bg-transparent text-xs text-main outline-none"
                />
                {dateFilter && (
                  <button
                    onClick={() => setDateFilter("")}
                    className="text-xs text-muted hover:text-main px-1"
                  >
                    الكل
                  </button>
                )}
              </div>

              <Select
                value={clientType}
                onChange={(e) => setClientType(e.target.value)}
                options={[
                  { value: "all", label: "كل العملاء" },
                  { value: "guest", label: "زوار فقط" },
                  { value: "member", label: "أعضاء فقط" },
                ]}
                className="w-32 text-xs"
              />

              <div className="relative w-48">
                <Search className="size-4 absolute right-2.5 top-2.5 text-muted pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث باسم العميل أو الحصة..."
                  className="pr-8 text-xs"
                />
              </div>
            </div>
          }
        />

        {items.length === 0 && !loading ? (
          <div className="p-8">
            <EmptyState
              icon={<Zap />}
              title="لا توجد حصص سريعة"
              description="لم يتم تسجيل أي تذاكر أو حصص سريعة مطابقة للشروط المحددة"
            />
          </div>
        ) : (
          <DataTable<QuickSessionRow>
            columns={columns}
            data={items}
            rowKey={(r) => r.id}
          />
        )}
      </Card>

      {/* New Quick Session Modal */}
      {modalOpen && (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="تسجيل حصة سريعة / تذكرة يومية (Day Pass)"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Client Type Toggle */}
            <div className="flex rounded-lg border border-line p-1 bg-surface-2">
              <button
                type="button"
                onClick={() => setFormClientType("guest")}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  formClientType === "guest"
                    ? "bg-amber-500 text-black font-semibold"
                    : "text-muted hover:text-main"
                }`}
              >
                زائر خارجي (Guest)
              </button>
              <button
                type="button"
                onClick={() => setFormClientType("member")}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  formClientType === "member"
                    ? "bg-amber-500 text-black font-semibold"
                    : "text-muted hover:text-main"
                }`}
              >
                عضو مسجل (Member)
              </button>
            </div>

            {formClientType === "guest" ? (
              <div className="space-y-3 p-3 bg-surface-2 rounded-lg border border-line">
                <div>
                  <label className="text-xs font-medium text-muted block mb-1">
                    اسم الزائر *
                  </label>
                  <Input
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="مثال: أحمد محمود"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">
                      رقم الهاتف
                    </label>
                    <Input
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder="010xxxxxxxx"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted block mb-1">
                      النوع
                    </label>
                    <Select
                      value={guestGender}
                      onChange={(e) => setGuestGender(e.target.value as "male" | "female")}
                      options={[
                        { value: "male", label: "ذكر" },
                        { value: "female", label: "أنثى" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-3 bg-surface-2 rounded-lg border border-line">
                <div>
                  <label className="text-xs font-medium text-muted block mb-1">
                    ابحث عن العضو (بالاسم أو الكود أو الهاتف)
                  </label>
                  <Input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="اكتب حرفين على الأقل للبحث..."
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
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  اسم الحصة / نوع التذكرة *
                </label>
                <Input
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  placeholder="مثال: تذكرة يومية (Day Pass)"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  المدرب المسؤول (اختياري)
                </label>
                <Select
                  value={trainerId}
                  onChange={(e) => setTrainerId(e.target.value)}
                  options={[
                    { value: "", label: "بدون مدرب (حصة حرة)" },
                    ...trainers.map((tr) => ({
                      value: tr.id,
                      label: `كابتن / ${tr.fullName}`,
                    })),
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  سعر الحصة (ج.م) *
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
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="recordAttendance"
                checked={recordAttendance}
                onChange={(e) => setRecordAttendance(e.target.checked)}
                className="size-4 rounded border-line text-amber-500 focus:ring-amber-500"
              />
              <label htmlFor="recordAttendance" className="text-sm font-medium text-main cursor-pointer">
                تسجيل حضور فوري بالصالة (شاشة الاستقبال والحضور)
              </label>
            </div>

            {formClientType === "guest" && (
              <div className="flex items-center gap-2.5 rounded-xl border border-sky-500/20 bg-sky-500/10 p-2.5 text-xs text-sky-200">
                <input
                  type="checkbox"
                  id="autoCreateLeadCheck"
                  checked={autoCreateLead}
                  onChange={(e) => setAutoCreateLead(e.target.checked)}
                  className="size-4 rounded border-sky-400/40 bg-black/40 text-sky-500 focus:ring-sky-500 cursor-pointer"
                />
                <label htmlFor="autoCreateLeadCheck" className="cursor-pointer font-medium leading-relaxed">
                  إضافة الزائر تلقائياً كـ عميل محتمل (Lead) في شاشة الـ CRM للمتابعة لاحقاً 🎯
                </label>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted block mb-1">
                ملاحظات إضافية
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات حول الحصة أو التذكرة..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setModalOpen(false)}
                disabled={submitting}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                disabled={submitting}
              >
                {submitting ? "جارٍ الحفظ..." : "تسجيل وطباعة التذكرة"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
export default QuickSessionsPage;
