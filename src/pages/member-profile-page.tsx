import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowRight,
  CalendarPlus,
  CalendarX2,
  Camera,
  CreditCard,
  Dumbbell,
  Info,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  ScanLine,
  Scale,
  Snowflake,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, rpc } from "@/api";
import type { FreezeInfo } from "@/api";
import type {
  PlanWithNames,
} from "@/core/services/training-plans.service";
import type { PublicTrainer } from "@/core/services/trainers.service";
import type { PublicMember } from "@/core/services/members.service";
import type { CardWithMember } from "@/core/services/cards.service";
import type { Subscription } from "@/core/services/subscriptions.service";
import type { PublicAssessment, ProgressComparison } from "@/api";

import { parseDateKey, diffDaysKeys, todayKey } from "@/core/dates";
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

/** Live outstanding balances (gym subscriptions + store debts) for the profile header. */
function OutstandingStrip({ memberId, version }: { memberId: string; version: number }) {
  const t = useT();
  const [data, setData] = useState<{ subscriptionsMinor: number; storeMinor: number; totalMinor: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.finance
      .outstandingForMember(memberId)
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) { setData(null); setFailed(true); } });
    return () => { alive = false; };
  }, [memberId, version, attempt]);

  if (failed) {
    return (
      <Card className="border-amber/30 bg-amber/[0.05]">
        <div className="flex items-center justify-between px-5 py-3">
          <span className="text-sm font-bold text-amber">{t("members.outstandingError")}</span>
          <Button size="sm" variant="secondary" onClick={() => setAttempt((a) => a + 1)}>
            {t("health.rerun")}
          </Button>
        </div>
      </Card>
    );
  }

  if (!data || data.totalMinor === 0) {
    return (
      <Card className="border-emerald/25 bg-emerald/[0.04]">
        <div className="px-5 py-3 text-sm font-bold text-emerald">✓ {t("members.noOutstanding")}</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        <Stat title={t("members.outstandingSubs")} minor={data.subscriptionsMinor} />
        <Stat title={t("members.outstandingStore")} minor={data.storeMinor} />
        <Stat title={t("members.outstandingTotal")} minor={data.totalMinor} highlight />
      </div>
    </Card>
  );
}

