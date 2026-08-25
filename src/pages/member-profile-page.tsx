import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowRight,
  CalendarPlus,
  Camera,
  CreditCard,
  Dumbbell,
  Pencil,
  Plus,
  ScanLine,
  Scale,
  Undo2,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, rpc } from "@/api";
import type {
  PlanWithNames,
} from "@/core/services/training-plans.service";
import type { PublicTrainer } from "@/core/services/trainers.service";
import type { PublicMember } from "@/core/services/members.service";
import type { CardWithMember } from "@/core/services/cards.service";
import type { Subscription } from "@/core/services/subscriptions.service";
import type { PublicAssessment, ProgressComparison } from "@/api";

import { parseDateKey } from "@/core/dates";
import { formatMinor, toMinor } from "@/core/money";

import { formatDateShort, formatTime } from "@/services/format";
import { cardStatusMeta, memberStatusMeta, subStatusMeta } from "@/utils/status-meta";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { MemberFormModal } from "@/components/members/member-form-modal";
import { AssignCardModal } from "@/components/cards/assign-card-modal";
import { SubscriptionFormModal } from "@/components/subscriptions/subscription-form-modal";

const TAB_ITEMS = [
  { value: "cards", label: "" },
  { value: "subs", label: "" },
  { value: "attendance", label: "" },
  { value: "training", label: "" },
  { value: "inbody", label: "" },
];

const TAB_LABEL_KEYS: Record<string, string> = {
  cards: "members.tabCards",
  subs: "members.tabSubs",
  attendance: "members.tabAttendance",
  training: "members.tabTraining",
  inbody: "inbodyPage.title",
};

