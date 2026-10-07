import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  LogIn,
  LogOut,
  ScanLine,
  Search,
  User,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicAttendance, type PublicEmployee } from "@/api";
import { useAuth } from "@/contexts/auth-context";
import { useConfiguredScanner } from "@/hooks/use-configured-scanner";
import { playErrorBuzz, playSuccessChime } from "@/utils/sound";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarcodeField } from "@/components/ui/barcode-field";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/utils/cn";

function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type TabMode = "barcode" | "name";
type StatusFilter = "all" | "working" | "checkedOut" | "notYet";

export function EmployeeCheckInPage() {
  const t = useT();
  const { toast } = useToast();
  const { actor } = useAuth();

  // Tab & mode states
  const [tab, setTab] = useState<TabMode>("name");
  const [mode, setMode] = useState<"in" | "out">("in");
  const [barcode, setBarcode] = useState("");
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublicAttendance | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Staff and daily attendance state
  const [employees, setEmployees] = useState<PublicEmployee[]>([]);
  const [todayAttendance, setTodayAttendance] = useState<PublicAttendance[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Roster search and filter
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterFilter, setRosterFilter] = useState<StatusFilter>("all");

  const todayDateStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  // Fetch employees and today's attendance
  const loadData = useCallback(async () => {
    try {
      const [empList, attList] = await Promise.all([
        api.employees.list({ includeInactive: false }),
        api.employeesHr.listAttendance({ dateKey: todayDateStr }),
      ]);
      setEmployees(empList);
      setTodayAttendance(attList);
    } catch {
      // ignore background error
    } finally {
      setLoadingData(false);
    }
  }, [todayDateStr]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Map employee ID -> today's attendance
  const attendanceMap = useMemo(() => {
    const map = new Map<string, PublicAttendance>();
    for (const att of todayAttendance) {
      map.set(att.employeeId, att);
    }
    return map;
  }, [todayAttendance]);

  // Current user's linked employee profile
  const myEmployee = useMemo(() => {
    if (!actor?.userId) return null;
    return employees.find((e) => e.userId === actor.userId) ?? null;
  }, [actor?.userId, employees]);

  const myAttendance = useMemo(() => {
    if (!myEmployee) return null;
    return attendanceMap.get(myEmployee.id) ?? null;
  }, [myEmployee, attendanceMap]);

  // Clock-in or out for self
  const handleMyAttendanceAction = async () => {
    if (!myEmployee) return;
    setSubmitting(true);
    setErrorText(null);
    try {
      let res: PublicAttendance;
      if (!myAttendance) {
        res = await api.employeesHr.clockIn({ employeeId: myEmployee.id });
        toast("success", t("hr.clockInToast"));
      } else {
        res = await api.employeesHr.clockOut({ employeeId: myEmployee.id });
        toast("success", t("hr.clockOutToast"));
      }
      setResult(res);
      void api.settings.soundEnabled().then((on) => {
        if (on) playSuccessChime();
      });
      await loadData();
    } catch (err) {
      setErrorText(describeError(err, t));
      void api.settings.soundEnabled().then((on) => {
        if (on) playErrorBuzz();
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Clock-in / out by barcode
  const submitBarcode = useCallback(
    async (raw: string) => {
      const value = raw.trim().toUpperCase();
      if (value === "") return;
      setSubmitting(true);
      setErrorText(null);
      try {
        const res =
          mode === "in"
            ? await api.employeesHr.clockInByBarcode({ barcode: value })
            : await api.employeesHr.clockOutByBarcode({ barcode: value });
        setResult(res);
        setBarcode("");
        void api.settings.soundEnabled().then((on) => {
          if (on) playSuccessChime();
        });
        toast(
          "success",
          mode === "in" ? t("hr.clockInToast") : t("hr.clockOutToast")
        );
        await loadData();
      } catch (err) {
        setResult(null);
        setErrorText(describeError(err, t));
        void api.settings.soundEnabled().then((on) => {
          if (on) playErrorBuzz();
        });
      } finally {
        setSubmitting(false);
      }
    },
    [mode, t, toast, loadData]
  );

  // Clock-in / out by selecting an employee
  const submitEmployeeAction = useCallback(
    async (empId: string, action: "in" | "out") => {
      if (!empId) return;
      setSubmitting(true);
      setErrorText(null);
      try {
        const res =
          action === "in"
            ? await api.employeesHr.clockInEmployee({ employeeId: empId })
            : await api.employeesHr.clockOutEmployee({ employeeId: empId });
        setResult(res);
        if (selectedEmpId === empId) setSelectedEmpId("");
        void api.settings.soundEnabled().then((on) => {
          if (on) playSuccessChime();
        });
        toast(
          "success",
          action === "in" ? t("hr.clockInToast") : t("hr.clockOutToast")
        );
        await loadData();
      } catch (err) {
        setResult(null);
        setErrorText(describeError(err, t));
        void api.settings.soundEnabled().then((on) => {
          if (on) playErrorBuzz();
        });
      } finally {
        setSubmitting(false);
      }
    },
    [selectedEmpId, t, toast, loadData]
  );

  useConfiguredScanner((scanned) => void submitBarcode(scanned));

  useEffect(() => {
    document.title = `${t("nav.employeeCheckIn")} — ${t("app.name")}`;
  }, [t]);

  // Statistics for roster
  const counts = useMemo(() => {
    let working = 0;
    let checkedOut = 0;
    let notYet = 0;
    for (const emp of employees) {
      const att = attendanceMap.get(emp.id);
      if (!att) notYet++;
      else if (!att.clockOutAt) working++;
      else checkedOut++;
    }
    return { working, checkedOut, notYet, total: employees.length };
  }, [employees, attendanceMap]);

  // Filtered employees for roster
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const att = attendanceMap.get(emp.id);
      if (rosterFilter === "working" && (!att || att.clockOutAt)) return false;
      if (rosterFilter === "checkedOut" && (!att || !att.clockOutAt)) return false;
      if (rosterFilter === "notYet" && att) return false;

      if (rosterSearch.trim()) {
        const q = rosterSearch.toLowerCase();
        const nameMatch = emp.fullName.toLowerCase().includes(q);
        const roleMatch = emp.roleTitle?.toLowerCase().includes(q);
        const phoneMatch = emp.phone?.includes(q);
        if (!nameMatch && !roleMatch && !phoneMatch) return false;
      }
      return true;
    });
  }, [employees, attendanceMap, rosterFilter, rosterSearch]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* SECTION 1: Personal Attendance Card (if current logged-in user is linked to an employee) */}
      {myEmployee && (
        <Card className="border-neon/30 bg-gradient-to-br from-panel via-panel to-neon/5">
          <CardHeader
            title={t("hr.myAttendanceTitle")}
            action={
              <Badge variant={!myAttendance ? "neutral" : !myAttendance.clockOutAt ? "success" : "info"}>
                {!myAttendance
                  ? t("hr.statusNotYet")
                  : !myAttendance.clockOutAt
                    ? t("hr.statusWorking")
                    : t("hr.statusCheckedOut")}
              </Badge>
            }
          />
          <div className="p-5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-xl bg-neon/15 text-neon font-bold text-lg">
                <UserCheck className="size-6" />
              </div>
              <div>
                <div className="text-base font-extrabold text-ink">{myEmployee.fullName}</div>
                <div className="text-xs text-subtle">
                  {myEmployee.roleTitle || t("hr.employeeLabel")}
                  {myAttendance?.clockInAt && (
                    <span className="ms-2 font-mono text-neon">
                      · {t("hr.clockInAt")}: {myAttendance.clockInAt.slice(11, 16)}
                    </span>
                  )}
                  {myAttendance?.clockOutAt && (
                    <span className="ms-2 font-mono text-cyan">
                      · {t("hr.clockOutAt")}: {myAttendance.clockOutAt.slice(11, 16)} ({hoursLabel(myAttendance.workedMinutes)})
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="w-full md:w-auto">
              {!myAttendance ? (
                <Button
                  onClick={handleMyAttendanceAction}
                  loading={submitting}
                  size="lg"
                  className="w-full md:w-auto bg-neon text-black hover:bg-neon/90 font-black shadow-lg shadow-neon/20"
                >
                  <LogIn className="size-5 me-2" />
                  {t("hr.myAttendanceIn")}
                </Button>
              ) : !myAttendance.clockOutAt ? (
                <Button
                  onClick={handleMyAttendanceAction}
                  loading={submitting}
                  size="lg"
                  variant="danger"
                  className="w-full md:w-auto font-black shadow-lg shadow-red/20"
                >
                  <LogOut className="size-5 me-2" />
                  {t("hr.myAttendanceOut")}
                </Button>
              ) : (
                <div className="flex items-center gap-2 text-sm font-bold text-cyan bg-cyan/10 border border-cyan/20 px-4 py-2.5 rounded-xl">
                  <CheckCircle2 className="size-5" />
                  {t("hr.shiftCompleted")}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* SECTION 2: Quick Clock-In / Clock-Out Form (By Name OR By Barcode) */}
      <Card>
        <CardHeader
          title={t("nav.employeeCheckIn")}
          action={
            <div className="flex rounded-lg border border-line bg-surface p-1">
              <button
                type="button"
                onClick={() => setTab("name")}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-bold transition-colors",
                  tab === "name" ? "bg-panel text-ink shadow-sm" : "text-subtle hover:text-ink"
                )}
              >
                <Users className="size-3.5 inline-block me-1.5" />
                {t("hr.checkInByNameTab")}
              </button>
              <button
                type="button"
                onClick={() => setTab("barcode")}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-bold transition-colors",
                  tab === "barcode" ? "bg-panel text-ink shadow-sm" : "text-subtle hover:text-ink"
                )}
              >
                <ScanLine className="size-3.5 inline-block me-1.5" />
                {t("hr.checkInByBarcodeTab")}
              </button>
            </div>
          }
        />
        <div className="space-y-4 p-5">
          {/* In / Out Mode Selector */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("in")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-colors",
                mode === "in"
                  ? "border-neon bg-neon/10 text-neon"
                  : "border-line text-subtle hover:border-line-strong"
              )}
            >
              <LogIn className="size-4" /> {t("hr.clockIn")}
            </button>
            <button
              type="button"
              onClick={() => setMode("out")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-colors",
                mode === "out"
                  ? "border-red bg-red/10 text-red"
                  : "border-line text-subtle hover:border-line-strong"
              )}
            >
              <LogOut className="size-4" /> {t("hr.clockOut")}
            </button>
          </div>

          {/* Form based on selected tab */}
          {tab === "name" ? (
            <div className="flex flex-col sm:flex-row items-end gap-2.5">
              <div className="flex-1 w-full space-y-1.5">
                <label className="block text-[13px] font-semibold text-subtle">
                  {t("hr.employeeLabel")}
                </label>
                <select
                  value={selectedEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  disabled={submitting}
                  className="h-10 w-full cursor-pointer rounded-xl border border-line bg-panel px-3.5 text-sm text-ink outline-none transition-colors focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
                >
                  <option value="">{t("hr.selectEmployeePlaceholder")}</option>
                  {employees.map((emp) => {
                    const att = attendanceMap.get(emp.id);
                    const statusText = !att
                      ? `(${t("hr.statusNotYet")})`
                      : !att.clockOutAt
                        ? `(🟢 ${t("hr.statusWorking")})`
                        : `(🔵 ${t("hr.statusCheckedOut")})`;
                    return (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName} {emp.roleTitle ? `— ${emp.roleTitle}` : ""} {statusText}
                      </option>
                    );
                  })}
                </select>
              </div>
              <Button
                type="button"
                size="lg"
                loading={submitting}
                disabled={submitting || !selectedEmpId}
                variant={mode === "in" ? "primary" : "danger"}
                onClick={() => submitEmployeeAction(selectedEmpId, mode)}
                className="w-full sm:w-auto"
              >
                {mode === "in" ? <LogIn className="size-4 me-1.5" /> : <LogOut className="size-4 me-1.5" />}
                {mode === "in" ? t("hr.clockIn") : t("hr.clockOut")}
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitBarcode(barcode);
              }}
              className="flex items-end gap-2.5"
            >
              <div className="flex-1">
                <BarcodeField
                  id="emp-checkin-barcode"
                  label={t("hr.scanEmployeeBarcode")}
                  value={barcode}
                  onValueChange={setBarcode}
                  disabled={submitting}
                  placeholder="EMP-000001"
                  onScanComplete={(code) => void submitBarcode(code)}
                />
              </div>
              <Button
                type="submit"
                size="lg"
                loading={submitting}
                disabled={submitting || barcode.trim() === ""}
                variant={mode === "in" ? "primary" : "danger"}
              >
                {!submitting && <ScanLine className="size-4" />}
                {t("checkin.submit")}
              </Button>
            </form>
          )}

          {errorText && (
            <p className="rounded-xl border border-red/30 bg-red/10 px-4 py-2.5 text-sm font-bold text-red">
              {errorText}
            </p>
          )}

          {/* Result card upon success */}
          {result && (
            <div className="space-y-2 rounded-xl border border-line bg-panel p-4">
              <div className="flex items-center gap-2">
                <div className="grid size-9 place-items-center rounded-lg bg-neon/10 text-neon">
                  <User className="size-4" />
                </div>
                <div>
                  <div className="text-sm font-extrabold">{result.employeeName}</div>
                  <div className="text-[11px] text-subtle">{result.dateKey}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-sm">
                <div className="rounded-lg bg-surface p-2.5">
                  <div className="text-[11px] text-subtle">{t("hr.clockInAt")}</div>
                  <div dir="ltr" className="font-bold tabnum">{result.clockInAt.slice(11, 19)}</div>
                </div>
                <div className="rounded-lg bg-surface p-2.5">
                  <div className="text-[11px] text-subtle">{t("hr.clockOutAt")}</div>
                  <div dir="ltr" className="font-bold tabnum">{result.clockOutAt ? result.clockOutAt.slice(11, 19) : "—"}</div>
                </div>
              </div>
              {result.workedMinutes > 0 && (
                <p className="flex items-center justify-center gap-2 text-sm">
                  <span className="text-subtle">{t("hr.workedHours")}:</span>
                  <span dir="ltr" className="font-bold tabnum">{hoursLabel(result.workedMinutes)}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* SECTION 3: Live Staff Roster with 1-Click Clock-In / Clock-Out */}
      <Card>
        <CardHeader
          title={t("hr.staffRosterTitle")}
          action={
            <div className="text-xs text-subtle hidden sm:block">
              {t("hr.todayRosterSummary", {
                working: counts.working,
                out: counts.checkedOut,
                notYet: counts.notYet,
              })}
            </div>
          }
        />
        <div className="p-5 space-y-4">
          {/* Search & Filter bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
              <input
                type="text"
                value={rosterSearch}
                onChange={(e) => setRosterSearch(e.target.value)}
                placeholder={t("hr.searchEmployeePh")}
                className="h-9 w-full rounded-xl border border-line bg-panel ps-9 pe-3 text-sm text-ink outline-none transition-colors focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {(
                [
                  { id: "all", label: `${t("hr.staffFilterAll")} (${counts.total})` },
                  { id: "working", label: `${t("hr.staffFilterWorking")} (${counts.working})` },
                  { id: "checkedOut", label: `${t("hr.staffFilterCheckedOut")} (${counts.checkedOut})` },
                  { id: "notYet", label: `${t("hr.staffFilterNotYet")} (${counts.notYet})` },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setRosterFilter(f.id)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors",
                    rosterFilter === f.id
                      ? "bg-neon/10 text-neon border border-neon/30"
                      : "bg-surface border border-line text-subtle hover:text-ink"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Roster List */}
          {loadingData ? (
            <div className="py-12 text-center text-sm text-subtle">جارٍ التحميل…</div>
          ) : filteredEmployees.length === 0 ? (
            <EmptyState icon={<Users />} title={t("hr.noEmployeesFound")} />
          ) : (
            <div className="divide-y divide-line rounded-xl border border-line bg-panel overflow-hidden">
              {filteredEmployees.map((emp) => {
                const att = attendanceMap.get(emp.id);
                const isWorking = Boolean(att && !att.clockOutAt);
                const isCheckedOut = Boolean(att?.clockOutAt);
                const isNotYet = !att;

                return (
                  <div
                    key={emp.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 hover:bg-surface/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "grid size-10 place-items-center rounded-xl font-bold text-sm",
                          isWorking
                            ? "bg-neon/15 text-neon"
                            : isCheckedOut
                              ? "bg-cyan/15 text-cyan"
                              : "bg-surface text-faint"
                        )}
                      >
                        {isWorking ? (
                          <Clock className="size-5" />
                        ) : isCheckedOut ? (
                          <CheckCircle2 className="size-5" />
                        ) : (
                          <UserX className="size-5" />
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm text-ink">{emp.fullName}</span>
                          {emp.roleTitle && (
                            <span className="text-xs text-subtle">({emp.roleTitle})</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-subtle mt-0.5">
                          {isWorking && att && (
                            <span className="text-neon font-medium">
                              حاضر منذ: <span dir="ltr" className="tabnum font-mono">{att.clockInAt.slice(11, 16)}</span>
                            </span>
                          )}
                          {isCheckedOut && att && (
                            <span className="text-cyan font-medium">
                              انصرف في: <span dir="ltr" className="tabnum font-mono">{att.clockOutAt?.slice(11, 16)}</span>
                              {" · "}{hoursLabel(att.workedMinutes)}
                            </span>
                          )}
                          {isNotYet && (
                            <span className="text-faint">{t("hr.statusNotYet")}</span>
                          )}
                          {emp.phone && (
                            <span className="text-faint" dir="ltr">· {emp.phone}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {isNotYet && (
                        <Button
                          size="sm"
                          loading={submitting}
                          onClick={() => submitEmployeeAction(emp.id, "in")}
                          className="bg-neon/15 text-neon hover:bg-neon hover:text-black font-bold border border-neon/30"
                        >
                          <LogIn className="size-3.5 me-1" />
                          {t("hr.clockIn")}
                        </Button>
                      )}

                      {isWorking && (
                        <Button
                          size="sm"
                          variant="danger"
                          loading={submitting}
                          onClick={() => submitEmployeeAction(emp.id, "out")}
                          className="font-bold shadow-sm"
                        >
                          <LogOut className="size-3.5 me-1" />
                          {t("hr.clockOut")}
                        </Button>
                      )}

                      {isCheckedOut && (
                        <Badge variant="info">
                          <CheckCircle2 className="size-3 me-1" />
                          {t("hr.statusCheckedOut")}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
