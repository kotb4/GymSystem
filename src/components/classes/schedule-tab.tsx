import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ClassSession, type GymClass } from "@/api";
import { todayKey } from "@/core/dates";
import { formatDateShort, formatTime } from "@/services/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/utils/cn";
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
        <div className="overflow-x-auto pb-3">
          <div className="grid grid-cols-7 gap-2.5 min-w-[920px]">
            {days.map((d) => {
              const isCurrentDay = d.dateKey === today;
              return (
                <div
                  key={d.day}
                  className={cn(
                    "flex flex-col rounded-2xl border transition-all duration-200 min-h-[360px]",
                    isCurrentDay
                      ? "border-primary/60 bg-panel/95 shadow-glow-sm ring-1 ring-primary/30"
                      : "border-white/10 bg-panel/70 hover:border-white/20"
                  )}
                >
                  {/* Day Header */}
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 border-b px-2 py-3 rounded-t-2xl",
                      isCurrentDay
                        ? "border-primary/40 bg-primary/20 text-white"
                        : "border-white/10 bg-surface/50 text-subtle"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-black tracking-wide">{d.dayName}</span>
                      {isCurrentDay && (
                        <span className="size-2 rounded-full bg-emerald shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
                      )}
                    </div>
                    <span className="tabnum text-sm font-extrabold text-ink">
                      {formatDateShort(d.date)}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {d.sessions.length > 0 ? `${d.sessions.length} حصة` : "لا توجد حصص"}
                    </span>
                  </div>

                  {/* Day Sessions List */}
                  <div className="flex-1 flex flex-col gap-2 p-2 overflow-y-auto max-h-[520px]">
                    {d.sessions.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center py-10 text-center">
                        <span className="text-xs text-faint font-medium">متاح</span>
                      </div>
                    ) : (
                      d.sessions.map((s) => {
                        const full = s.bookedCount >= s.capacity;
                        const isDone = s.status === "done";
                        const isCancelled = s.status === "cancelled";

                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setDetails(s)}
                            className={cn(
                              "group relative flex flex-col gap-1.5 rounded-xl border p-2.5 text-start transition-all duration-150 hover:-translate-y-0.5 hover:shadow-pop",
                              isCancelled
                                ? "border-white/5 bg-black/40 opacity-60"
                                : isDone
                                  ? "border-emerald/30 bg-emerald/5 hover:border-emerald/50"
                                  : "border-white/10 bg-raised/90 hover:border-primary/50 hover:bg-raised"
                            )}
                          >
                            {/* Time & Status Header */}
                            <div className="flex items-center justify-between gap-1">
                              <span
                                className="tabnum text-xs font-black text-cyan"
                              >
                                {formatTime(s.startTime)}
                              </span>
                              {isCancelled && (
                                <Badge variant="neutral" className="text-[10px] px-1.5 py-0">
                                  {t("cls.status_cancelled")}
                                </Badge>
                              )}
                              {isDone && (
                                <Badge variant="success" className="text-[10px] px-1.5 py-0">
                                  {t("cls.status_done")}
                                </Badge>
                              )}
                              {!isCancelled && !isDone && (
                                <span className="tabnum text-[10px] font-bold text-subtle">
                                  {s.durationMin} دقيقة
                                </span>
                              )}
                            </div>

                            {/* Class Title */}
                            <span className="block font-bold text-xs text-ink leading-snug line-clamp-2">
                              {s.className}
                            </span>

                            {/* Discipline & Coach Badges */}
                            <div className="flex flex-wrap items-center gap-1">
                              {s.discipline && s.discipline !== "general" && (
                                <span className="text-[9px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded-md truncate max-w-[110px]">
                                  {t(`cls.disciplines.${s.discipline}`) || s.discipline}
                                </span>
                              )}
                              {s.trainerName && (
                                <span className="block truncate text-[10px] font-semibold text-slate-300">
                                  👤 {s.trainerName}
                                </span>
                              )}
                            </div>

                            {/* Capacity & Attendance Bar */}
                            {s.status === "scheduled" && (
                              <div className="mt-0.5 flex items-center justify-between gap-1 pt-1 border-t border-white/5">
                                <span className="text-[10px] text-faint">المقاعد:</span>
                                <Badge
                                  variant={full ? "danger" : s.bookedCount / s.capacity > 0.7 ? "warning" : "success"}
                                  dot
                                  className="text-[10px] px-1.5 py-0 font-bold tabnum"
                                >
                                  {s.bookedCount} / {s.capacity}
                                </Badge>
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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