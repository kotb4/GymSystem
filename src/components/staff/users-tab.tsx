import { useCallback, useEffect, useState } from "react";
import { KeyRound, UserCog, UserPlus, MoreHorizontal, Pencil, Power, Download } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type PublicUser } from "@/api";
import { parseDateKey, todayKey } from "@/core/dates";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dropdown, DropdownDivider, DropdownItem } from "@/components/ui/dropdown";
import { UserFormModal } from "@/components/users/user-form-modal";
import { ResetPasswordModal } from "@/components/users/reset-password-modal";
import { downloadCsvWithBom } from "@/utils/csv-helper";

export function UsersTab() {
  const t = useT();
  const { actor, user: currentUser, hasPermission } = useAuth();
  const { toast } = useToast();

  const [users, setUsers] = useState<PublicUser[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicUser | null>(null);
  const [resetTarget, setResetTarget] = useState<PublicUser | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<PublicUser | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!actor) return;
    void api.users.list().then(setUsers);
    try {
    } catch (err) {
      console.error(err);
    }
  }, [actor]);

  useEffect(() => {
    reload();
  }, [reload]);

  const onToggleActive = async () => {
    if (!actor || !deactivateTarget) return;
    setBusy(true);
    try {
      await api.users.setActive(deactivateTarget.id, !deactivateTarget.isActive);
      toast("success", t("users.statusToast"));
      setDeactivateTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onActivate = async (target: PublicUser) => {
    if (!actor) return;
    try {
      await api.users.setActive(target.id, true);
      toast("success", t("users.statusToast"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const onExportUsers = () => {
    if (users.length === 0) {
      toast("info", t("users.empty"));
      return;
    }
    const headers = [
      "كود الموظف",
      t("users.fullName"),
      t("users.username"),
      t("users.role"),
      t("users.activeCol"),
      t("users.createdAt"),
    ];
    const dataRows = users.map((u) => [
      u.userCode ?? "—",
      u.fullName,
      u.username,
      t(`roles.${u.roleId}`) || u.roleId,
      u.isActive ? t("status.active") : t("status.inactive"),
      u.createdAt.slice(0, 10),
    ]);
    downloadCsvWithBom(`قائمة_المستخدمين_${todayKey()}`, headers, dataRows);
    toast("success", t("users.exportSuccess"));
  };

  interface Row {
    id: string;
    username: string;
    fullName: string;
    roleId: PublicUser["roleId"];
    isActive: boolean;
    createdAtKey: string;
    userCode: string | null;
  }

  const rows: Row[] = users.map((u) => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    roleId: u.roleId,
    isActive: u.isActive,
    createdAtKey: u.createdAt.slice(0, 10),
    userCode: u.userCode ?? null,
  }));

  const columns: Column<Row>[] = [
    {
      key: "user",
      header: t("users.username"),
      render: (row) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={row.fullName} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-bold">
              {row.fullName}
              {currentUser?.id === row.id && (
                <span className="ms-2 rounded-full bg-neon/10 px-2 py-0.5 text-[10px] font-bold text-neon">
                  {t("users.you")}
                </span>
              )}
            </span>
            <span dir="ltr" className="block text-[11px] text-faint">
              {row.username}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "userCode",
      header: "كود الموظف",
      render: (row) =>
        row.userCode ? (
          <span dir="ltr" className="inline-block rounded-md bg-white/5 border border-line/40 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan">
            {row.userCode}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "role",
      header: t("users.role"),
      render: (row) => <Badge variant={row.roleId === "owner" ? "violet" : "info"}>{t(`roles.${row.roleId}`)}</Badge>,
    },
    {
      key: "active",
      header: t("users.activeCol"),
      render: (row) => (
        <Badge variant={row.isActive ? "success" : "neutral"} dot>
          {row.isActive ? t("status.active") : t("status.inactive")}
        </Badge>
      ),
    },
    {
      key: "created",
      header: t("users.createdAt"),
      render: (row) => (
        <span className="tabnum text-subtle">{formatDateShort(parseDateKey(row.createdAtKey))}</span>
      ),
    },
  ];

  if (hasPermission("users.manage")) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) => {
        const original = users.find((u) => u.id === row.id);
        if (!original) return null;
        const isSelf = original.id === currentUser?.id;
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
                setEditTarget(original);
                setFormOpen(true);
              }}
            />
            <DropdownItem
              icon={<KeyRound />}
              label={t("users.resetPassword")}
              onClick={() => setResetTarget(original)}
            />
            {!isSelf && (
              <>
                <DropdownDivider />
                <DropdownItem
                  icon={<Power />}
                  label={original.isActive ? t("users.deactivateAction") : t("users.activateAction")}
                  danger={original.isActive}
                  onClick={() => {
                    if (original.isActive) setDeactivateTarget(original);
                    else void onActivate(original);
                  }}
                />
              </>
            )}
          </Dropdown>
        );
      },
    });
  }

  return (
    <>
      <Card>
        <CardHeader
          title={t("nav.users")}
          action={
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onExportUsers}>
                <Download className="size-3.5" />
                {t("users.exportUsers")}
              </Button>
              {hasPermission("users.manage") && (
                <Button
                  onClick={() => {
                    setEditTarget(null);
                    setFormOpen(true);
                  }}
                >
                  <UserPlus className="size-4" />
                  {t("users.addUser")}
                </Button>
              )}
            </div>
          }
        />
        {rows.length === 0 ? (
          <EmptyState icon={<UserCog />} title={t("users.empty")} />
        ) : (
          <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
        )}
      </Card>

      <UserFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
        user={editTarget}
      />

      <ResetPasswordModal open={resetTarget !== null} onClose={() => setResetTarget(null)} target={resetTarget} />

      <ConfirmDialog
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title={t("users.deactivateAction")}
        message={t("users.deactivateConfirm")}
        loading={busy}
        onConfirm={() => void onToggleActive()}
      />
    </>
  );
}
