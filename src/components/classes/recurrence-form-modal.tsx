import { useState, type ChangeEvent } from "react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type GymClass } from "@/api";
import { todayKey } from "@/core/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

export function RecurrenceFormModal({
  cls,
  onClose,
  onSaved,
}: {
  cls: GymClass;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [startDate, setStartDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("18:00");
  const [durationMin, setDurationMin] = useState("60");
  const [capacity, setCapacity] = useState("");
  const [weeks, setWeeks] = useState("4");
  const [busy, setBusy] = useState(false);

  const toggleDay = (day: number) => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.classes.createRecurrence({
        classId: cls.id,
        daysOfWeek: days,
        startDate,
        startTime,
        durationMin: Number(durationMin),
        capacity: capacity.trim() === "" ? null : Number(capacity),
        weeks: Number(weeks),
      });
      toast("success", t("cls.recurrenceToast", { created: res.created, skipped: res.skipped }));
      onSaved();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };
  const selectedLabel = DAY_ORDER.filter((d) => days.includes(d))
    .map((d) => t(`dow.day${d}`))
    .join("، ");

  return (
    <Modal open onClose={onClose} title={t("cls.recurringModalTitle")} widthClass="max-w-md"
      footer={<><Button type="submit" form="recurrence-form" loading={busy}>{t("common.save")}</Button><Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button></>}>
      <form id="recurrence-form" onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3.5">
        <p className="text-[13px] font-semibold text-subtle">{t("cls.recurringFor", { name: cls.name, days: selectedLabel, time: startTime })}</p>
        <div>
          <p className="mb-1.5 text-sm font-semibold">{t("cls.daysOfWeek")}</p>
          <div className="flex flex-wrap gap-1.5">
            {DAY_ORDER.map((day) => {
              const active = days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`rounded-lg px-2.5 py-1.5 text-[13px] font-bold transition-colors ${active ? "bg-neon text-black" : "bg-white/5 text-subtle hover:bg-white/10"}`}
                >
                  {t(`dow.day${day}`)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t("cls.startDateRecur")} type="date" dir="ltr" value={startDate} onChange={(e: ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)} autoFocus />
          <Input label={t("cls.startTime")} type="time" dir="ltr" value={startTime} onChange={(e: ChangeEvent<HTMLInputElement>) => setStartTime(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label={t("cls.duration")} type="number" min={5} dir="ltr" value={durationMin} onChange={(e: ChangeEvent<HTMLInputElement>) => setDurationMin(e.target.value)} />
          <Input label={t("cls.capacity")} type="number" min={1} dir="ltr" value={capacity} onChange={(e: ChangeEvent<HTMLInputElement>) => setCapacity(e.target.value)} placeholder="—" />
          <Input label={t("cls.weeksLabel")} type="number" min={1} max={12} dir="ltr" value={weeks} onChange={(e: ChangeEvent<HTMLInputElement>) => setWeeks(e.target.value)} />
        </div>
        <p className="text-[11px] text-faint">{t("cls.weeksHint")}</p>
      </form>
    </Modal>
  );
}