import { useCallback, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type BookingRow, type ClassSession } from "@/api";
import { formatDateShort } from "@/services/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

const BOOKING_STATUS_KEY: Record<string, string> = {
  booked: "cls.bookingBooked",
  attended: "cls.bookingAttended",
  cancelled: "cls.bookingCancelled",
  no_show: "cls.bookingNo_show",
};

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"complete" | "cancel" | "uncancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = hasPermission("classes.manage");

  const reloadBookings = useCallback(() => {
    api.classes.listBookings(session.id).then(setBookings).catch(console.error);
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

  const columns: Column<BookingRow>[] = [
    { key: "member", header: t("common.member"), render: (r) => (
      <span><span className="block font-bold">{r.memberName}</span><span dir="ltr" className="block text-[11px] text-faint tabnum">{r.memberCode}</span></span>
    ) },
    { key: "status", header: t("common.status"), render: (r) => <Badge variant={
      r.status === "attended" ? "success" : r.status === "booked" ? "info" : r.status === "no_show" ? "warning" : "neutral"
    } dot>{t(BOOKING_STATUS_KEY[r.status] ?? "cls.bookingBooked")}</Badge> },
    ...(hasPermission("classes.checkin") ? [{
      key: "actions", header: "", align: "end" as const,
      render: (r: BookingRow) => r.status !== "attended" ? (
        <div className="flex justify-end gap-1.5">
          <button type="button" aria-label={t("cls.attended")} onClick={() => void act(() => api.classes.setBookingStatus(r.id, "attended"))} className="grid size-8 place-items-center rounded-lg text-emerald hover:bg-white/5"><CheckCircle2 className="size-4" /></button>
          <button type="button" aria-label={t("cls.noShow")} onClick={() => void act(() => api.classes.setBookingStatus(r.id, "no_show"))} className="grid size-8 place-items-center rounded-lg text-amber hover:bg-white/5"><XCircle className="size-4" /></button>
          <button type="button" aria-label={t("cls.cancelBooking")} onClick={() => void act(() => api.classes.cancelBooking(r.id))} className="grid size-8 place-items-center rounded-lg text-red hover:bg-white/5"><XCircle className="size-4" /></button>
        </div>
      ) : null,
    }] : []),
  ];

  return (
    <Modal open onClose={onClose} title={`${session.className} — ${formatDateShort(new Date(`${session.sessionDate}T00:00:00`))}`} widthClass="max-w-lg">
      <div className="space-y-3">
        <div className="grid gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-[13px] sm:grid-cols-2">
          <span className="text-subtle">{t("cls.startTime")}: <b className="tabnum text-ink" dir="ltr">{session.startTime}</b></span>
          <span className="text-subtle">{t("cls.duration")}: <b className="tabnum text-ink">{session.durationMin}</b></span>
          {session.trainerName && <span className="text-subtle">{t("cls.trainerCol")}: <b className="text-ink">{session.trainerName}</b></span>}
          {session.location && <span className="text-subtle">{t("cls.location")}: <b className="text-ink">{session.location}</b></span>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          <span className="tabnum text-subtle">{t("cls.booked")}: <b className="text-ink">{session.bookedCount}</b> / {session.capacity}</span>
          <div className="flex flex-wrap gap-2">
            {canManage && session.status === "scheduled" && (
              <Button size="sm" variant="secondary" onClick={() => setConfirmAction("complete")}>{t("cls.completeSession")}</Button>
            )}
            {canManage && (session.status === "cancelled" ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirmAction("uncancel")}>
                <RotateCcw className="size-3.5" />
                {t("cls.uncancelSession")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmAction("cancel")}>{t("cls.cancelSession")}</Button>
            ))}
            {hasPermission("classes.checkin") && (
              <Button size="sm" variant="secondary" disabled={session.status !== "scheduled"} onClick={() => setPickerOpen(true)}>
                {t("cls.book")}
              </Button>
            )}
          </div>
        </div>

        {bookings.length === 0 ? <EmptyState icon={<CalendarDays />} title={t("cls.emptyBookings")} /> : <DataTable columns={columns} data={bookings} rowKey={(r) => r.id} />}
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
    </Modal>
  );
}