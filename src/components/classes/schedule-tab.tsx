import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ClassSession, type GymClass } from "@/api";
import { todayKey } from "@/core/dates";
import { formatDateShort } from "@/services/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { SessionDetailsModal } from "./session-details-modal";

const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

function keyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromKey(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
/** Saturday-start of the week containing `date`. */
function weekStartOf(date: Date): Date {
  const daysSinceSat = (date.getDay() + 1) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - daysSinceSat);
  return start;
}
function addDays(date: Date, n: number): Date {
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

export function ScheduleTab() {
  const t = useT();
  const { toast } = useToast();
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(new Date()));
  const [classesList, setClassesList] = useState<GymClass[]>([]);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [filterClass, setFilterClass] = useState("");
  const [details, setDetails] = useState<ClassSession | null>(null);

  const fromKeyStr = keyOf(weekStart);
  const toKeyStr = keyOf(addDays(weekStart, 6));

  const reload = useCallback(() => {
    api.classes.list({}).then(setClassesList).catch(console.error);
    api.classes
      .listSessions({ fromDate: fromKeyStr, toDate: toKeyStr, status: "all", limit: 200 })
      .then(setSessions)
      .catch((err) => toast("error", describeError(err, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKeyStr, toKeyStr]);

  useEffect(() => { reload(); }, [reload]);

  const byDay = useMemo(() => {
    const filtered = filterClass ? sessions.filter((s) => s.classId === filterClass) : sessions;
    const map = new Map<string, ClassSession[]>();
    for (const s of filtered) {
      const arr = map.get(s.sessionDate) ?? [];
      arr.push(s);
      map.set(s.sessionDate, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [sessions, filterClass]);

  const days = useMemo(
    () =>
      DAY_ORDER.map((day, i) => {
        const d = addDays(weekStart, i);
        return { day, dateKey: keyOf(d), date: d, dayName: t(`dow.day${day}`), sessions: byDay.get(keyOf(d)) ?? [] };
      }),
    [weekStart, byDay, t],
  );

  const today = todayKey();
  const isEmpty = days.every((d) => d.sessions.length === 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setWeekStart((w) => addDays(w, -7))}>
            <ChevronRight className="size-4" />
            {t("cls.weekPrev")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setWeekStart((w) => addDays(w, 7))}>
            {t("cls.weekNext")}
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(weekStartOf(new Date()))}>{t("cls.weekToday")}</Button>
          <span className="tabnum text-subtle">
            {t("cls.weekRange", { from: formatDateShort(fromKey(fromKeyStr)), to: formatDateShort(addDays(weekStart, 6)) })}
          </span>
        </div>
        <Select
          className="w-52"
          value={filterClass}
          onChange={(e) => setFilterClass(e.target.value)}
          options={[{ value: "", label: t("cls.allClasses") }, ...classesList.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>

      {isEmpty ? (
        <EmptyState icon={<CalendarPlus />} title={t("cls.scheduleEmpty")} description={t("cls.scheduleEmptyDesc")} />
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d) => (
            <div key={d.day} className="min-w-0 rounded-xl border border-line bg-panel">
              <div className={`flex flex-col items-center gap-0.5 border-b border-line px-1 py-2 ${d.dateKey === today ? "bg-neon/10" : ""}`}>
                <span className="text-[11px] font-bold text-subtle">{d.dayName}</span>
                <span className="tabnum text-[13px] font-extrabold">{formatDateShort(d.date)}</span>
              </div>
              <div className="flex min-h-24 flex-col gap-1.5 p-1.5">
                {d.sessions.map((s) => {
                  const full = s.bookedCount >= s.capacity;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setDetails(s)}
                      className={`group rounded-lg border p-1.5 text-start transition-colors hover:bg-white/5 ${
                        s.status === "cancelled"
                          ? "border-line bg-black/30 opacity-70"
                          : s.status === "done"
                            ? "border-line bg-black/20"
                            : "border-line-strong"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span dir="ltr" className="tabnum text-[11px] font-bold text-neon">{s.startTime}</span>
                        {s.status === "cancelled" && <Badge variant="neutral">{t("cls.status_cancelled")}</Badge>}
                        {s.status === "done" && <Badge variant="success">{t("cls.status_done")}</Badge>}
                      </span>
                      <span className="block truncate text-[12px] font-bold">{s.className}</span>
                      {s.trainerName && <span className="block truncate text-[10px] text-faint">{s.trainerName}</span>}
                      {s.status === "scheduled" && (
                        <span className="mt-1 inline-flex">
                          <Badge variant={full ? "danger" : s.bookedCount / s.capacity > 0.7 ? "warning" : "success"} dot>
                            {s.bookedCount}/{s.capacity}
                          </Badge>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {details && (
        <SessionDetailsModal
          session={details}
          onChanged={() => reload()}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
}