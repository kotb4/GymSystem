import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { CalendarDays, CalendarPlus, CalendarRange, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ClassRecurrence, type GymClass, type CombatDiscipline, type TargetCategory, type CombatLevel } from "@/api";
import { todayKey } from "@/core/dates";
import { formatDateShort } from "@/services/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RecurrenceFormModal } from "./recurrence-form-modal";

function recurrenceDaysLabel(t: (k: string) => string, days: number[]): string {
  return days
    .map((d) => t(`dow.day${d}`))
    .join("، ");
}

const DISCIPLINE_KEYS: CombatDiscipline[] = [
  "mma", "boxing", "kickboxing", "muay_thai", "karate", "taekwondo",
  "wrestling", "judo", "bjj", "kung_fu", "self_defense", "combat_fitness", "general"
];

const CATEGORY_KEYS: TargetCategory[] = ["all", "kids", "teens", "adults", "ladies"];
const LEVEL_KEYS: CombatLevel[] = ["all_levels", "beginner", "intermediate", "advanced"];

export function ClassesTab() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("classes.manage");
  const canPurge = hasPermission("classes.purge");

  const [classesList, setClassesList] = useState<GymClass[]>([]);
  const [recurrences, setRecurrences] = useState<ClassRecurrence[]>([]);
  const [filterDiscipline, setFilterDiscipline] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [classModal, setClassModal] = useState<{ open: boolean; target: GymClass | null }>({ open: false, target: null });
  const [sessionModalFor, setSessionModalFor] = useState<GymClass | null>(null);
  const [recurrenceModalFor, setRecurrenceModalFor] = useState<GymClass | null>(null);
  const [extendTarget, setExtendTarget] = useState<ClassRecurrence | null>(null);
  const [stopTarget, setStopTarget] = useState<ClassRecurrence | null>(null);
  const [deleteClassTarget, setDeleteClassTarget] = useState<GymClass | null>(null);
  const [deleteRecurrenceTarget, setDeleteRecurrenceTarget] = useState<ClassRecurrence | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!actor || !hasPermission("classes.view")) return;
    api.classes.list({
      discipline: filterDiscipline || undefined,
      category: filterCategory || undefined,
    }).then(setClassesList).catch(console.error);
    api.classes.listRecurrences({}).then(setRecurrences).catch(console.error);
  }, [actor, hasPermission, filterDiscipline, filterCategory]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-48 text-xs"
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
            className="w-44 text-xs"
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
        </div>
        {canManage && (
          <Button onClick={() => setClassModal({ open: true, target: null })}>
            <CalendarPlus className="size-4" />
            {t("cls.newClass")}
          </Button>
        )}
      </div>

      <div className="grid gap-3 p-1 sm:grid-cols-2 xl:grid-cols-3">
        {classesList.map((c) => {
          const recs = recurrences.filter((r) => r.classId === c.id);
          return (
            <div key={c.id} className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-extrabold text-base">{c.name}</p>
                  <Badge variant="warning" className="text-[11px] font-semibold">
                    {t(`cls.disciplines.${c.discipline || "general"}`)}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-faint">{c.trainerName ?? "—"} · {c.location ?? "—"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                <Badge variant={c.consumesSession ? "info" : "neutral"}>
                  {c.consumesSession ? t("cls.consumesSession") : t("common.all")}
                </Badge>
                {c.category && c.category !== "all" && (
                  <Badge variant="primary" className="text-[11px]">
                    {t(`cls.categories.${c.category}`)}
                  </Badge>
                )}
                {c.level && c.level !== "all_levels" && (
                  <Badge variant="neutral" className="text-[11px]">
                    {t(`cls.levels.${c.level}`)}
                  </Badge>
                )}
                <span className="tabnum text-subtle ms-auto text-xs font-semibold">
                  {t("cls.capacity")}: {c.capacity}
                </span>
              </div>
              {recs.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-line bg-black/20 px-3 py-2.5">
                  {recs.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                      <span className="flex items-center gap-1.5 text-subtle">
                        <CalendarRange className="size-3.5 text-neon" />
                        <span>
                          {t("cls.recurring")}: {recurrenceDaysLabel(t, r.daysOfWeek)} {r.startTime}
                        </span>
                        {!r.isActive && <Badge variant="neutral">{t("status.inactive")}</Badge>}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {r.nextScheduledDate && (
                          <span className="tabnum text-faint">{t("cls.nextOn", { date: formatDateShort(new Date(`${r.nextScheduledDate}T00:00:00`)) })}</span>
                        )}
                        {canPurge && (
                          <button
                            type="button"
                            aria-label={t("cls.deleteRecurrence")}
                            onClick={() => setDeleteRecurrenceTarget(r)}
                            className="grid size-6 place-items-center rounded text-faint transition-colors hover:bg-red/10 hover:text-red"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {canManage && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Button size="sm" variant="secondary" disabled={recs.some((r) => !r.isActive)} onClick={() => setExtendTarget(recs[0])}>
                        {t("cls.extendRecurring")}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={recs.some((r) => !r.isActive)} onClick={() => setStopTarget(recs[0])}>
                        {t("cls.stopRecurring")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center gap-2">
                {canManage && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setSessionModalFor(c)}>{t("cls.addSession")}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setRecurrenceModalFor(c)}>
                      <CalendarRange className="size-3.5" />
                      {t("cls.addRecurring")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setClassModal({ open: true, target: c })}>{t("common.edit")}</Button>
                  </>
                )}
                {canPurge && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto text-red hover:bg-red/10 hover:text-red"
                    aria-label={t("cls.deleteClass")}
                    onClick={() => setDeleteClassTarget(c)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {classesList.length === 0 && <EmptyState icon={<CalendarDays />} title={t("cls.emptySessions")} />}

      {classModal.open && (
        <ClassFormModal
          target={classModal.target}
          onClose={() => setClassModal({ open: false, target: null })}
          onSaved={() => { setClassModal({ open: false, target: null }); reload(); }}
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

function ClassFormModal({ target, onClose, onSaved }: { target: GymClass | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [trainersList, setTrainersList] = useState<Array<{ id: string; fullName: string }>>([]);
  const [form, setForm] = useState({
    name: target?.name ?? "",
    discipline: (target?.discipline ?? "general") as CombatDiscipline,
    category: (target?.category ?? "all") as TargetCategory,
    level: (target?.level ?? "all_levels") as CombatLevel,
    trainerId: target?.trainerId ?? "",
    location: target?.location ?? "",
    capacity: String(target?.capacity ?? 15),
    consumesSession: target?.consumesSession ?? false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!actor) return;
    api.trainers.list().then((list) =>
      setTrainersList(list.map((tr) => ({ id: tr.id, fullName: tr.fullName }))),
    ).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        discipline: form.discipline,
        category: form.category,
        level: form.level,
        trainerId: form.trainerId || null,
        location: form.location || null,
        capacity: Number(form.capacity),
        consumesSession: form.consumesSession,
      };
      if (target) await api.classes.update(target.id, payload);
      else await api.classes.create(payload);
      toast("success", t("cls.saved"));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={target ? t("cls.editClass") : t("cls.newClass")} widthClass="max-w-md"
      footer={<><Button type="submit" form="class-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="class-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3.5">
        <Input label={t("cls.className")} value={form.name} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t("cls.disciplineLabel")}
            value={form.discipline}
            onChange={(e) => setForm((f) => ({ ...f, discipline: e.target.value as CombatDiscipline }))}
            options={DISCIPLINE_KEYS.map((k) => ({
              value: k,
              label: t(`cls.disciplines.${k}`),
            }))}
          />
          <Select
            label={t("cls.categoryLabel")}
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as TargetCategory }))}
            options={CATEGORY_KEYS.map((k) => ({
              value: k,
              label: t(`cls.categories.${k}`),
            }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t("cls.levelLabel")}
            value={form.level}
            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value as CombatLevel }))}
            options={LEVEL_KEYS.map((k) => ({
              value: k,
              label: t(`cls.levels.${k}`),
            }))}
          />
          <Select
            label={t("cls.trainerCol")}
            value={form.trainerId}
            onChange={(e) => setForm((f) => ({ ...f, trainerId: e.target.value }))}
            options={[
              { value: "", label: "—" },
              ...trainersList.map((tr) => ({ value: tr.id, label: tr.fullName })),
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t("cls.location")}
            placeholder={t("cls.locations.tatami")}
            value={form.location}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
          <Input
            label={t("cls.capacity")}
            type="number"
            min={1}
            dir="ltr"
            value={form.capacity}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, capacity: e.target.value }))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={form.consumesSession} onChange={(e) => setForm((f) => ({ ...f, consumesSession: e.target.checked }))} className="accent-neon" />
          {t("cls.consumesSession")}
        </label>
      </form>
    </Modal>
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