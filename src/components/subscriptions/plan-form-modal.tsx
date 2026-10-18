import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type Plan, type PlanCategory, type PlanKind, type ClassScheduleSlot } from "@/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dumbbell, Trophy } from "lucide-react";

interface PlanFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  plan?: Partial<Plan> | null;
  defaultCategory?: PlanCategory;
}

const DOW_NAMES_MAP: Record<number, string> = {
  6: "السبت",
  0: "الأحد",
  1: "الإثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
};
const DAY_KEYS = [6, 0, 1, 2, 3, 4, 5];

export function PlanFormModal({ open, onClose, onSaved, plan, defaultCategory = "gym" }: PlanFormModalProps) {
  const t = useT();
  const actor = useAuth().actor;
  const { toast } = useToast();
  const [category, setCategory] = useState<PlanCategory>("gym");
  const [name, setName] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [price, setPrice] = useState("");
  const [kind, setKind] = useState<PlanKind>("time");
  const [sessionsCount, setSessionsCount] = useState("");
  const [description, setDescription] = useState("");
  const [invitationsCount, setInvitationsCount] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Academy-specific fields
  const [trainersList, setTrainersList] = useState<Array<{ id: string; fullName: string }>>([]);
  const [trainerId, setTrainerId] = useState("");
  const [capacity, setCapacity] = useState("15");
  const [scheduleSlots, setScheduleSlots] = useState<ClassScheduleSlot[]>([]);
  const [uniformStart, setUniformStart] = useState("18:00");
  const [uniformEnd, setUniformEnd] = useState("19:00");

  useEffect(() => {
    if (!open) return;
    api.trainers
      .list({ activeOnly: true })
      .then((res) => setTrainersList(res.map((tr) => ({ id: tr.id, fullName: tr.fullName }))))
      .catch(console.error);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const cat = plan?.category ?? defaultCategory;
    setCategory(cat);
    setName(plan?.name ?? "");
    setDurationDays(plan ? String(plan.durationDays) : "30");
    setPrice(plan ? String(plan.price) : "");
    setKind(plan?.kind ?? (cat === "academy" ? "sessions" : "time"));
    setSessionsCount(plan?.sessionsCount != null ? String(plan.sessionsCount) : (cat === "academy" ? "8" : ""));
    setDescription(plan?.description ?? "");
    setInvitationsCount(plan?.invitationsCount != null ? String(plan.invitationsCount) : "0");
    setIsActive(plan?.isActive ?? true);
    setTrainerId(plan?.trainerId ?? "");
    setCapacity(plan?.capacity != null ? String(plan.capacity) : "15");
    setScheduleSlots(
      plan?.scheduleSlots && plan.scheduleSlots.length > 0
        ? plan.scheduleSlots
        : [
            { dayOfWeek: 6, startTime: "18:00", endTime: "19:00" },
            { dayOfWeek: 1, startTime: "18:00", endTime: "19:00" },
            { dayOfWeek: 3, startTime: "18:00", endTime: "19:00" },
          ],
    );
    setError(null);
  }, [open, plan, defaultCategory]);

  const toggleDaySlot = (day: number) => {
    setScheduleSlots((prev) => {
      const exists = prev.some((s) => s.dayOfWeek === day);
      if (exists) {
        return prev.filter((s) => s.dayOfWeek !== day);
      }
      return [...prev, { dayOfWeek: day, startTime: uniformStart, endTime: uniformEnd }].sort(
        (a, b) => a.dayOfWeek - b.dayOfWeek,
      );
    });
  };

  const updateSlotTime = (day: number, field: "startTime" | "endTime", val: string) => {
    setScheduleSlots((prev) =>
      prev.map((s) => (s.dayOfWeek === day ? { ...s, [field]: val } : s)),
    );
  };

  const applyUniformTime = () => {
    setScheduleSlots((prev) =>
      prev.map((s) => ({ ...s, startTime: uniformStart, endTime: uniformEnd })),
    );
    toast("info", "تم تطبيق التوقيت الموحد على جميع الأيام المحددة");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      const invCount = Number(invitationsCount) || 0;
      const sCount = kind === "sessions" && sessionsCount ? Number(sessionsCount) : null;
      const isAcademy = category === "academy";
      const capNum = isAcademy && capacity ? Number(capacity) : undefined;
      const finalSlots = isAcademy ? scheduleSlots : undefined;
      const finalTrainerId = isAcademy ? (trainerId || null) : null;

      if (plan?.id) {
        await api.plans.update(plan.id, {
          name,
          category,
          kind,
          sessionsCount: sCount,
          durationDays: Number(durationDays),
          price: Number(price),
          description: description.trim() || null,
          invitationsCount: invCount,
          trainerId: finalTrainerId,
          capacity: capNum,
          scheduleSlots: finalSlots,
        });
      } else {
        await api.plans.create({
          name,
          category,
          kind,
          sessionsCount: sCount,
          durationDays: Number(durationDays),
          price: Number(price),
          description: description.trim() || null,
          invitationsCount: invCount,
          trainerId: finalTrainerId,
          capacity: capNum,
          scheduleSlots: finalSlots,
        });
      }
      toast("success", t("toast.saved"));
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
      title={plan?.id ? t("plans.editPlan") : t("plans.addPlan")}
      widthClass="max-w-2xl sm:max-w-3xl"
      footer={
        <>
          <Button type="submit" form="plan-form" loading={submitting} disabled={submitting}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {/* تصنيف الباقة ونظام الاستهلاك في شريط علوي أنيق */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-2xl border border-line bg-surface/50">
          {/* تصنيف الباقة: جيم وصالة أم أكاديمية وحصص */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-subtle">تصنيف ونوع الباقة</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCategory("gym")}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  category === "gym"
                    ? "bg-primary/20 border-primary text-white shadow-glow-sm"
                    : "bg-raised border-line text-subtle hover:text-ink hover:border-line-strong"
                }`}
              >
                <Dumbbell className="size-4 text-cyan" />
                <span>جيم وصالة (Gym)</span>
              </button>
              <button
                type="button"
                onClick={() => setCategory("academy")}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  category === "academy"
                    ? "bg-amber-500/20 border-amber-500 text-white shadow-glow-sm"
                    : "bg-raised border-line text-subtle hover:text-ink hover:border-line-strong"
                }`}
              >
                <Trophy className="size-4 text-amber-400" />
                <span>أكاديمية وحصص</span>
              </button>
            </div>
          </div>

          {/* نوع الاستهلاك: مدة زمنية أم عدد حصص */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-subtle">نظام استهلاك الباقة</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("time")}
                className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  kind === "time"
                    ? "bg-primary/20 border-primary text-white shadow-glow-sm"
                    : "bg-raised border-line text-subtle hover:text-ink hover:border-line-strong"
                }`}
              >
                <span>📅 مدة زمنية</span>
              </button>
              <button
                type="button"
                onClick={() => setKind("sessions")}
                className={`flex items-center justify-center gap-1.5 p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                  kind === "sessions"
                    ? "bg-primary/20 border-primary text-white shadow-glow-sm"
                    : "bg-raised border-line text-subtle hover:text-ink hover:border-line-strong"
                }`}
              >
                <span>🎟️ رصيد حصص</span>
              </button>
            </div>
          </div>
        </div>

        {/* البيانات الأساسية للباقة */}
        <div className="p-3.5 rounded-2xl border border-line bg-surface/30 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label={t("plans.name")}
                placeholder={t("plans.namePh")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>

            <Input
              label={t("plans.price")}
              type="number"
              min={0}
              step="any"
              dir="ltr"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={submitting}
              placeholder="مثال: 500"
            />

            <Input
              label={t("plans.durationDays")}
              type="number"
              min={1}
              dir="ltr"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              disabled={submitting}
              placeholder="30"
            />

            {kind === "sessions" && (
              <Input
                label="عدد الحصص المتاحة في الباقة"
                type="number"
                min={1}
                dir="ltr"
                placeholder="مثال: 8 أو 12"
                value={sessionsCount}
                onChange={(e) => setSessionsCount(e.target.value)}
                disabled={submitting}
                required
              />
            )}

            <Input
              label="عدد دعوات الضيوف المجانية (Invitations)"
              type="number"
              min={0}
              dir="ltr"
              value={invitationsCount}
              onChange={(e) => setInvitationsCount(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        {/* إعدادات ومواعيد الأكاديمية عند اختيار تصنيف Academy */}
        {category === "academy" && (
          <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-4 space-y-3.5 shadow-sm">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
              <div className="flex items-center gap-2 text-xs font-black text-amber-400">
                <Trophy className="size-4" />
                <span>إعدادات وجدول مواعيد الأكاديمية</span>
              </div>
              <span className="text-[11px] text-subtle">يتم توليد الحصص في الجدول الأسبوعي تلقائياً</span>
            </div>

            {/* اختيار المدرب المسئول والسعة جنبًا إلى جنب */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-subtle">المدرب المسؤول عن الأكاديمية</label>
                <Select
                  value={trainerId}
                  onChange={(e) => setTrainerId(e.target.value)}
                  disabled={submitting}
                  options={[
                    { value: "", label: "— بدون مدرب محدد حالياً —" },
                    ...trainersList.map((tr) => ({
                      value: tr.id,
                      label: tr.fullName,
                    })),
                  ]}
                />
              </div>

              <Input
                label="سعة الحصة (الحد الأقصى للمتدربين)"
                type="number"
                min={1}
                dir="ltr"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                disabled={submitting}
                placeholder="15"
              />
            </div>

            {/* التوقيت الموحد للأيام المحددة */}
            <div className="p-2.5 rounded-xl border border-amber-500/20 bg-panel/60 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-amber-300">تطبيق توقيت موحد على كافة الأيام المحددة:</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-subtle">من</span>
                    <Input
                      type="time"
                      dir="ltr"
                      value={uniformStart}
                      onChange={(e) => setUniformStart(e.target.value)}
                      disabled={submitting}
                      className="text-xs w-28 h-8"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-subtle">إلى</span>
                    <Input
                      type="time"
                      dir="ltr"
                      value={uniformEnd}
                      onChange={(e) => setUniformEnd(e.target.value)}
                      disabled={submitting}
                      className="text-xs w-28 h-8"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={applyUniformTime}
                    className="text-xs font-bold h-8 px-3 border border-amber-500/40 text-amber-300 hover:bg-amber-500/20"
                  >
                    تطبيق
                  </Button>
                </div>
              </div>
            </div>

            {/* أيام التدريب الأسبوعية بشبكة متناسقة وواسعة */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-subtle">أيام ومواعيد الحصص في الأسبوع</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {DAY_KEYS.map((day) => {
                  const slot = scheduleSlots.find((s) => s.dayOfWeek === day);
                  const isSelected = !!slot;
                  return (
                    <div
                      key={day}
                      className={`p-3 rounded-xl border transition-all text-xs flex flex-col justify-between ${
                        isSelected
                          ? "bg-amber-500/15 border-amber-500/60 text-white shadow-sm"
                          : "bg-surface border-line text-subtle hover:border-line-strong"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleDaySlot(day)}
                        className="w-full flex items-center justify-between font-bold cursor-pointer pb-1"
                      >
                        <span className="text-sm">{DOW_NAMES_MAP[day]}</span>
                        <span
                          className={`size-4 rounded-md grid place-items-center text-xs font-black ${
                            isSelected ? "bg-amber-400 text-black" : "border border-line"
                          }`}
                        >
                          {isSelected && "✓"}
                        </span>
                      </button>
                      {isSelected ? (
                        <div className="mt-2 space-y-1.5 pt-2 border-t border-amber-500/30">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] text-amber-300 font-bold">من:</span>
                            <input
                              type="time"
                              value={slot.startTime}
                              onChange={(e) => updateSlotTime(day, "startTime", e.target.value)}
                              className="w-24 bg-raised rounded px-1.5 py-0.5 text-xs dir-ltr text-center border border-amber-500/40 text-white"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] text-amber-300 font-bold">إلى:</span>
                            <input
                              type="time"
                              value={slot.endTime || ""}
                              onChange={(e) => updateSlotTime(day, "endTime", e.target.value)}
                              className="w-24 bg-raised rounded px-1.5 py-0.5 text-xs dir-ltr text-center border border-amber-500/40 text-white"
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-faint mt-2">غير محدد</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="p-3.5 rounded-2xl border border-line bg-surface/30 space-y-3">
          <Input
            label={`${t("common.notes")} (${t("common.optional")})`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            placeholder="ملاحظات توضيحية حول شروط أو مميزات الباقة..."
          />
          {plan && <Checkbox checked={isActive} onCheckedChange={setIsActive}>{t("plans.active")}</Checkbox>}
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
