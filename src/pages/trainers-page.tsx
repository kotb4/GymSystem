import { useCallback, useEffect, useState } from "react";
import { Dumbbell, MoreHorizontal, Pencil, Plus, Power, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PlanWithNames, type PublicTrainer } from "@/api";
import { formatDateShort } from "@/services/format";
import { parseDateKey, todayKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";
import { Tabs } from "@/components/ui/tabs";

interface TrainerRowModel {
  id: string;
  fullName: string;
  phone: string | null;
  specialization: string | null;
  joinedDate: string;
  isActive: boolean;
  activePlans: number;
}

export function TrainersPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("trainers.manage");

  const [tab, setTab] = useState("trainers");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<TrainerRowModel[]>([]);
  const [plans, setPlans] = useState<PlanWithNames[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicTrainer | null>(null);
  const [toggleTarget, setToggleTarget] = useState<PublicTrainer | null>(null);
  const [planAction, setPlanAction] = useState<{ plan: PlanWithNames; kind: "end" | "cancel" } | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<PlanWithNames | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!actor || !hasPermission("trainers.view")) return;
    let alive = true;
    void api.trainers
      .list({ search: search.trim() || undefined })
      .then((trainers) => {
        if (!alive) return;
        setRows(
          trainers.map((tr) => ({
            id: tr.id,
            fullName: tr.fullName,
            phone: tr.phone,
            specialization: tr.specialization,
            joinedDate: tr.joinedDate,
            isActive: tr.isActive,
            activePlans: (tr as unknown as { activePlans?: number }).activePlans ?? 0,
          })),
        );
      })
      .catch((err) => console.error(err));
    api.trainingPlans
      .list({ limit: 100 })
      .then((r) => {
        if (alive) setPlans(r.items as unknown as PlanWithNames[]);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, [actor, hasPermission, search]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onToggleActive = async () => {
    if (!actor || !toggleTarget) return;
    setBusy(true);
    try {
      await api.trainers.setActive(toggleTarget.id, !toggleTarget.isActive);
      toast("success", t("trainers.statusToast"));
      setToggleTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onPlanTransition = async () => {
    if (!actor || !planAction) return;
    setBusy(true);
    try {
      if (planAction.kind === "end") {
        await api.trainingPlans.end(planAction.plan.id);
      } else {
        await api.trainingPlans.cancel(planAction.plan.id);
      }
      toast("success", t("trainers.planStatusToast"));
      setPlanAction(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<TrainerRowModel>[] = [
    {
      key: "trainer",
      header: t("common.name"),
      render: (row) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={row.fullName} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-bold">{row.fullName}</span>
            <span dir="ltr" className="block text-[11px] text-faint">
              {row.phone ?? "—"}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "specialization",
      header: t("trainers.specialization"),
      render: (row) => <span className="text-subtle">{row.specialization ?? "—"}</span>,
    },
    {
      key: "joined",
      header: t("trainers.joined"),
      render: (row) => (
        <span className="tabnum text-subtle">{formatDateShort(parseDateKey(row.joinedDate))}</span>
      ),
    },
    {
      key: "plans",
      header: t("trainers.activePlans"),
      render: (row) => <span className="font-bold tabnum">{t("rpt.count", { count: row.activePlans })}</span>,
    },
    {
      key: "status",
      header: t("users.activeCol"),
      render: (row) => (
        <Badge variant={row.isActive ? "success" : "neutral"} dot>
          {row.isActive ? t("status.active") : t("status.inactive")}
        </Badge>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) => {
        const original = rows.find((tr) => tr.id === row.id);
        if (!original) return null;
        const model: PublicTrainer = {
          id: original.id,
          fullName: original.fullName,
          phone: original.phone,
          email: null,
          specialization: original.specialization,
          joinedDate: original.joinedDate,
          isActive: original.isActive,
          notes: null,
        };
        return (
          <Dropdown
            align="end"
            trigger={
              <button
                type="button"
                aria-label={t("common.actions")}
                className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
              >
                <MoreHorizontal className="size-4" />
              </button>
            }
          >
            <DropdownItem
              icon={<Pencil />}
              label={t("common.edit")}
              onClick={() => {
                setEditTarget(model);
                setFormOpen(true);
              }}
            />
            <DropdownDivider />
            <DropdownItem
              icon={<Power />}
              label={original.isActive ? t("trainers.deactivate") : t("trainers.activate")}
              danger={original.isActive}
              onClick={() => setToggleTarget(model)}
            />
          </Dropdown>
        );
      },
    });
  }

  const planColumns: Column<PlanWithNames>[] = [
    {
      key: "member",
      header: t("common.member"),
      render: (row) => (
        <span>
          <span className="block font-bold">{row.memberName}</span>
          <span dir="ltr" className="block text-[11px] text-faint">{row.memberCode}</span>
        </span>
      ),
    },
    {
      key: "trainer",
      header: t("nav.trainers"),
      render: (row) => <span className="text-subtle">{row.trainerName}</span>,
    },
    {
      key: "range",
      header: t("trainers.planRange"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.startDate} → {row.endDate}
        </span>
      ),
    },
    {
      key: "status",
      header: t("status.title"),
      render: (row) => (
        <Badge
          variant={
            row.status === "active" ? "success" : row.status === "ended" ? "info" : "neutral"
          }
        >
          {t(`trainers.plan_${row.status}`)}
        </Badge>
      ),
    },
  ];

  if (canManage) {
    planColumns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) =>
        row.status === "active" ? (
          <Dropdown
            align="end"
            trigger={
              <button
                type="button"
                aria-label={t("common.actions")}
                className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
              >
                <MoreHorizontal className="size-4" />
              </button>
            }
          >
            <DropdownItem
              label={t("trainers.planEnd")}
              onClick={() => setPlanAction({ plan: row, kind: "end" })}
            />
            <DropdownDivider />
            <DropdownItem
              label={t("trainers.planCancel")}
              danger
              onClick={() => setPlanAction({ plan: row, kind: "cancel" })}
            />
          </Dropdown>
        ) : (row.status === "cancelled" || row.status === "ended") && row.endDate >= todayKey() ? (
          <button
            type="button"
            aria-label={t("trainers.planReactivate")}
            onClick={() => setReactivateTarget(row)}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
          >
            <RotateCcw className="size-4" />
          </button>
        ) : null,
    });
  }

  const tabs = [
    { value: "trainers", label: t("trainers.tabTrainers") },
    { value: "plans", label: t("trainers.tabPlans") },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs items={tabs} value={tab} onChange={setTab} />
        <div className="flex flex-1 items-center justify-end gap-2">
          {tab === "trainers" && (
            <>
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder={t("trainers.searchPlaceholder")}
                className="max-w-xs"
              />
              {canManage && (
                <Button
                  onClick={() => {
                    setEditTarget(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  {t("trainers.add")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {tab === "trainers" ? (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Dumbbell aria-hidden className="size-4 text-neon" />
                {t("nav.trainers")}
              </span>
            }
          />
          {rows.length === 0 ? (
            <EmptyState
              icon={<Dumbbell />}
              title={t("trainers.emptyTitle")}
              description={t("trainers.emptyDesc")}
            />
          ) : (
            <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title={t("trainers.tabPlans")} />
          {plans.length === 0 ? (
            <EmptyState
              icon={<Dumbbell />}
              title={t("trainers.plansEmptyTitle")}
              description={t("trainers.plansEmptyDesc")}
            />
          ) : (
            <DataTable columns={planColumns} data={plans} rowKey={(r) => r.id} />
          )}
        </Card>
      )}

      <TrainerFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        target={editTarget}
        onSaved={() => {
          setFormOpen(false);
          reload();
        }}
      />

      <ConfirmDialog
        open={toggleTarget !== null}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => void onToggleActive()}
        title={
          toggleTarget?.isActive
            ? t("trainers.deactivateTitle", { name: toggleTarget.fullName })
            : t("trainers.activateTitle", { name: toggleTarget?.fullName ?? "" })
        }
        message={
          toggleTarget?.isActive
            ? t("trainers.deactivateMessage", { name: toggleTarget.fullName })
            : t("trainers.activateMessage")
        }
        confirmLabel={t(toggleTarget?.isActive ? "trainers.deactivate" : "trainers.activate")}
        loading={busy}
        tone={toggleTarget?.isActive ? "danger" : "primary"}
      />

      <ConfirmDialog
        open={planAction !== null}
        onClose={() => setPlanAction(null)}
        onConfirm={() => void onPlanTransition()}
        title={t(
          planAction?.kind === "end" ? "trainers.planEndTitle" : "trainers.planCancelTitle",
        )}
        message={t(
          planAction?.kind === "end" ? "trainers.planEndMessage" : "trainers.planCancelMessage",
          { member: planAction?.plan.memberName ?? "" },
        )}
        confirmLabel={t(planAction?.kind === "end" ? "trainers.planEnd" : "trainers.planCancel")}
        loading={busy}
        tone={planAction?.kind === "cancel" ? "danger" : "primary"}
      />

      <ConfirmDialog
        open={reactivateTarget !== null}
        onClose={() => setReactivateTarget(null)}
        onConfirm={async () => {
          if (!actor || !reactivateTarget) return;
          setBusy(true);
          try {
            await api.trainingPlans.reactivate(reactivateTarget.id);
            toast("success", t("trainers.planReactivatedToast"));
            setReactivateTarget(null);
            reload();
          } catch (err) {
            toast("error", describeError(err, t));
          } finally {
            setBusy(false);
          }
        }}
        title={t("trainers.planReactivate")}
        message={t("trainers.planReactivateConfirmMsg")}
        confirmLabel={t("trainers.planReactivate")}
        loading={busy}
      />
    </div>
  );
}

function TrainerFormModal(props: {
  open: boolean;
  onClose: () => void;
  target: PublicTrainer | null;
  onSaved: () => void;
}) {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [joinedDate, setJoinedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setError(null);
    setFullName(props.target?.fullName ?? "");
    setPhone(props.target?.phone ?? "");
    setEmail(props.target?.email ?? "");
    setSpecialization(props.target?.specialization ?? "");
    setJoinedDate(props.target?.joinedDate ?? todayKey());
    setNotes(props.target?.notes ?? "");
  }, [props.open, props.target]);

  const onSubmit = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        fullName,
        phone: phone || null,
        email: email || null,
        specialization: specialization || null,
        joinedDate,
        notes: notes || null,
      };
      if (props.target) {
        await api.trainers.update(props.target.id, input);
      } else {
        await api.trainers.create(input);
      }
      toast("success", t("trainers.savedToast"));
      props.onSaved();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.target ? t("trainers.editTitle") : t("trainers.addTitle")}
      widthClass="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void onSubmit()} loading={submitting} disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
      >
        <Input
          label={t("common.name")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          disabled={submitting}
        />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label={t("members.phone")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            disabled={submitting}
          />
          <Input
            label={t("users.email")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
            disabled={submitting}
          />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label={t("trainers.specialization")}
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
            disabled={submitting}
          />
          <Input
            label={t("trainers.joined")}
            type="date"
            value={joinedDate}
            onChange={(e) => setJoinedDate(e.target.value)}
            dir="ltr"
            disabled={submitting}
          />
        </div>
        <Input
          label={t("members.notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