export function MemberProfilePage() {
  const t = useT();
  const { memberId = "" } = useParams();
  const navigate = useNavigate();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();

  const [member, setMember] = useState<PublicMember | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState("cards");
  const [editOpen, setEditOpen] = useState(false);
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    if (!actor) return;
    let alive = true;
    api.members
      .get(memberId)
      .then((m) => {
        if (alive) {
          setMember(m);
          setMissing(false);
          setTick((v) => v + 1);
        }
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    return () => {
      alive = false;
    };
  }, [actor, memberId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (missing) {
    return (
      <EmptyState
        icon={<ArrowRight className="rotate-180" />}
        title={t("errors.memberNotFound")}
        action={
          <Button variant="secondary" onClick={() => navigate("/members")}>
            {t("nav.members")}
          </Button>
        }
      />
    );
  }

  if (!member) {
    return <p className="py-16 text-center text-sm text-faint">{t("common.loading")}</p>;
  }

  const statusMeta = memberStatusMeta(t, member.status);
  const archived = member.status === "archived";

  const onArchive = async () => {
    if (!actor) return;
    setBusy(true);
    try {
      await api.members.setStatus(member.id, archived ? "active" : "archived");
      toast("success", t("toast.saved"));
      setArchiveOpen(false);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !actor) return;
    setPhotoBusy(true);
    try {
      const { id: fileId } = await api.files.upload("member_photo", file);
      await api.members.setMemberPhoto(member.id, fileId);
      toast("success", t("toast.saved"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onPhotoRemove = async () => {
    if (!actor) return;
    setPhotoBusy(true);
    try {
      await api.members.removeMemberPhoto(member.id);
      toast("success", t("toast.saved"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPhotoBusy(false);
    }
  };

  const tabs = TAB_ITEMS.map((item) => ({
    ...item,
    label: t(TAB_LABEL_KEYS[item.value] ?? item.value),
  }));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start gap-4 p-5">
          <div className="relative shrink-0">
            {member.photoFileId ? (
              <img
                src={api.files.url(member.photoFileId)}
                alt={member.fullName}
                className="size-20 rounded-xl object-cover"
              />
            ) : (
              <Avatar name={member.fullName} size="lg" />
            )}
            {hasPermission("members.edit") && (
              <div className="absolute -bottom-1 -left-1 flex gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={onPhotoUpload}
                />
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="grid size-7 place-items-center rounded-lg border border-line bg-card text-subtle transition-colors hover:text-ink disabled:opacity-50"
                >
                  <Camera className="size-3.5" />
                </button>
                {member.photoFileId && (
                  <button
                    type="button"
                    disabled={photoBusy}
                    onClick={onPhotoRemove}
                    className="grid size-7 place-items-center rounded-lg border border-line bg-card text-subtle transition-colors hover:text-red disabled:opacity-50"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-lg font-extrabold">{member.fullName}</h2>
              <Badge variant={statusMeta.variant} dot>
                {statusMeta.label}
              </Badge>
            </div>
            <p dir="ltr" className="mt-1 text-xs text-faint tabnum">
              {member.memberCode}
            </p>
            <dl className="mt-4 grid gap-x-8 gap-y-2.5 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
              <InfoRow label={t("common.phone")} value={member.phone ?? "—"} ltr />
              <InfoRow label={t("common.email")} value={member.email ?? "—"} ltr />
              <InfoRow
                label={t("members.gender")}
                value={member.gender ? t(`members.${member.gender}`) : "—"}
              />
              <InfoRow
                label={t("members.dob")}
                value={member.dateOfBirth ? formatDateShort(parseDateKey(member.dateOfBirth)) : "—"}
              />
              <InfoRow label={t("members.address")} value={member.address ?? "—"} />
              <InfoRow
                label={t("members.registeredAt")}
                value={formatDateShort(parseDateKey(member.registrationDate))}
              />
              <InfoRow
                label={t("members.department")}
                value={
                  member.department === "men"
                    ? t("members.deptMen")
                    : member.department === "women"
                      ? t("members.deptWomen")
                      : t("members.deptGeneral")
                }
              />
              <InfoRow
                label={t("members.formHeight")}
                value={member.heightCm == null ? "—" : `${member.heightCm}`}
                ltr
              />
              <InfoRow
                label={t("members.formWeight")}
                value={member.weightKg == null ? "—" : `${member.weightKg}`}
                ltr
              />
              <InfoRow
                label={t("members.formEmergencyName")}
                value={member.emergencyContactName ?? "—"}
              />
              <InfoRow
                label={t("members.formEmergencyPhone")}
                value={member.emergencyContactPhone ?? "—"}
                ltr
              />
            </dl>
            {member.notes && (
              <p className="mt-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] text-subtle">
                {member.notes}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/members"
              className="grid size-9 place-items-center rounded-xl border border-line text-subtle transition-colors hover:border-line-strong hover:text-ink"
              aria-label={t("nav.members")}
            >
              <ArrowRight className="size-4" />
            </Link>
            {!archived && hasPermission("members.edit") && (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                {t("common.edit")}
              </Button>
            )}
            {hasPermission("members.change_status") && (
              <Button variant={archived ? "primary" : "danger"} onClick={() => setArchiveOpen(true)}>
                {archived ? <Undo2 className="size-4" /> : <Archive className="size-4" />}
                {archived ? t("members.restoreMember") : t("members.archiveMember")}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {tab === "cards" && <MemberCardsTab member={member} version={tick} onAssign={() => setCardModalOpen(true)} />}
      {tab === "subs" && <MemberSubsTab member={member} version={tick} onAdd={() => setSubModalOpen(true)} />}
      {tab === "attendance" && <MemberAttendanceTab memberId={member.id} version={tick} />}
      {tab === "training" && <MemberTrainingTab member={member} version={tick} onChanged={reload} />}
      {tab === "inbody" && <MemberInBodyTab member={member} version={tick} />}

      <MemberFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={reload} member={member} />
      <AssignCardModal open={cardModalOpen} onClose={() => setCardModalOpen(false)} onDone={reload} presetMember={member} />
      <SubscriptionFormModal open={subModalOpen} onClose={() => setSubModalOpen(false)} onSaved={reload} presetMember={member} />

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title={archived ? t("members.restoreMember") : t("members.archiveMember")}
        message={archived ? t("members.activateMember") : t("members.archiveConfirmMsg")}
        tone={archived ? "primary" : "danger"}
        loading={busy}
        onConfirm={onArchive}
      />
    </div>
  );
}

function InfoRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="shrink-0 text-xs font-semibold text-faint">{label}</dt>
      <dd dir={ltr ? "ltr" : undefined} className="min-w-0 truncate font-semibold tabnum">
        {value}
      </dd>
    </div>
  );
}

function MemberCardsTab({
  member,
  version,
  onAssign,
}: {
  member: PublicMember;
  version: number;
  onAssign: () => void;
}) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const [cards, setCards] = useState<CardWithMember[]>([]);

  useEffect(() => {
    if (!actor || !hasPermission("cards.view")) return;
    let alive = true;
    api.cards
      .listForMember(member.id)
      .then((rows) => {
        if (alive) setCards(rows as CardWithMember[]);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, member.id, hasPermission, version]);

  interface Row {
    id: string;
    barcodeValue: string;
    status: CardWithMember["status"];
    assignedAt: string | null;
  }
  const rows: Row[] = cards.map((c) => ({
    id: c.id,
    barcodeValue: c.barcodeValue,
    status: c.status,
    assignedAt: c.assignedAt,
  }));

  const columns: Column<Row>[] = [
    {
      key: "barcode",
      header: t("cards.barcode"),
      render: (row) => (
        <span dir="ltr" className="font-mono font-bold tracking-wider">
          {row.barcodeValue}
        </span>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const meta = cardStatusMeta(t, row.status);
        return (
          <Badge variant={meta.variant} dot>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: "assigned",
      header: t("cards.assignedAt"),
      render: (row) =>
        row.assignedAt ? (
          <span className="tabnum text-subtle">{formatDateShort(parseDateKey(row.assignedAt.slice(0, 10)))}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title={t("members.tabCards")}
        action={
          member.status !== "archived" && hasPermission("cards.assign") ? (
            <Button onClick={onAssign}>
              <CreditCard className="size-4" />
              {t("cards.assign")}
            </Button>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<CreditCard />} title={t("members.noCards")} />
      ) : (
        <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
      )}
    </Card>
  );
}

function MemberSubsTab({
  member,
  version,
  onAdd,
}: {
  member: PublicMember;
  version: number;
  onAdd: () => void;
}) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [renewSub, setRenewSub] = useState<Subscription | null>(null);

  const reload = useCallback(() => {
    if (!actor) return;
    let alive = true;
    api.subscriptions
      .listForMember(member.id)
      .then((rows) => {
        if (alive) setSubs(rows);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, member.id]);

  useEffect(() => {
    reload();
  }, [reload, version]);

  // balances via backend
  const [balances, setBalances] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!actor || !hasPermission("payments.view") || subs.length === 0) return;
    let alive = true;
    void (async () => {
      const next: Record<string, number> = {};
      for (const s of subs) {
        try {
          next[s.id] = (await api.payments.subscriptionBalance(s.id)).remainingMinor;
        } catch {
          /* leave 0 */
        }
      }
      if (alive) setBalances(next);
    })();
    return () => {
      alive = false;
    };
  }, [actor, hasPermission, subs]);

  interface Row {
    id: string;
    planName: string;
    startDate: string;
    endDate: string;
    price: number;
    remainingMinor: number;
    effective: Parameters<typeof subStatusMeta>[1];
  }
  const today = new Date().toISOString().slice(0, 10);
  const rows: Row[] = subs.map((s) => {
    let eff: Row["effective"] = "expired";
    if (s.status === "suspended") eff = "suspended";
    else if (s.status === "cancelled") eff = "cancelled";
    else if (today < s.startDate) eff = "upcoming";
    else if (today >= s.startDate && today <= s.endDate) eff = "active";
    let remainingMinor = 0;
    remainingMinor = balances[s.id] ?? 0;
    return {
      id: s.id,
      planName: s.planName ?? "-",
      startDate: s.startDate,
      endDate: s.endDate,
      price: s.price,
      remainingMinor,
      effective: eff,
    };
  });

  const columns: Column<Row>[] = [
    {
      key: "plan",
      header: t("common.plan"),
      render: (row) => <span className="font-bold">{row.planName}</span>,
    },
    {
      key: "period",
      header: t("subs.period"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.startDate} ← {row.endDate}
        </span>
      ),
    },
    {
      key: "price",
      header: t("subs.pricePaid"),
      render: (row) => <span className="font-bold tabnum">{row.price}</span>,
    },
    ...(hasPermission("payments.view")
      ? [
          {
            key: "balance" as const,
            header: t("subs.balanceDue"),
            align: "end" as const,
            render: (row: Row) =>
              row.remainingMinor > 0 ? (
                <span className="font-bold tabnum text-amber">{formatMinor(row.remainingMinor)}</span>
              ) : (
                <span className="text-faint tabnum">0</span>
              ),
          },
        ]
      : []),
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const meta = subStatusMeta(t, row.effective);
        return (
          <div className="flex items-center gap-2">
            <Badge variant={meta.variant} dot>
              {meta.label}
            </Badge>
            {hasPermission("subscriptions.create") && (row.effective === "active" || row.effective === "expired") && (
              <Button size="sm" variant="secondary" onClick={() => {
                const original = subs.find((s) => s.id === row.id);
                if (original) setRenewSub(original);
              }}>
                {t("subs.renew")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader
        title={t("members.tabSubs")}
        action={
          hasPermission("subscriptions.create") && member.status !== "archived" ? (
            <Button onClick={onAdd}>
              <CalendarPlus className="size-4" />
              {t("subs.addSubscription")}
            </Button>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<CalendarPlus />} title={t("members.noSubs")} />
      ) : (
        <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
      )}
      {renewSub && (
        <RenewModal
          sub={renewSub}
          open
          onClose={() => setRenewSub(null)}
          onDone={() => {
            setRenewSub(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function RenewModal({
  sub,
  open,
  onClose,
  onDone,
}: {
  sub: Subscription;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [priceMajor, setPriceMajor] = useState(String(sub.price));
  const [methodCode, setMethodCode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      const numPrice = Number(priceMajor);
      const hasPrice = priceMajor.trim() !== "" && Number.isFinite(numPrice) && numPrice > 0;
      const result = await api.subscriptions.renew(sub.id, {
        price: hasPrice ? numPrice : undefined,
        notes: notes || null,
      });
      if (hasPrice) {
        await api.payments.record({
          memberId: sub.memberId,
          subscriptionId: result.next.id,
          baseAmountMinor: toMinor(numPrice),
          paidAmountMinor: toMinor(numPrice),
          methodCode,
          notes: notes || null,
        });
      }
      toast("success", t("toast.saved"));
      onDone();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("subs.renewTitle")} widthClass="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
        className="space-y-3.5"
      >
        <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px]">
          <p className="font-bold">{sub.planName}</p>
          <p dir="ltr" className="mt-0.5 text-faint tabnum">{sub.startDate} ← {sub.endDate}</p>
        </div>
        <Input
          label={`${t("subs.pricePaid")} (ج.م)`}
          type="number"
          dir="ltr"
          min={0}
          step="0.01"
          value={priceMajor}
          onChange={(e) => setPriceMajor(e.target.value)}
          disabled={submitting}
        />
        <Select
          label={t("store.method")}
          value={methodCode}
          onChange={(e) => setMethodCode(e.target.value)}
          options={[
            { value: "cash", label: "نقدي" },
            { value: "bank_card", label: "بطاقة بنكية" },
            { value: "transfer", label: "تحويل / محفظة" },
            { value: "other", label: "أخرى" },
          ]}
          disabled={submitting}
        />
        <Input label={t("members.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={submitting} disabled={submitting}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MemberAttendanceTab({ memberId, version }: { memberId: string; version: number }) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const [rows, setRows] = useState<{ checkin_at: string }[]>([]);
  const canView = hasPermission("checkin.view_history");

  useEffect(() => {
    if (!actor || !canView) return;
    let alive = true;
    api.attendance
      .forMember(memberId, 30)
      .then((items) => {
        if (alive)
          setRows(
            (items as Array<{ checkin_at: string }>).map((i) => ({ checkin_at: i.checkin_at })),
          );
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, memberId, canView, version]);

  if (!canView) {
    return (
      <Card>
        <EmptyState icon={<ScanLine />} title={t("errors.forbidden")} />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={t("members.tabAttendance")} />
      {rows.length === 0 ? (
        <EmptyState icon={<ScanLine />} title={t("members.attendanceEmpty")} />
      ) : (
        <ul className="divide-y divide-line px-5 pb-4">
          {rows.map((row, index) => (
            <li key={`${row.checkin_at}-${index}`} className="flex items-center justify-between py-2.5 text-sm">
              <span dir="ltr" className="font-semibold tabnum">
                {formatDateShort(new Date(row.checkin_at))}
              </span>
              <span dir="ltr" className="text-faint tabnum">
                {formatTime(new Date(row.checkin_at))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MemberTrainingTab({
  member,
  version,
  onChanged,
}: {
  member: PublicMember;
  version: number;
  onChanged: () => void;
}) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [plans, setPlans] = useState<PlanWithNames[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const canView = hasPermission("members.view");
  const canManage = hasPermission("training.manage");

  const reload = useCallback(() => {
    if (!actor || !canView) return;
    let alive = true;
    api.trainingPlans
      .list({ memberId: member.id, limit: 50 })
      .then((result) => {
        if (alive) setPlans(result.items as unknown as PlanWithNames[]);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, canView, member.id]);

  useEffect(() => {
    reload();
  }, [reload, version]);

  const onTransition = async (planId: string, kind: "end" | "cancel") => {
    if (!actor) return;
    try {
      if (kind === "end") await api.trainingPlans.end(planId);
      else await api.trainingPlans.cancel(planId);
      toast("success", t("trainers.planStatusToast"));
      reload();
      onChanged();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  return (
    <Card>
      <CardHeader
        title={t("members.tabTraining")}
        action={
          canManage && member.status !== "archived" ? (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="size-4" />
              {t("trainers.planAdd")}
            </Button>
          ) : undefined
        }
      />
      {plans.length === 0 ? (
        <EmptyState icon={<Dumbbell />} title={t("trainers.plansEmptyTitle")} description={t("trainers.plansEmptyDesc")} />
      ) : (
        <ul className="divide-y divide-line px-5 pb-4">
          {plans.map((plan) => (
            <li key={plan.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{plan.trainerName}</span>
                <span dir="ltr" className="block text-[11px] tabnum text-faint">
                  {plan.startDate} → {plan.endDate}
                </span>
              </span>
              {plan.notes && (
                <span className="max-w-xs truncate rounded-lg bg-surface px-2.5 py-1 text-[12px] text-subtle">
                  {plan.notes}
                </span>
              )}
              <Badge
                variant={plan.status === "active" ? "success" : plan.status === "ended" ? "info" : "neutral"}
              >
                {t(`trainers.plan_${plan.status}`)}
              </Badge>
              {canManage && plan.status === "active" && (
                <span className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => void onTransition(plan.id, "end")}>
                    {t("trainers.planEnd")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void onTransition(plan.id, "cancel")}>
                    {t("common.cancel")}
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <TrainingPlanFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        member={member}
        onSaved={() => {
          setFormOpen(false);
          reload();
          onChanged();
        }}
      />
    </Card>
  );
}

function MemberInBodyTab({
  member,
  version,
}: {
  member: PublicMember;
  version: number;
}) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [assessments, setAssessments] = useState<PublicAssessment[]>([]);
  const [progress, setProgress] = useState<ProgressComparison | null>(null);
  const [showForm, setShowForm] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const [assessmentDate, setAssessmentDate] = useState(today);
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [bodyFatPercent, setBodyFatPercent] = useState("");
  const [muscleMassKg, setMuscleMassKg] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [chestCm, setChestCm] = useState("");
  const [armCm, setArmCm] = useState("");
  const [thighCm, setThighCm] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!actor) return;
    let alive = true;
    void (async () => {
      try {
        const items = await api.inbody.list(member.id, 100);
        if (alive) setAssessments(items);
      } catch {
        /* ignore */
      }
      try {
        const p = await api.inbody.progress(member.id);
        if (alive) setProgress(p);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [actor, member.id]);

  useEffect(() => {
    reload();
  }, [reload, version]);

  const resetForm = () => {
    setAssessmentDate(today);
    setHeightCm("");
    setWeightKg("");
    setBodyFatPercent("");
    setMuscleMassKg("");
    setWaistCm("");
    setChestCm("");
    setArmCm("");
    setThighCm("");
    setNotes("");
    setError(null);
  };

  const onSubmit = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.inbody.createAssessment({
        memberId: member.id,
        assessmentDate,
        heightCm: heightCm ? Number(heightCm) : null,
        weightKg: weightKg ? Number(weightKg) : null,
        bodyFatPercent: bodyFatPercent ? Number(bodyFatPercent) : null,
        muscleMassKg: muscleMassKg ? Number(muscleMassKg) : null,
        waistCm: waistCm ? Number(waistCm) : null,
        chestCm: chestCm ? Number(chestCm) : null,
        armCm: armCm ? Number(armCm) : null,
        thighCm: thighCm ? Number(thighCm) : null,
        notes: notes || null,
      });
      toast("success", t("toast.saved"));
      resetForm();
      setShowForm(false);
      reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const sorted = [...assessments].sort((a, b) => b.assessmentDate.localeCompare(a.assessmentDate));

  const deltaWeight = progress?.deltas.find((d) => d.field === "weightKg");
  const deltaBmi = progress?.deltas.find((d) => d.field === "bmi");
  const deltaBodyFat = progress?.deltas.find((d) => d.field === "bodyFatPercent");

  const hasDeltas = progress && progress.latest && progress.previous;

  interface AssessRow {
    id: string;
    assessmentDate: string;
    weightKg: number | null;
    bmi: number | null;
    bodyFatPercent: number | null;
    muscleMassKg: number | null;
    notes: string | null;
  }

  const tableRows: AssessRow[] = sorted.map((a) => ({
    id: a.id,
    assessmentDate: a.assessmentDate,
    weightKg: a.weightKg,
    bmi: a.bmi,
    bodyFatPercent: a.bodyFatPercent,
    muscleMassKg: a.muscleMassKg,
    notes: a.notes,
  }));

  const assessCols: Column<AssessRow>[] = [
    {
      key: "date",
      header: t("common.date"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.assessmentDate}
        </span>
      ),
    },
    {
      key: "weight",
      header: t("members.formWeight"),
      render: (row) => <span className="tabnum">{row.weightKg ?? "—"}</span>,
    },
    {
      key: "bmi",
      header: "BMI",
      render: (row) => <span className="tabnum">{row.bmi ?? "—"}</span>,
    },
    {
      key: "bodyFat",
      header: t("inbody.bodyFat"),
      render: (row) => <span className="tabnum">{row.bodyFatPercent != null ? `${row.bodyFatPercent}%` : "—"}</span>,
    },
    {
      key: "muscleMass",
      header: t("inbody.muscleMass"),
      render: (row) => <span className="tabnum">{row.muscleMassKg ?? "—"}</span>,
    },
    {
      key: "notes",
      header: t("members.notes"),
      render: (row) => <span className="truncate text-faint">{row.notes ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {hasDeltas && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <div className="p-4 text-center">
              <p className="text-xs font-semibold text-faint">{t("members.formWeight")}</p>
              <p className="mt-1 text-lg font-extrabold tabnum">{deltaWeight?.delta != null ? `${deltaWeight.delta > 0 ? "+" : ""}${deltaWeight.delta.toFixed(1)}` : "—"}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4 text-center">
              <p className="text-xs font-semibold text-faint">BMI</p>
              <p className="mt-1 text-lg font-extrabold tabnum">{deltaBmi?.delta != null ? `${deltaBmi.delta > 0 ? "+" : ""}${deltaBmi.delta.toFixed(1)}` : "—"}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4 text-center">
              <p className="text-xs font-semibold text-faint">{t("inbody.bodyFat")}</p>
              <p className="mt-1 text-lg font-extrabold tabnum">{deltaBodyFat?.delta != null ? `${deltaBodyFat.delta > 0 ? "+" : ""}${deltaBodyFat.delta.toFixed(1)}%` : "—"}</p>
            </div>
          </Card>
        </div>
      )}

      {hasPermission("assessments.manage") && member.status !== "archived" && (
        <Card>
          <CardHeader
            title={t("inbody.addAssessment")}
            action={
              <Button variant="secondary" onClick={() => { setShowForm(!showForm); resetForm(); }}>
                <Plus className="size-4" />
                {showForm ? t("common.cancel") : t("inbody.addAssessment")}
              </Button>
            }
          />
          {showForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void onSubmit();
              }}
              noValidate
              className="space-y-3.5 px-5 pb-5"
            >
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Input label={t("common.date")} type="date" dir="ltr" value={assessmentDate} onChange={(e) => setAssessmentDate(e.target.value)} disabled={submitting} />
                <Input label={t("members.formHeight")} type="number" dir="ltr" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} disabled={submitting} />
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Input label={t("members.formWeight")} type="number" dir="ltr" step="0.1" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} disabled={submitting} />
                <Input label={t("inbody.bodyFat")} type="number" dir="ltr" step="0.1" value={bodyFatPercent} onChange={(e) => setBodyFatPercent(e.target.value)} disabled={submitting} />
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Input label={t("inbody.muscleMass")} type="number" dir="ltr" step="0.1" value={muscleMassKg} onChange={(e) => setMuscleMassKg(e.target.value)} disabled={submitting} />
                <Input label={t("inbody.waist")} type="number" dir="ltr" step="0.1" value={waistCm} onChange={(e) => setWaistCm(e.target.value)} disabled={submitting} />
              </div>
              <div className="grid gap-3.5 sm:grid-cols-3">
                <Input label={t("inbody.chest")} type="number" dir="ltr" step="0.1" value={chestCm} onChange={(e) => setChestCm(e.target.value)} disabled={submitting} />
                <Input label={t("inbody.arm")} type="number" dir="ltr" step="0.1" value={armCm} onChange={(e) => setArmCm(e.target.value)} disabled={submitting} />
                <Input label={t("inbody.thigh")} type="number" dir="ltr" step="0.1" value={thighCm} onChange={(e) => setThighCm(e.target.value)} disabled={submitting} />
              </div>
              <Input label={t("members.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
              {error && (
                <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button type="submit" loading={submitting} disabled={submitting}>
                  {t("common.save")}
                </Button>
                <Button variant="secondary" onClick={() => { setShowForm(false); resetForm(); }} disabled={submitting}>
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title={t("inbody.history")} />
        {tableRows.length === 0 ? (
          <EmptyState icon={<Scale />} title={t("inbody.empty")} />
        ) : (
          <DataTable columns={assessCols} data={tableRows} rowKey={(r) => r.id} />
        )}
      </Card>
    </div>
  );
}

function TrainingPlanFormModal({
  open,
  onClose,
  member,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  member: PublicMember;
  onSaved: () => void;
}) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [trainerOptions, setTrainerOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [trainerId, setTrainerId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !actor) return;
    let alive = true;
    api.trainers
      .list({ activeOnly: true })
      .then((trainers) => {
        if (!alive) return;
        const options = (trainers as PublicTrainer[]).map((tr) => ({
          value: tr.id,
          label: tr.fullName,
        }));
        setTrainerOptions(options);
        setTrainerId(options[0]?.value ?? "");
      })
      .catch((err) => console.error(err));
    setStartDate(today);
    setEndDate("");
    setNotes("");
    setError(null);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      await rpc("trainingPlans", "createTrainingPlan", [{
        memberId: member.id,
        trainerId,
        startDate,
        endDate,
        notes: notes || null,
      } as never]);
      toast("success", t("trainers.savedToast"));
      onSaved();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("trainers.planAddTitle", { name: member.fullName })} widthClass="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
        className="space-y-3.5"
      >
        <Select
          label={t("nav.trainers")}
          value={trainerId}
          onChange={(e) => setTrainerId(e.target.value)}
          options={trainerOptions}
          disabled={submitting}
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input label={t("rpt.from")} type="date" dir="ltr" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={submitting} />
          <Input label={t("rpt.to")} type="date" dir="ltr" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={submitting} />
        </div>
        <Input label={t("members.notes")} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={submitting} />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" loading={submitting} disabled={submitting || trainerOptions.length === 0}>
            {t("common.save")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
