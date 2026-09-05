import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArchiveRestore, Pencil, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { appConfig } from "@/config/app.config";
import { api } from "@/api";
import type {
  MemberStatus,
  PublicMember,
  SmartFilter,
  TrashedMemberInfo,
} from "@/core/services/members.service";
import { parseDateKey } from "@/core/dates";
import { formatDateShort, formatNumber } from "@/services/format";
import { memberStatusMeta } from "@/utils/status-meta";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { MemberFormModal } from "@/components/members/member-form-modal";

const STATUS_OPTIONS = ["all", "active", "inactive", "archived"] as const;

const SMART_OPTIONS: Array<SmartFilter> = [
  "all",
  "active",
  "expired",
  "frozen",
  "renewed",
  "birthday",
  "inactive",
  "sessions_low",
  "outstanding",
];

export function MembersPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [smart, setSmart] = useState<SmartFilter>("all");
  const [trashMode, setTrashMode] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: PublicMember[]; total: number }>({ items: [], total: 0 });
  const [trashed, setTrashed] = useState<TrashedMemberInfo[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicMember | null>(null);
  const [confirmKind, setConfirmKind] = useState<"restore" | "purge" | "trash" | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<TrashedMemberInfo | PublicMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((v) => v + 1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(term.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    void (async () => {
      try {
        if (trashMode) {
          const rows = await api.members.listTrashed();
          if (alive) setTrashed(rows);
          return;
        }
        const inactiveDays = await api.settings.inactiveDays();
        const result = await api.members.list({
          search: debounced || undefined,
          status: status as MemberStatus | "all",
          smart,
          inactiveDays,
          page,
          pageSize: appConfig.pageSize,
        });
        if (alive) setData(result);
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      alive = false;
    };
  }, [actor, debounced, status, smart, trashMode, page, reloadTick]);

  useEffect(() => {
    if (searchParams.get("add") === "1" && hasPermission("members.create")) {
      setEditTarget(null);
      setFormOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, hasPermission, setSearchParams]);

  interface Row {
    id: string;
    code: string;
    fullName: string;
    phone: string;
    createdAtKey: string;
    status: PublicMember["status"];
  }

  const rows: Row[] = data.items.map((m) => ({
    id: m.id,
    code: m.memberCode,
    fullName: m.fullName,
    phone: m.phone ?? "—",
    createdAtKey: m.registrationDate,
    status: m.status,
  }));

  const columns: Column<Row>[] = [
    {
      key: "code",
      header: t("members.code"),
      render: (row) => (
        <span dir="ltr" className="font-semibold text-subtle tabnum">
          {row.code}
        </span>
      ),
    },
    {
      key: "name",
      header: t("members.name"),
      render: (row) => (
        <Link to={`/members/${row.id}`} className="flex items-center gap-2.5">
          <Avatar name={row.fullName} size="sm" />
          <span className="font-bold hover:text-neon">{row.fullName}</span>
        </Link>
      ),
    },
    {
      key: "phone",
      header: t("common.phone"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.phone}
        </span>
      ),
    },
    {
      key: "created",
      header: t("members.registeredAt"),
      render: (row) => (
        <span className="tabnum text-subtle">{formatDateShort(parseDateKey(row.createdAtKey))}</span>
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => {
        const meta = memberStatusMeta(t, row.status);
        return (
          <Badge variant={meta.variant} dot>
            {meta.label}
          </Badge>
        );
      },
    },
  ];

  if (hasPermission("members.edit") && !trashMode) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) => {
        const target = data.items.find((m) => m.id === row.id);
        if (!target || target.status === "archived") return null;
        return (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              aria-label={t("common.edit")}
              onClick={() => {
                setEditTarget(target);
                setFormOpen(true);
              }}
              className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-subtle"
            >
              <Pencil className="size-4" />
            </button>
            {hasPermission("members.delete") && (
              <button
                type="button"
                aria-label={t("members.trashAction")}
                onClick={() => {
                  setConfirmTarget(target);
                  setConfirmKind("trash");
                }}
                className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-red"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        );
      },
    });
  }

  const trashColumns: Column<TrashedMemberInfo>[] = [
    {
      key: "code",
      header: t("members.code"),
      render: (row) => (
        <span dir="ltr" className="font-semibold text-subtle tabnum">
          {row.memberCode}
        </span>
      ),
    },
    {
      key: "name",
      header: t("members.name"),
      render: (row) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={row.fullName} size="sm" />
          <span className="font-bold">{row.fullName}</span>
        </span>
      ),
    },
    {
      key: "deletedBy",
      header: t("members.colDeletedBy"),
      render: (row) => <span className="text-subtle">{row.deletedBy ?? "—"}</span>,
    },
    {
      key: "reason",
      header: t("members.colDeleteReason"),
      render: (row) => <span className="text-subtle">{row.deletionReason ?? "—"}</span>,
    },
  ];

  if (hasPermission("members.restore")) {
    trashColumns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={t("members.restoreAction")}
            onClick={() => {
              setConfirmTarget(row);
              setConfirmKind("restore");
            }}
            className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-neon"
          >
            <ArchiveRestore className="size-4" />
          </button>
          {hasPermission("members.purge") && (
            <button
              type="button"
              aria-label={t("members.purgeAction")}
              onClick={() => {
                setConfirmTarget(row);
                setConfirmKind("purge");
              }}
              className="grid size-8 place-items-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-red"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      ),
    });
  }

  const runConfirm = async () => {
    if (!confirmTarget || !confirmKind) return;
    setBusy(true);
    try {
      if (confirmKind === "restore") {
        await api.members.restore(confirmTarget.id);
        toast("success", t("members.restoredToast"));
      } else if (confirmKind === "purge") {
        // Pre-destructive snapshot: a backup of the current state is taken
        // before the irreversible purge. Best-effort — a snapshot failure must
        // not block the denial-of-service check the user explicitly confirmed.
        try {
          await api.backup.createPrePurgeSnapshot();
        } catch {
          /* snapshot is best-effort; purge proceeds */
        }
        await api.members.purge(confirmTarget.id);
        toast("success", t("members.purgedToast"));
      } else {
        await api.members.trash(confirmTarget.id, null);
        toast("success", t("members.trashedToast"));
        setTrashMode(false);
      }
      setConfirmKind(null);
      setConfirmTarget(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("nav.members")}
          action={
            hasPermission("members.create") ? (
              <Button
                onClick={() => {
                  setEditTarget(null);
                  setFormOpen(true);
                }}
              >
                <UserPlus className="size-4" />
                {t("members.addMember")}
              </Button>
            ) : undefined
          }
        />
        <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center">
          <div className="sm:w-80">
            <SearchInput value={term} onValueChange={setTerm} placeholder={t("members.searchPh")} />
          </div>
          {!trashMode && (
            <>
              <div className="sm:w-44">
                <Select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                  options={STATUS_OPTIONS.map((s) => ({
                    value: s,
                    label: s === "all" ? t("common.all") : t(`status.${s}`),
                  }))}
                />
              </div>
              <div className="sm:w-52">
                <Select
                  value={smart}
                  onChange={(e) => {
                    setSmart(e.target.value as SmartFilter);
                    setPage(1);
                  }}
                  options={SMART_OPTIONS.map((s) => ({
                    value: s,
                    label:
                      s === "all"
                        ? `${t("members.filterSmart")}: ${t("common.all")}`
                        : t(
                            [
                              "active",
                              "expired",
                              "frozen",
                              "renewed",
                              "birthday",
                              "inactive",
                              "outstanding",
                            ].includes(s)
                              ? `members.smart${s.charAt(0).toUpperCase()}${s.slice(1)}`
                              : s === "sessions_low"
                                ? "members.smartSessionsLow"
                                : "common.all",
                          ),
                  }))}
                />
              </div>
            </>
          )}
          {hasPermission("members.restore") && (
            <Button
              variant={trashMode ? "primary" : "secondary"}
              className="sm:ms-auto"
              onClick={() => {
                setTrashMode((v) => !v);
                setPage(1);
              }}
            >
              <Trash2 className="size-4" />
              {t("members.trashTab")}
            </Button>
          )}
          {!trashMode && (
            <p className={`text-xs font-semibold text-faint tabnum ${hasPermission("members.restore") ? "" : "sm:ms-auto"}`}>
              {t("members.count", { count: formatNumber(data.total) })}
            </p>
          )}
        </div>

        {trashMode ? (
          trashed.length === 0 ? (
            <EmptyState icon={<Trash2 />} title={t("members.trashEmpty")} />
          ) : (
            <DataTable columns={trashColumns} data={trashed} rowKey={(r) => r.id} />
          )
        ) : rows.length === 0 ? (
          <EmptyState icon={<UsersRound />} title={t("members.emptyTitle")} description={t("members.emptyDesc")} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
            <div className="border-t border-line px-5 py-3.5">
              <Pagination
                page={page}
                pageSize={appConfig.pageSize}
                total={data.total}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmKind !== null}
        onClose={() => setConfirmKind(null)}
        title={
          confirmKind === "restore"
            ? t("members.restoreAction")
            : confirmKind === "purge"
              ? t("members.purgeAction")
              : t("members.trashAction")
        }
        message={
          confirmKind === "restore"
            ? t("members.restoreConfirmMsg")
            : confirmKind === "purge"
              ? t("members.purgeConfirmMsg")
              : t("members.trashConfirmMsg")
        }
        tone={confirmKind === "purge" ? "danger" : "primary"}
        loading={busy}
        onConfirm={() => void runConfirm()}
      />

      <MemberFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
        member={editTarget}
      />
    </div>
  );
}
