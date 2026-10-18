import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Check, CheckCircle2, RotateCcw, Save, UserCheck, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type BookingRow, type ClassSession } from "@/api";
import { formatDateShort, formatTime } from "@/services/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

export function SessionDetailsModal({
  session,
  onClose,
  onChanged,
}: {
  session: ClassSession;
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  // Local roster attendance state for batch saving: bookingId -> status
  const [rosterStatus, setRosterStatus] = useState<Record<string, "attended" | "no_show" | "booked">>({});
  const [isDirty, setIsDirty] = useState(false);
  const [savingRoster, setSavingRoster] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"complete" | "cancel" | "uncancel" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = hasPermission("classes.manage");
  const canPurge = hasPermission("classes.purge");
  const canCheckin = hasPermission("classes.checkin");

  const reloadBookings = useCallback(() => {
    api.classes.listBookings(session.id).then((list) => {
      setBookings(list);
      // Initialize local roster status
      const initial: Record<string, "attended" | "no_show" | "booked"> = {};
      list.forEach((b) => {
        initial[b.id] = (b.status === "attended" || b.status === "no_show" || b.status === "booked") ? b.status : "booked";
      });
      setRosterStatus(initial);
      setIsDirty(false);
    }).catch(console.error);
  }, [session.id]);

  useEffect(() => { reloadBookings(); }, [reloadBookings]);

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) toast("success", okMsg);
      reloadBookings();
      onChanged();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const toggleRosterAttendance = (bookingId: string) => {
    setRosterStatus((prev) => {
      const current = prev[bookingId] ?? "booked";
      const next = current === "attended" ? "booked" : "attended";
      return { ...prev, [bookingId]: next };
    });
    setIsDirty(true);
  };

  const setRosterItemStatus = (bookingId: string, status: "attended" | "no_show" | "booked") => {
    setRosterStatus((prev) => ({ ...prev, [bookingId]: status }));
    setIsDirty(true);
  };

  const saveRoster = async () => {
    setSavingRoster(true);
    try {
      const items = bookings.map((b) => ({
        bookingId: b.id,
        memberId: b.memberId,
        status: rosterStatus[b.id] ?? "booked",
      }));
      const res = await api.classes.saveAttendanceRoster(session.id, items);
      toast("success", t("cls.rosterSavedToast", { count: res.attendedCount }));
      setIsDirty(false);
      reloadBookings();
      onChanged();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingRoster(false);
    }
  };

  const markAllAttended = () => {
    setRosterStatus((prev) => {
      const updated = { ...prev };
      bookings.forEach((b) => {
        if (b.status !== "cancelled") {
          updated[b.id] = "attended";
        }
      });
      return updated;
    });
    setIsDirty(true);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${session.className} — ${formatDateShort(new Date(`${session.sessionDate}T00:00:00`))}`}
      widthClass="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Info header */}
        <div className="grid gap-2 rounded-xl border border-white/5 bg-panel px-4 py-3 text-[13px] sm:grid-cols-2">
          <span className="text-subtle">{t("cls.startTime")}: <b className="tabnum text-fg">{formatTime(session.startTime)}</b></span>
          <span className="text-subtle">{t("cls.duration")}: <b className="tabnum text-fg">{session.durationMin} {t("cls.minutes")}</b></span>
          {session.trainerName && <span className="text-subtle">{t("cls.trainerCol")}: <b className="text-fg">{session.trainerName}</b></span>}
          {session.location && <span className="text-subtle">{t("cls.location")}: <b className="text-fg">{session.location}</b></span>}
        </div>

        {/* Action toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-panel px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="tabnum text-subtle">
              {t("cls.booked")}: <b className="text-fg font-bold">{session.bookedCount}</b> / {session.capacity}
            </span>
            <span className="text-subtle">|</span>
            <span className="tabnum text-emerald-400 font-bold">
              {t("cls.attended")}: {Object.values(rosterStatus).filter((s) => s === "attended").length}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {canCheckin && bookings.length > 0 && (
              <Button size="sm" variant="ghost" onClick={markAllAttended}>
                <Check className="size-3.5 text-neon" />
                {t("cls.markAllAttended")}
              </Button>
            )}
            {canCheckin && (
              <Button size="sm" variant="secondary" disabled={session.status !== "scheduled"} onClick={() => setPickerOpen(true)}>
                {t("cls.book")}
              </Button>
            )}
            {canManage && session.status === "scheduled" && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmAction("complete")}>{t("cls.completeSession")}</Button>
            )}
            {canManage && (session.status === "cancelled" ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirmAction("uncancel")}>
                <RotateCcw className="size-3.5" />
                {t("cls.uncancelSession")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmAction("cancel")}>{t("cls.cancelSession")}</Button>
            ))}
            {canPurge && (
              <Button size="sm" variant="ghost" className="text-red hover:bg-red/10 hover:text-red" onClick={() => setConfirmAction("delete")}>
                {t("common.delete")}
              </Button>
            )}
          </div>
        </div>

        {/* Trainees Roster List */}
        {bookings.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title={t("cls.emptyBookings")} />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-subtle font-semibold px-1">
              <span>{t("cls.rosterSheetTitle")} ({bookings.length})</span>
              <span>{t("cls.clickToToggleAttendance")}</span>
            </div>

            <div className="divide-y divide-white/5 rounded-xl border border-white/5 bg-panel overflow-hidden">
              {bookings.map((r) => {
                const currentStatus = rosterStatus[r.id] ?? r.status;
                const isAttended = currentStatus === "attended";
                const isNoShow = currentStatus === "no_show";
                const lowSessions = r.sessionsRemaining !== null && r.sessionsRemaining !== undefined && r.sessionsRemaining <= 1;

                return (
                  <div
                    key={r.id}
                    className={`flex flex-wrap items-center justify-between gap-3 p-3 transition-colors ${
                      isAttended ? "bg-emerald-500/10" : isNoShow ? "bg-amber-500/5" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    {/* Member Details */}
                    <div
                      className="flex items-center gap-3 cursor-pointer min-w-0"
                      onClick={() => canCheckin && toggleRosterAttendance(r.id)}
                    >
                      <div
                        className={`grid size-8 place-items-center rounded-lg border font-bold transition-all ${
                          isAttended
                            ? "bg-emerald-500 text-white border-emerald-400"
                            : "bg-surface/50 text-faint border-white/10 hover:border-neon"
                        }`}
                      >
                        {isAttended ? <Check className="size-4 stroke-[3]" /> : <UserCheck className="size-4" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold truncate ${isAttended ? "text-emerald-400" : "text-fg"}`}>
                            {r.memberName}
                          </span>
                          {/* Low sessions warning (Suggestion 3) */}
                          {lowSessions && (
                            <Badge variant="warning" className="gap-1 text-[10px] py-0 px-1.5">
                              <AlertTriangle className="size-2.5 text-amber-400" />
                              {r.sessionsRemaining === 0 ? t("cls.noSessionsRemaining") : t("cls.oneSessionRemaining")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-faint tabnum">
                          <span>{r.memberCode}</span>
                          {r.memberPhone && (
                            <>
                              <span>•</span>
                              <span dir="ltr">{r.memberPhone}</span>
                            </>
                          )}
                          {r.subscriptionPlanName && (
                            <>
                              <span>•</span>
                              <span className="text-cyan-400">{r.subscriptionPlanName}</span>
                            </>
                          )}
                          {r.sessionsRemaining !== null && r.sessionsRemaining !== undefined && (
                            <>
                              <span>•</span>
                              <span className="text-subtle font-semibold">
                                {t("cls.sessionsLeft")}: {r.sessionsRemaining}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status Toggle Buttons */}
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={isAttended ? "primary" : "ghost"}
                        className={`h-7 px-2.5 text-xs ${isAttended ? "bg-emerald-600 text-white font-bold" : "text-subtle"}`}
                        onClick={() => canCheckin && setRosterItemStatus(r.id, isAttended ? "booked" : "attended")}
                      >
                        <CheckCircle2 className="size-3.5" />
                        <span>{t("cls.attended")}</span>
                      </Button>

                      <Button
                        size="sm"
                        variant={isNoShow ? "secondary" : "ghost"}
                        className={`h-7 px-2 text-xs ${isNoShow ? "bg-amber-600 text-white font-bold" : "text-faint"}`}
                        onClick={() => canCheckin && setRosterItemStatus(r.id, isNoShow ? "booked" : "no_show")}
                      >
                        <span>{t("cls.noShow")}</span>
                      </Button>

                      {canManage && (
                        <button
                          type="button"
                          aria-label={t("cls.cancelBooking")}
                          onClick={() => void act(() => api.classes.cancelBooking(r.id))}
                          className="grid size-7 place-items-center rounded-lg text-faint hover:text-red hover:bg-red/10"
                        >
                          <XCircle className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Batch Save Button */}
        {canCheckin && bookings.length > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-neon/20 bg-neon/5 p-3.5">
            <span className="text-xs text-subtle font-medium">
              {isDirty ? t("cls.rosterHasUnsavedChanges") : t("cls.rosterUpToDate")}
            </span>
            <Button
              onClick={() => void saveRoster()}
              loading={savingRoster}
              disabled={savingRoster}
              className="gap-1.5"
            >
              <Save className="size-4" />
              <span>{t("cls.saveRosterBtn")}</span>
            </Button>
          </div>
        )}
      </div>

      <MemberPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m) => {
          setPickerOpen(false);
          void act(async () => api.classes.book({ sessionId: session.id, memberId: m.id }));
        }}
      />

      <ConfirmDialog
        open={confirmAction === "complete"}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          setBusy(true);
          act(() => api.classes.completeSession(session.id), t("toast.saved")).finally(() => {
            setBusy(false);
            setConfirmAction(null);
          });
        }}
        title={t("cls.completeSession")}
        message={`${session.className} — ${formatDateShort(new Date(`${session.sessionDate}T00:00:00`))}`}
        confirmLabel={t("common.confirm")}
        loading={busy}
      />
      <ConfirmDialog
        open={confirmAction === "cancel"}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          setBusy(true);
          act(() => api.classes.cancelSession(session.id, "—"), t("cls.sessionCancelledToast")).finally(() => {
            setBusy(false);
            setConfirmAction(null);
          });
        }}
        title={t("cls.cancelSession")}
        message={`${session.className} — ${formatDateShort(new Date(`${session.sessionDate}T00:00:00`))}`}
        confirmLabel={t("common.confirm")}
        loading={busy}
      />
      <ConfirmDialog
        open={confirmAction === "uncancel"}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          setBusy(true);
          act(() => api.classes.uncancelSession(session.id), t("cls.sessionUncancelledToast")).finally(() => {
            setBusy(false);
            setConfirmAction(null);
          });
        }}
        title={t("cls.uncancelSession")}
        message={t("cls.uncancelSessionConfirmMsg")}
        confirmLabel={t("common.confirm")}
        loading={busy}
      />
      <ConfirmDialog
        open={confirmAction === "delete"}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          setBusy(true);
          api.classes.deleteSession(session.id)
            .then(() => {
              toast("success", t("toast.deleted"));
              onChanged();
              onClose();
            })
            .catch((err) => toast("error", describeError(err, t)))
            .finally(() => {
              setBusy(false);
              setConfirmAction(null);
            });
        }}
        title={t("cls.deleteSession")}
        message={t("cls.deleteSessionConfirm")}
        confirmLabel={t("common.delete")}
        tone="danger"
        loading={busy}
      />
    </Modal>
  );
}