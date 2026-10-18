import { useCallback, useEffect, useState } from "react";
import {
  Award,
  FileSpreadsheet,
  Medal,
  MessageCircle,
  Plus,
  Printer,
  Trophy,
  User,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type MemberBeltGradingWithMember,
  type PublicMember,
} from "@/api";
import { todayKey } from "@/core/dates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { buildWhatsAppDirectUrl } from "@/core/whatsapp";
import { downloadCsvWithBom } from "@/utils/csv-helper";

const STANDARD_BELTS: Record<string, Array<{ name: string; color: string }>> = {
  karate: [
    { name: "حزام أبيض (White Belt)", color: "#E2E8F0" },
    { name: "حزام أصفر (Yellow Belt)", color: "#FACC15" },
    { name: "حزام برتقالي (Orange Belt)", color: "#FB923C" },
    { name: "حزام أخضر (Green Belt)", color: "#22C55E" },
    { name: "حزام أزرق (Blue Belt)", color: "#3B82F6" },
    { name: "حزام بني (Brown Belt)", color: "#92400E" },
    { name: "حزام أسود (Black Belt 1st Dan)", color: "#18181B" },
    { name: "حزام أسود دان 2 (Black Belt 2nd Dan)", color: "#18181B" },
  ],
  taekwondo: [
    { name: "حزام أبيض (White)", color: "#E2E8F0" },
    { name: "حزام أصفر (Yellow)", color: "#FACC15" },
    { name: "حزام أخضر (Green)", color: "#22C55E" },
    { name: "حزام أزرق (Blue)", color: "#3B82F6" },
    { name: "حزام أحمر (Red)", color: "#EF4444" },
    { name: "حزام بوم للأطفال (Poom Red/Black)", color: "#DC2626" },
    { name: "حزام أسود (Black Belt 1st Dan)", color: "#18181B" },
  ],
  judo: [
    { name: "حزام أبيض (6th Kyu)", color: "#E2E8F0" },
    { name: "حزام أصفر (5th Kyu)", color: "#FACC15" },
    { name: "حزام برتقالي (4th Kyu)", color: "#FB923C" },
    { name: "حزام أخضر (3rd Kyu)", color: "#22C55E" },
    { name: "حزام أزرق (2nd Kyu)", color: "#3B82F6" },
    { name: "حزام بني (1st Kyu)", color: "#92400E" },
    { name: "حزام أسود (Shodan 1st Dan)", color: "#18181B" },
  ],
  kickboxing: [
    { name: "مستوى مبتدئ (Beginner Level)", color: "#E2E8F0" },
    { name: "مستوى متقدم (Advanced Level)", color: "#3B82F6" },
    { name: "مقاتل واعد (Fighter Level)", color: "#EF4444" },
    { name: "مستوى احترافي (Pro Level)", color: "#18181B" },
  ],
  general: [
    { name: "حزام أبيض", color: "#E2E8F0" },
    { name: "حزام أصفر", color: "#FACC15" },
    { name: "حزام أخضر", color: "#22C55E" },
    { name: "حزام أزرق", color: "#3B82F6" },
    { name: "حزام بني", color: "#92400E" },
    { name: "حزام أسود", color: "#18181B" },
  ],
};

const DISCIPLINES_OPTIONS = [
  { value: "", label: "جميع الرياضات القتالية" },
  { value: "karate", label: "🥋 كاراتيه (Karate)" },
  { value: "taekwondo", label: "🥋 تايكوندو (Taekwondo)" },
  { value: "judo", label: "🥋 جودو (Judo)" },
  { value: "kickboxing", label: "🥊 كيك بوكسينج (Kickboxing)" },
  { value: "boxing", label: "🥊 ملاكمة (Boxing)" },
  { value: "kung_fu", label: "🐉 كونغ فو (Kung Fu)" },
  { value: "bjj", label: "🥋 جوجيتسو (BJJ)" },
  { value: "general", label: "🏆 عام / أنشطة أخرى" },
];

