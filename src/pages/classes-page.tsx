import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { CalendarDays, CalendarPlus, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ClassSession, type GymClass, type BookingRow } from "@/api";
import { todayKey } from "@/core/dates";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

export function ClassesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [classesList, setClassesList] = useState<GymClass[]>([]);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [classModal, setClassModal] = useState<{ open: boolean; target: GymClass | null }>({ open: false, target: null });
  const [sessionModalFor, setSessionModalFor] = useState<GymClass | null>(null);
  const [details, setDetails] = useState<ClassSession | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ClassSession | null>(null);
  const [uncancelTarget, setUncancelTarget] = useState<ClassSession | null>(null);
  const canManage = hasPermission("classes.manage");

  const reload = useCallback(() => {
    api.classes.list({}).then(setClassesList).catch(console.error);
    api.classes.listSessions({ fromDate: todayKey(), status: "scheduled", limit: 60 }).then(setSessions).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const columns: Column<ClassSession>[] = [
    { key: "date", header: t("common.date"), render: (r) => (
      <button type="button" className="text-start hover:text-neon" onClick={() => setDetails(r)}>
        <span className="block font-bold">{formatDateShort(new Date(`${r.sessionDate}T00:00:00`))}</span>
        <span dir="ltr" className="block text-[11px] text-faint tabnum">{r.startTime} · {r.durationMin}m</span>
      </button>
    ) },
    { key: "name", header: t("cls.className"), render: (r) => (
      <span><span className="block font-bold">{r.className}</span>{r.trainerName && <span className="block text-[11px] text-faint">{r.trainerName}</span>}</span>
    ) },
    { key: "cap", header: t("cls.capacity"), render: (r) => {
      const full = r.bookedCount >= r.capacity;
      return <Badge variant={full ? "danger" : r.bookedCount / r.capacity > 0.7 ? "warning" : "success"} dot>{r.bookedCount}/{r.capacity}</Badge>;
    } },
    ...(canManage ? [{
      key: "actions", header: "", align: "end" as const,
      render: (r: ClassSession) => (
        <div className="flex justify-end gap-1.5">
          {r.status !== "cancelled" && <Button size="sm" variant="secondary" onClick={() => void doComplete(r)}>{t("cls.completeSession")}</Button>}
          {r.status === "cancelled" ? (
            <Button size="sm" variant="ghost" onClick={() => setUncancelTarget(r)}>
              <RotateCcw className="size-3.5" />
              {t("cls.uncancelSession")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setCancelTarget(r)}>{t("cls.cancelSession")}</Button>
          )}
        </div>
      ),
    }] : []),
  ];

  const doComplete = async (s: ClassSession) => {
    try {
      await api.classes.completeSession(s.id);
      toast("success", t("toast.saved"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("cls.title")}
          action={canManage ? (
            <Button onClick={() => setClassModal({ open: true, target: null })}>{t("cls.newClass")}</Button>
          ) : undefined}
        />
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {classesList.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-panel p-4">
              <p className="font-extrabold">{c.name}</p>
              <p className="mt-1 text-[11px] text-faint">{c.trainerName ?? "—"} · {c.location ?? "—"}</p>
              <p className="mt-2 flex items-center gap-2 text-[12px]">
                <Badge variant={c.consumesSession ? "info" : "neutral"}>{c.consumesSession ? t("cls.consumesSession") : t("common.all")}</Badge>
                <span className="tabnum text-subtle">{t("cls.capacity")}: {c.capacity}</span>
              </p>
              {canManage && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setSessionModalFor(c)}>{t("cls.addSession")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setClassModal({ open: true, target: c })}>{t("common.edit")}</Button>
                </div>
              )}
            </div>
          ))}
          {classesList.length === 0 && <EmptyState icon={<CalendarDays />} title={t("cls.emptySessions")} />}
        </div>
      </Card>

      <Card>
        <CardHeader title={t("nav.classes")} />
        {sessions.length === 0 ? (
          <EmptyState icon={<CalendarPlus />} title={t("cls.emptySessions")} />
        ) : (
          <DataTable columns={columns} data={sessions} rowKey={(r) => r.id} />
        )}
      </Card>

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
      {details && (
        <SessionDetailsModal
          session={details}
          onChanged={() => { reload(); }}
          onClose={() => setDetails(null)}
        />
      )}
      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={t("cls.cancelSession")}
        message={cancelTarget ? `${cancelTarget.className} — ${formatDateShort(new Date(`${cancelTarget.sessionDate}T00:00:00`))}` : ""}
        confirmLabel={t("common.confirm")}
        loading={false}
        onConfirm={() => {
          if (!cancelTarget) return;
          api.classes.cancelSession(cancelTarget.id, "-").then(() => {
            toast("success", t("toast.saved"));
            setCancelTarget(null);
            reload();
          }).catch((err) => toast("error", describeError(err, t)));
        }}
      />
      <ConfirmDialog
        open={uncancelTarget !== null}
        onClose={() => setUncancelTarget(null)}
        title={t("cls.uncancelSession")}
        message={t("cls.uncancelSessionConfirmMsg")}
        confirmLabel={t("common.confirm")}
        loading={false}
        onConfirm={() => {
          if (!uncancelTarget) return;
          api.classes.uncancelSession(uncancelTarget.id).then(() => {
            toast("success", t("cls.sessionUncancelledToast"));
            setUncancelTarget(null);
            reload();
          }).catch((err) => toast("error", describeError(err, t)));
        }}
      />
    </div>
  );
}

