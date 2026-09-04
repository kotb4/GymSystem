import { useCallback, useEffect, useState } from "react";
import { Dumbbell, MoreHorizontal, Pencil, Plus, Power } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicTrainer } from "@/api";
import { formatDateShort } from "@/services/format";
import { parseDateKey } from "@/core/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";
import { SearchInput } from "@/components/ui/search-input";
import { TrainerFormModal } from "./trainer-form-modal";

interface TrainerRowModel {
  id: string;
  fullName: string;
  phone: string | null;
  specialization: string | null;
  joinedDate: string;
  isActive: boolean;
  activePlans: number;
}

export function TrainersTab() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("trainers.manage");

  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<TrainerRowModel[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicTrainer | null>(null);
  const [toggleTarget, setToggleTarget] = useState<PublicTrainer | null>(null);
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

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Dumbbell aria-hidden className="size-4 text-neon" />
            {t("cls.tabTrainers")}
          </span>
        }
        action={
          canManage && (
            <Button
              onClick={() => {
                setEditTarget(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("trainers.add")}
            </Button>
          )
        }
      />
      <div className="px-5 pb-1">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={t("trainers.searchPlaceholder")}
          className="w-full sm:w-96"
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Dumbbell />}
          title={t("trainers.emptyTitle")}
          description={t("trainers.emptyDesc")}
        />
      ) : (
        <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
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
    </Card>
  );
}