export function BeltsTab() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("classes.manage");

  const [items, setItems] = useState<MemberBeltGradingWithMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterDiscipline, setFilterDiscipline] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState(todayKey());

  // Modal states
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [certModalItem, setCertModalItem] = useState<MemberBeltGradingWithMember | null>(null);

  // Form states for adding grading
  const [memberSearch, setMemberSearch] = useState("");
  const [matchedMembers, setMatchedMembers] = useState<PublicMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<PublicMember | null>(null);
  const [formDiscipline, setFormDiscipline] = useState("karate");
  const [formBeltName, setFormBeltName] = useState("");
  const [formBeltColor, setFormBeltColor] = useState("#FACC15");
  const [formDate, setFormDate] = useState(todayKey());
  const [formExaminer, setFormExaminer] = useState("");
  const [formScore, setFormScore] = useState("ممتاز (A+)");
  const [formCertNo, setFormCertNo] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(() => {
    if (!actor) return;
    setLoading(true);
    api.beltGradings
      .listAll({
        discipline: filterDiscipline || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        search: search.trim() || undefined,
      })
      .then(setItems)
      .catch((err) => toast("error", describeError(err, t)))
      .finally(() => setLoading(false));
  }, [actor, filterDiscipline, fromDate, toDate, search, t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Search members when adding grading
  useEffect(() => {
    if (!memberSearch.trim()) {
      setMatchedMembers([]);
      return;
    }
    const timer = setTimeout(() => {
      api.members
        .list({ search: memberSearch.trim(), pageSize: 5 })
        .then((res) => setMatchedMembers(res.items))
        .catch(console.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [memberSearch]);

  const handleCreateGrading = async () => {
    if (!selectedMember) {
      toast("error", "يرجى اختيار العضو أو البطل المراد ترقيته");
      return;
    }
    if (!formBeltName.trim()) {
      toast("error", "يرجى تحديد الحزام أو الدرجة الممنوحة");
      return;
    }
    setSubmitting(true);
    try {
      await api.beltGradings.record({
        memberId: selectedMember.id,
        discipline: formDiscipline,
        beltName: formBeltName.trim(),
        beltColor: formBeltColor,
        gradingDate: formDate,
        examinerName: formExaminer.trim() || undefined,
        scoreOrGrade: formScore.trim() || undefined,
        certificateNo: formCertNo.trim() || undefined,
        notes: formNotes.trim() || undefined,
      });
      toast("success", `تم تسجيل ترقية الحزام للبطل ${selectedMember.fullName} بنجاح 🥋`);
      setAddModalOpen(false);
      setSelectedMember(null);
      setMemberSearch("");
      setFormBeltName("");
      loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, memberName: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف سجل ترقية الحزام للعضو (${memberName})؟`)) return;
    try {
      await api.beltGradings.delete(id);
      toast("success", "تم حذف السجل بنجاح");
      loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const handleExportCsv = () => {
    if (items.length === 0) return;
    const headers = [
      "رقم الشهادة",
      "اسم المشترك",
      "كود العضوية",
      "الرياضة",
      "الحزام الممنوح",
      "تاريخ الاختبار",
      "اسم الفاحص / الكابتن",
      "التقدير",
      "هاتف ولي الأمر / المشترك",
      "ملاحظات",
    ];
    const rows = items.map((i) => [
      i.certificateNo || "",
      i.memberName,
      i.memberCode,
      i.discipline,
      i.beltName,
      i.gradingDate,
      i.examinerName || "",
      i.scoreOrGrade || "",
      i.emergencyContactPhone || i.memberPhone || "",
      i.notes || "",
    ]);
    downloadCsvWithBom(`سجل_ترقيات_الأحزمة_${todayKey()}.csv`, headers, rows);
    toast("success", "تم تصدير سجل الترقيات إلى Excel بنجاح");
  };

  const buildBeltWhatsAppMessage = (item: MemberBeltGradingWithMember) => {
    const phone = item.emergencyContactPhone || item.memberPhone;
    if (!phone) return null;
    const msg = `🥋 *تهنئة باجتياز اختبار ترقية الحزام - جيم جيت*

ألف مبروك لبطلنا المتميز: *${item.memberName}* 👏
يسعدنا إبلاغكم باجتياز اختبار الترقية بنجاح والحصول على:
🏅 *${item.beltName}*
• الرياضة: *${item.discipline.toUpperCase()}*
• التاريخ: ${item.gradingDate}
• التقدير: *${item.scoreOrGrade || "ناجح بتفوق"}*
• رقم الشهادة المعتمدة: ${item.certificateNo || "—"}

فخورون جداً بالتطور المستمر لبطلنا ونتمنى له دوام التفوق وحصد البطولات! 🏆🥇`;
    return buildWhatsAppDirectUrl(phone, msg);
  };

  return (
    <div className="space-y-4">
      {/* Top Controls & Search Bar */}
      <div className="rounded-2xl border border-white/5 bg-panel/80 p-4 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1 max-w-md">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="بحث باسم المشترك، كود العضوية، الحزام، أو رقم الشهادة..."
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="w-44 text-xs"
              value={filterDiscipline}
              onChange={(e) => setFilterDiscipline(e.target.value)}
              options={DISCIPLINES_OPTIONS}
            />

            <Input
              type="date"
              className="w-36 text-xs"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              placeholder="من تاريخ"
            />

            <Input
              type="date"
              className="w-36 text-xs"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              placeholder="إلى تاريخ"
            />

            <Button variant="secondary" size="sm" onClick={handleExportCsv} className="gap-1.5 text-xs">
              <FileSpreadsheet className="size-3.5 text-emerald-400" />
              <span>تصدير Excel</span>
            </Button>

            {canManage && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAddModalOpen(true)}
                className="gap-1.5 text-xs font-bold"
              >
                <Plus className="size-4" />
                <span>تسجيل ترقية حزام جديدة</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Gradings List / Table */}
      {loading ? (
        <p className="py-12 text-center text-xs text-subtle">جاري تحميل سجل ترقيات الأحزمة...</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Award className="size-8 text-faint" />}
          title="لا توجد سجلات ترقية أحزمة حتى الآن"
          description="يمكنك توثيق نتائج اختبارات الأحزمة، إصدار الشهادات، وإرسال التهنئة لأولياء الأمور عبر واتساب."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const waUrl = buildBeltWhatsAppMessage(item);

            return (
              <div
                key={item.id}
                className="rounded-2xl border border-white/5 bg-panel p-4 flex flex-col justify-between gap-3 hover:border-neon/20 transition-all shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="size-4 rounded-full border border-white/20 shrink-0 shadow-sm"
                        style={{ backgroundColor: item.beltColor }}
                        title={item.beltName}
                      />
                      <div>
                        <h4 className="font-extrabold text-sm text-foreground">{item.memberName}</h4>
                        <p className="text-[11px] text-cyan-400 font-mono font-semibold" dir="ltr">
                          {item.memberCode}
                        </p>
                      </div>
                    </div>

                    <Badge variant="neutral" className="text-[10px] uppercase font-bold tracking-wider">
                      {item.discipline}
                    </Badge>
                  </div>

                  <div className="mt-3 rounded-xl border border-white/5 bg-surface/50 p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-subtle font-medium">الحزام الممنوح:</span>
                      <span className="font-bold text-foreground">{item.beltName}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-subtle font-medium">تاريخ الاختبار:</span>
                      <span className="font-mono text-faint">{item.gradingDate}</span>
                    </div>
                    {item.scoreOrGrade && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-subtle font-medium">التقدير:</span>
                        <span className="font-bold text-emerald-400">{item.scoreOrGrade}</span>
                      </div>
                    )}
                    {item.certificateNo && (
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
                        <span className="text-subtle font-medium">رقم الشهادة:</span>
                        <span className="font-mono text-[11px] text-amber-400">{item.certificateNo}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setCertModalItem(item)}
                    className="gap-1.5 text-xs flex-1 h-8"
                  >
                    <Trophy className="size-3.5 text-amber-400" />
                    <span>عرض الشهادة</span>
                  </Button>

                  {waUrl && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="grid size-8 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      title="إرسال تهنئة بالشهادة على واتساب"
                    >
                      <MessageCircle className="size-4" />
                    </a>
                  )}

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id, item.memberName)}
                      className="grid size-8 place-items-center rounded-lg text-faint hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="حذف السجل"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Grading Modal */}
      {addModalOpen && (
        <Modal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          title="توثيق ترقية حزام واختبار مستوى جديد"
          widthClass="max-w-xl"
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setAddModalOpen(false)} disabled={submitting}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateGrading}
                loading={submitting}
                disabled={submitting || !selectedMember}
                className="font-bold gap-1.5"
              >
                <Award className="size-4" />
                <span>حفظ الترقية وإصدار الشهادة</span>
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Member Selection */}
            <div>
              <label className="block text-xs font-bold text-foreground mb-1">المشترك / البطل</label>
              {selectedMember ? (
                <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-emerald-400" />
                    <div>
                      <span className="font-extrabold text-sm text-foreground">{selectedMember.fullName}</span>
                      <span className="text-xs text-subtle block font-mono">
                        {selectedMember.memberCode} · هاتف: {selectedMember.phone || "—"}
                      </span>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setSelectedMember(null)}>
                    تغيير
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="ابحث باسم المشترك، كود العضوية، أو الهاتف..."
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    autoFocus
                  />
                  {matchedMembers.length > 0 && (
                    <div className="divide-y divide-line rounded-xl border border-line bg-surface max-h-40 overflow-y-auto">
                      {matchedMembers.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedMember(m);
                            setMemberSearch("");
                            setMatchedMembers([]);
                          }}
                          className="flex w-full items-center justify-between p-2.5 text-xs hover:bg-white/5 transition-colors text-start"
                        >
                          <span className="font-bold text-foreground">{m.fullName}</span>
                          <span className="font-mono text-cyan-400">{m.memberCode}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-subtle mb-1">الرياضة القتالية</label>
                <select
                  value={formDiscipline}
                  onChange={(e) => {
                    const d = e.target.value;
                    setFormDiscipline(d);
                    const firstBelt = STANDARD_BELTS[d]?.[0] || STANDARD_BELTS.general[0];
                    if (firstBelt) {
                      setFormBeltName(firstBelt.name);
                      setFormBeltColor(firstBelt.color);
                    }
                  }}
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs text-foreground focus:border-neon focus:outline-none"
                >
                  <option value="karate">كاراتيه (Karate)</option>
                  <option value="taekwondo">تايكوندو (Taekwondo)</option>
                  <option value="judo">جودو (Judo)</option>
                  <option value="kickboxing">كيك بوكسينج (Kickboxing)</option>
                  <option value="boxing">ملاكمة (Boxing)</option>
                  <option value="kung_fu">كونغ فو (Kung Fu)</option>
                  <option value="bjj">جوجيتسو (BJJ)</option>
                  <option value="general">أخرى / عام</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-subtle mb-1">تاريخ الاختبار</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs text-foreground focus:border-neon focus:outline-none"
                />
              </div>
            </div>

            {/* Quick Belt Ranks Selector */}
            <div>
              <label className="block text-xs font-medium text-subtle mb-1.5">الحزام / الدرجة المقررة</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(STANDARD_BELTS[formDiscipline] || STANDARD_BELTS.general).map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    onClick={() => {
                      setFormBeltName(b.name);
                      setFormBeltColor(b.color);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
                      formBeltName === b.name
                        ? "border-neon bg-neon/15 text-neon"
                        : "border-white/10 bg-surface text-subtle hover:text-foreground"
                    }`}
                  >
                    <span className="size-2.5 rounded-full border border-white/20" style={{ backgroundColor: b.color }} />
                    <span>{b.name}</span>
                  </button>
                ))}
              </div>
              <Input
                placeholder="أو اكتب اسم الحزام يدوياً..."
                value={formBeltName}
                onChange={(e) => setFormBeltName(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="اسم الفاحص / رئيس لجنة الاختبار"
                placeholder="مثال: كابتن أحمد فتحي - حزام أسود دان 5"
                value={formExaminer}
                onChange={(e) => setFormExaminer(e.target.value)}
              />
              <Input
                label="التقدير / النتيجة"
                placeholder="مثال: ممتاز (A+)، 94%"
                value={formScore}
                onChange={(e) => setFormScore(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="رقم الشهادة (اتركه فارغاً للتوليد التلقائي)"
                placeholder="CERT-2026-0001"
                value={formCertNo}
                onChange={(e) => setFormCertNo(e.target.value)}
              />
              <Input
                label="ملاحظات إضافية"
                placeholder="ملاحظات على الأداء الفني والكاتا/القتال..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Belt Promotion Certificate Print Modal */}
      {certModalItem && (
        <Modal
          open={certModalItem !== null}
          onClose={() => setCertModalItem(null)}
          title="شهادة ترقية واجتياز مستوى معتمدة"
          widthClass="max-w-3xl"
          footer={
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-subtle">
                شهادة رسمية صادرة من الأكاديمية برقم: <strong className="text-foreground">{certModalItem.certificateNo}</strong>
              </span>
              <div className="flex items-center gap-2">
                <Button variant="primary" onClick={() => window.print()} className="gap-1.5 font-bold">
                  <Printer className="size-4" />
                  <span>طباعة الشهادة الرسمية</span>
                </Button>
                <Button variant="secondary" onClick={() => setCertModalItem(null)}>
                  {t("common.close")}
                </Button>
              </div>
            </div>
          }
        >
          {/* Printable Certificate Frame */}
          <div className="relative rounded-3xl border-4 border-amber-500/40 bg-gradient-to-br from-panel via-surface to-panel p-8 text-center shadow-2xl space-y-6 overflow-hidden">
            {/* Background Insignia Watermark */}
            <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none">
              <Award className="size-96 text-amber-400" />
            </div>

            <div className="relative space-y-2">
              <div className="flex items-center justify-center gap-2 text-amber-400 font-extrabold text-sm tracking-widest uppercase">
                <Medal className="size-5" />
                <span>أكاديمية الفنون القتالية والرياضية</span>
                <Medal className="size-5" />
              </div>
              <h2 className="text-3xl font-black text-foreground tracking-tight">شهادة ترقية واجتياز حزام معتمد</h2>
              <p className="text-xs text-subtle tracking-wider font-mono">CERTIFICATE OF BELT PROMOTION & MASTERY</p>
            </div>

            <div className="relative py-4 space-y-3">
              <p className="text-sm text-subtle">تشهد إدارة الأكاديمية بأن البطل المتميز:</p>
              <h3 className="text-2xl font-black text-neon tracking-wide underline decoration-neon/40 underline-offset-8">
                {certModalItem.memberName}
              </h3>
              <p className="text-xs text-faint font-mono">كود العضوية: {certModalItem.memberCode}</p>
              <p className="text-sm text-foreground font-medium pt-2 max-w-md mx-auto">
                قد اجتاز بنجاح وتفوق اختبارات الترقية الدورية في رياضة{" "}
                <strong className="text-cyan-400 uppercase">({certModalItem.discipline})</strong> واستحق بجدارة نيل:
              </p>
            </div>

            {/* Belt Graphic Badge */}
            <div className="relative inline-flex items-center gap-3 rounded-2xl border-2 border-white/20 bg-black/40 px-6 py-3 shadow-lg">
              <span
                className="size-5 rounded-full border-2 border-white/40 shadow-md"
                style={{ backgroundColor: certModalItem.beltColor }}
              />
              <span className="text-lg font-black text-white">{certModalItem.beltName}</span>
              {certModalItem.scoreOrGrade && (
                <Badge variant="primary" className="text-xs">
                  {certModalItem.scoreOrGrade}
                </Badge>
              )}
            </div>

            {/* Signatures & Metadata Footer */}
            <div className="relative pt-6 border-t border-white/10 grid grid-cols-3 gap-4 text-start text-xs">
              <div>
                <span className="block text-[11px] text-faint">تاريخ الاختبار:</span>
                <span className="font-mono font-bold text-foreground">{certModalItem.gradingDate}</span>
              </div>
              <div className="text-center">
                <span className="block text-[11px] text-faint">رئيس لجنة الاختبار:</span>
                <span className="font-bold text-foreground">{certModalItem.examinerName || "اللجنة الفنية للأكاديمية"}</span>
              </div>
              <div className="text-end">
                <span className="block text-[11px] text-faint">رقم الاعتماد:</span>
                <span className="font-mono font-bold text-amber-400">{certModalItem.certificateNo}</span>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function X({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