function Stat({ title, minor, highlight }: { title: string; minor: number; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-faint">{title}</p>
      <p dir="ltr" className={highlight ? "text-lg font-extrabold tabnum text-red" : "font-bold tabnum text-ink"}>
        {formatMinor(minor)}
      </p>
    </div>
  );
}

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

      <OutstandingStrip memberId={member.id} version={tick} />

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
  const { toast } = useToast();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [renewSub, setRenewSub] = useState<Subscription | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Subscription | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<Subscription | null>(null);
  const [freezeHistory, setFreezeHistory] = useState<FreezeInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const doPurge = async () => {
    if (!purgeTarget) return;
    setBusy(true);
    try {
      await api.subscriptions.purge(purgeTarget.id);
      toast("success", t("subs.purgedToast"));
      setPurgeTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    try {
      await api.subscriptions.setStatus(cancelTarget.id, "cancelled");
      toast("success", t("subs.cancelledToast"));
      setCancelTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const doSuspendToggle = async (sub: Subscription) => {
    const next = sub.status === "suspended" ? "active" : "suspended";
    try {
      await api.subscriptions.setStatus(sub.id, next);
      toast("success", next === "suspended" ? t("subs.suspendedToast") : t("subs.resumedToast"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const doFreeze = async (sub: Subscription) => {
    try {
      await api.subscriptions.freeze(sub.id);
      toast("success", t("subs.suspendedToast"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

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
  const [balances, setBalances] = useState<Record<string, { paidMinor: number; discountedMinor: number; remainingMinor: number }>>({});
  useEffect(() => {
    if (!actor || !hasPermission("payments.view") || subs.length === 0) return;
    let alive = true;
    void (async () => {
      const next: Record<string, { paidMinor: number; discountedMinor: number; remainingMinor: number }> = {};
      for (const s of subs) {
        try {
          const b = await api.payments.subscriptionBalance(s.id);
          next[s.id] = { paidMinor: b.paidMinor, discountedMinor: b.discountedMinor, remainingMinor: b.remainingMinor };
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

  useEffect(() => {
    if (!detailsTarget) { setFreezeHistory([]); return; }
    let alive = true;
    api.subscriptions.freezes(detailsTarget.id).then((rows) => { if (alive) setFreezeHistory(rows); }).catch(() => { if (alive) setFreezeHistory([]); });
    return () => { alive = false; };
  }, [detailsTarget]);

  interface Row {
    id: string;
    planName: string;
    startDate: string;
    endDate: string;
    price: number;
    remainingMinor: number;
    discountMinor: number;
    paidMinor: number;
    effective: Parameters<typeof subStatusMeta>[1];
    totalDays: number;
    remainingDays: number;
    frozenDays: number;
    subscription: Subscription;
  }
  const today = todayKey();
  const rows: Row[] = subs.map((s) => {
    let eff: Row["effective"] = "expired";
    if (s.status === "suspended") eff = "suspended";
    else if (s.status === "cancelled") eff = "cancelled";
    else if (today < s.startDate) eff = "upcoming";
    else if (today >= s.startDate && today <= s.endDate) eff = "active";
    let remainingMinor = 0;
    remainingMinor = balances[s.id]?.remainingMinor ?? 0;
    const totalDays = diffDaysKeys(s.startDate, s.endDate) + 1;
    const remainingDays = eff === "active" ? Math.max(0, diffDaysKeys(today, s.endDate) + 1) : eff === "expired" ? 0 : totalDays;
    return {
      id: s.id,
      planName: s.planName ?? "-",
      startDate: s.startDate,
      endDate: s.endDate,
      price: s.price,
      remainingMinor,
      discountMinor: balances[s.id]?.discountedMinor ?? 0,
      paidMinor: balances[s.id]?.paidMinor ?? 0,
      effective: eff,
      totalDays,
      remainingDays,
      frozenDays: s.frozenDays,
      subscription: s,
    };
  });

  const filteredRows = statusFilter === "all" ? rows : rows.filter((r) => r.effective === statusFilter);

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
      header: t("subs.price"),
      render: (row) => <span className="font-bold tabnum">{row.price}</span>,
    },
    {
      key: "totalDays",
      header: t("subs.totalDays"),
      render: (row) => <span className="tabnum text-subtle">{row.totalDays} {t("subs.daysUnit")}</span>,
    },
    {
      key: "remainingDays",
      header: t("subs.remainingDays"),
      render: (row) => {
        if (row.effective === "expired" || row.effective === "cancelled") {
          return <span className="text-faint tabnum">—</span>;
        }
        const color = row.remainingDays <= 7 ? "text-red" : row.remainingDays <= 14 ? "text-amber" : "text-neon";
        return <span className={`font-bold tabnum ${color}`}>{row.remainingDays} {t("subs.daysUnit")}</span>;
      },
    },
    ...(hasPermission("payments.view")
      ? [
          {
            key: "discount" as const,
            header: t("subs.discount"),
            align: "end" as const,
            render: (row: Row) =>
              row.discountMinor > 0 ? (
                <span className="font-bold tabnum text-amber">{formatMinor(row.discountMinor)}</span>
              ) : (
                <span className="text-faint tabnum">—</span>
              ),
          },
          {
            key: "paid" as const,
            header: t("subs.paidAmount"),
            align: "end" as const,
            render: (row: Row) => (
              <span className="tabnum text-subtle">{formatMinor(row.paidMinor)}</span>
            ),
          },
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
          {
            key: "frozenDays" as const,
            header: t("subs.frozenDaysCount"),
            align: "end" as const,
            render: (row: Row) =>
              row.frozenDays > 0 ? (
                <span className="tabnum text-cyan flex items-center gap-1">
                  <Snowflake className="size-3" />
                  {row.frozenDays} {t("subs.daysUnit")}
                </span>
              ) : (
                <span className="text-faint tabnum">—</span>
              ),
          },
        ]
      : []),
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const meta = subStatusMeta(t, row.effective);
        const original = subs.find((s) => s.id === row.id);
        return (
          <div className="flex items-center gap-2">
            <Badge variant={meta.variant} dot>
              {meta.label}
            </Badge>
            <button
              type="button"
              aria-label={t("subs.details")}
              onClick={() => { if (original) setDetailsTarget(original); }}
              className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
              title={t("subs.details")}
            >
              <Info className="size-3.5" />
            </button>
            {hasPermission("subscriptions.edit") && row.effective === "frozen" && (
              <button
                type="button"
                aria-label={t("subs.unfreeze")}
                onClick={() => { if (original) void api.subscriptions.unfreeze(original.id).then(() => { toast("success", t("subs.unfrozenToast")); reload(); }).catch((err) => toast("error", describeError(err, t))); }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-cyan/10 hover:text-cyan"
                title={t("subs.unfreeze")}
              >
                <PlayCircle className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.edit") && row.effective === "suspended" && (
              <button
                type="button"
                aria-label={t("subs.resumeSub")}
                onClick={() => { if (original) void doSuspendToggle(original); }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
                title={t("subs.resumeSub")}
              >
                <PlayCircle className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.edit") && row.effective === "active" && (
              <button
                type="button"
                aria-label={t("subs.suspendSub")}
                onClick={() => { if (original) void doSuspendToggle(original); }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
                title={t("subs.suspendSub")}
              >
                <PauseCircle className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.cancel") && row.effective === "active" && (
              <button
                type="button"
                aria-label={t("subs.cancelSub")}
                onClick={() => { if (original) setCancelTarget(original); }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-red/10 hover:text-red"
                title={t("subs.cancelSub")}
              >
                <CalendarX2 className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.freeze") && row.effective === "active" && (
              <button
                type="button"
                aria-label={t("subs.suspendSub")}
                onClick={() => { if (original) void doFreeze(original); }}
                className="grid size-7 place-items-center rounded-lg text-faint transition-colors hover:bg-cyan/10 hover:text-cyan"
                title={t("subs.suspendSub")}
              >
                <Snowflake className="size-3.5" />
              </button>
            )}
            {hasPermission("subscriptions.create") && (row.effective === "active" || row.effective === "expired") && (
              <Button size="sm" variant="secondary" onClick={() => { if (original) setRenewSub(original); }}>
                {t("subs.renew")}
              </Button>
            )}
            {hasPermission("subscriptions.purge") && (
              <Button size="sm" variant="ghost" className="text-red hover:text-red"
                title={t("subs.purgeAction")}
                onClick={() => { if (original) setPurgeTarget(original); }}>
                <Trash2 className="size-3.5" />
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
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "all", label: t("subs.filterAll") },
                { value: "active", label: t("subs.filterActive") },
                { value: "upcoming", label: t("subs.filterUpcoming") },
                { value: "expired", label: t("subs.filterExpired") },
                { value: "suspended", label: t("subs.filterSuspended") },
                { value: "frozen", label: t("status.frozen") },
                { value: "cancelled", label: t("subs.filterCancelled") },
              ]}
            />
            {hasPermission("subscriptions.create") && member.status !== "archived" && (
              <Button onClick={onAdd}>
                <CalendarPlus className="size-4" />
                {t("subs.addSubscription")}
              </Button>
            )}
          </div>
        }
      />
      {filteredRows.length === 0 ? (
        <EmptyState icon={<CalendarPlus />} title={t("members.noSubs")} />
      ) : (
        <DataTable columns={columns} data={filteredRows} rowKey={(r) => r.id} />
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

      <ConfirmDialog
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title={t("subs.purgeConfirmTitle")}
        message={purgeTarget ? `${purgeTarget.planName} · ${purgeTarget.startDate} → ${purgeTarget.endDate} — ${t("subs.purgeConfirmMsg")}` : ""}
        confirmLabel={t("subs.purgeAction")}
        onConfirm={() => void doPurge()}
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={t("subs.cancelSub")}
        message={t("subs.cancelMsg")}
        loading={busy}
        onConfirm={() => void doCancel()}
      />

      <Modal
        open={detailsTarget !== null}
        onClose={() => setDetailsTarget(null)}
        title={t("subs.detailsTitle")}
        widthClass="max-w-lg"
      >
        {detailsTarget && (() => {
          const sub = detailsTarget;
          const totalDays = diffDaysKeys(sub.startDate, sub.endDate) + 1;
          const remainingDays = diffDaysKeys(today, sub.endDate) + 1;
          let eff: "active" | "expired" | "upcoming" | "cancelled" | "suspended" = "expired";
          if (sub.status === "suspended") eff = "suspended";
          else if (sub.status === "cancelled") eff = "cancelled";
          else if (today < sub.startDate) eff = "upcoming";
          else if (today >= sub.startDate && today <= sub.endDate) eff = "active";
          return (
            <div className="space-y-4">
              <div className="rounded-lg bg-white/5 p-3 text-sm space-y-2">
                <div className="flex justify-between"><span className="text-subtle">{t("common.plan")}</span><span className="font-bold">{sub.planName}</span></div>
                <div className="flex justify-between"><span className="text-subtle">{t("subs.period")}</span><span dir="ltr" className="tabnum">{sub.startDate} → {sub.endDate}</span></div>
                <div className="flex justify-between"><span className="text-subtle">{t("subs.totalDays")}</span><span className="tabnum">{totalDays} {t("subs.daysUnit")}</span></div>
                {eff === "active" && (
                  <div className="flex justify-between">
                    <span className="text-subtle">{t("subs.remainingDays")}</span>
                    <span className={`font-bold tabnum ${remainingDays <= 7 ? "text-red" : remainingDays <= 14 ? "text-amber" : "text-neon"}`}>{remainingDays} {t("subs.daysUnit")}</span>
                  </div>
                )}
                {sub.frozenDays > 0 && (
                  <div className="flex justify-between"><span className="text-subtle">{t("subs.frozenDaysCount")}</span><span className="tabnum text-cyan flex items-center gap-1"><Snowflake className="size-3" />{sub.frozenDays} {t("subs.daysUnit")}</span></div>
                )}
                <div className="flex justify-between"><span className="text-subtle">{t("common.status")}</span><Badge variant={subStatusMeta(t, eff).variant} dot>{subStatusMeta(t, eff).label}</Badge></div>
              </div>

              <div>
                <h4 className="text-sm font-bold mb-2 flex items-center gap-2"><Snowflake className="size-4 text-cyan" />{t("subs.freezeHistory")}</h4>
                {freezeHistory.length === 0 ? (
                  <p className="text-sm text-faint">{t("subs.freezeHistoryEmpty")}</p>
                ) : (
                  <div className="space-y-2">
                    {freezeHistory.map((f) => {
                      const isExpired = eff === "expired" || eff === "cancelled";
                      const resumeDate = f.actualResumeDate ?? (isExpired ? sub.endDate : f.expectedResumeDate) ?? null;
                      return (
                      <div key={f.id} className="rounded-lg bg-white/5 p-3 text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-subtle">{t("subs.freezeFrom")}</span>
                          <span className="tabnum">{f.frozenAt.slice(0, 10)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-subtle">{t("subs.freezeTo")}</span>
                          <span className="tabnum">{resumeDate ?? t("subs.freezeNotResumed")}</span>
                        </div>
                        {resumeDate && (
                          <div className="flex justify-between">
                            <span className="text-subtle">{t("subs.freezeDuration")}</span>
                            <span className="tabnum">{diffDaysKeys(f.frozenAt.slice(0, 10), resumeDate) + 1} {t("subs.daysUnit")}</span>
                          </div>
                        )}
                        {f.reason && (
                          <div className="flex justify-between">
                            <span className="text-subtle">{t("subs.freezeReason")}</span>
                            <span className="text-subtle text-xs">{f.reason}</span>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>
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
  const { toast } = useToast();
  const [rows, setRows] = useState<{ id: string; checkin_at: string }[]>([]);
  const canView = hasPermission("checkin.view_history");
  const canDelete = hasPermission("checkin.delete");

  useEffect(() => {
    if (!actor || !canView) return;
    let alive = true;
    api.attendance
      .forMember(memberId, 30)
      .then((items) => {
        if (alive)
          setRows(
            (items as Array<{ id: string; checkin_at: string }>).map((i) => ({ id: i.id, checkin_at: i.checkin_at })),
          );
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, memberId, canView, version]);

  async function handleDelete(attendanceId: string) {
    try {
      await api.attendance.delete(attendanceId);
      setRows((prev) => prev.filter((r) => r.id !== attendanceId));
      toast("success", t("members.attendanceDeleted"));
    } catch (e) {
      toast("error", describeError(e, t));
    }
  }

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
              <div className="flex items-center gap-3">
                <span dir="ltr" className="text-faint tabnum">
                  {formatTime(new Date(row.checkin_at))}
                </span>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(row.id)}
                    className="text-faint hover:text-red transition-colors"
                    title={t("common.delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
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
  const today = todayKey();

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
  const today = todayKey();

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