function ClassFormModal({ target, onClose, onSaved }: { target: GymClass | null; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const trainers = api.trainers;
  const [trainersList, setTrainersList] = useState<Array<{ id: string; fullName: string }>>([]);
  const [form, setForm] = useState({
    name: target?.name ?? "",
    trainerId: target?.trainerId ?? "",
    location: target?.location ?? "",
    capacity: String(target?.capacity ?? 15),
    consumesSession: target?.consumesSession ?? false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!actor) return;
    trainers.list().then((list) =>
      setTrainersList(list.map((tr) => ({ id: tr.id, fullName: tr.fullName }))),
    ).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
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
        <Select label={t("cls.trainerCol")} value={form.trainerId} onChange={(e) => setForm((f) => ({ ...f, trainerId: e.target.value }))} options={[
          { value: "", label: "—" }, ...trainersList.map((tr) => ({ value: tr.id, label: tr.fullName })),
        ]} />
        <Input label={t("cls.location")} value={form.location} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, location: e.target.value }))} />
        <Input label={t("cls.capacity")} type="number" min={1} dir="ltr" value={form.capacity} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
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

function SessionDetailsModal({ session, onClose, onChanged }: { session: ClassSession; onChanged: () => void; onClose: () => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    } dot>{t(`cls.booking${r.status.charAt(0).toUpperCase()}${r.status.slice(1).replace("_show", "_Show")}`)}</Badge> },
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
        <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          <span className="tabnum text-subtle">{t("cls.booked")}: <b className="text-ink">{session.bookedCount}</b> / {session.capacity}</span>
          {hasPermission("classes.view") && (
            <Button size="sm" variant="secondary" disabled={!hasPermission("classes.checkin")} onClick={() => setPickerOpen(true)}>
              {t("cls.book")}
            </Button>
          )}
        </div>
        {bookings.length === 0 ? <EmptyState icon={<CalendarDays />} title={t("members.noSubs")} /> : <DataTable columns={columns} data={bookings} rowKey={(r) => r.id} />}
      </div>
      <MemberPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m) => {
          setPickerOpen(false);
          void act(async () => api.classes.book({ sessionId: session.id, memberId: m.id }));
        }}
      />
    </Modal>
  );
}
