import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArchiveRestore, FileSpreadsheet, MessageSquare, Pencil, Trash2, UserPlus, UsersRound } from "lucide-react";
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
import { cn } from "@/utils/cn";
import { Card } from "@/components/ui/card";
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
import { MemberImportModal } from "@/components/members/member-import-modal";
import { QuickWhatsAppModal } from "@/components/messages/quick-whatsapp-modal";
import { BranchBadge } from "@/components/ui/branch-badge";

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
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicMember | null>(null);
  const [confirmKind, setConfirmKind] = useState<"restore" | "purge" | "trash" | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<TrashedMemberInfo | PublicMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [whatsAppMemberId, setWhatsAppMemberId] = useState<string | null>(null);
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
    branchId?: string | null;
  }

  const rows: Row[] = data.items.map((m) => ({
    id: m.id,
    code: m.memberCode,
    fullName: m.fullName,
    phone: m.phone ?? "—",
    createdAtKey: m.registrationDate,
    status: m.status,
    branchId: m.branchId,
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
        <div className="flex items-center gap-1.5" dir="ltr">
          <span className="tabnum text-subtle">{row.phone}</span>
          {row.phone !== "—" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setWhatsAppMemberId(row.id);
              }}
              className="inline-flex size-5 items-center justify-center rounded bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
              title={t("messages.quickWhatsAppTitle")}
            >
              <MessageSquare className="size-3" />
            </button>
          )}
        </div>
      ),
    },
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <BranchBadge branchId={row.branchId} />,
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
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between border-b border-line">
          <div>
            <h2 className="text-xl font-black text-ink tracking-wide">{t("nav.members")}</h2>
            <p className="mt-0.5 text-xs text-subtle">{t("members.count", { count: formatNumber(data.total) })}</p>
          </div>
          {hasPermission("members.create") && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setImportModalOpen(true)}
              >
                <FileSpreadsheet className="size-4 text-emerald-400" />
                {t("members.importBtn")}
              </Button>
              <Button
                onClick={() => {
                  setEditTarget(null);
                  setFormOpen(true);
                }}
                className="shadow-glow-sm"
              >
                <UserPlus className="size-4" />
                {t("members.addMember")}
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between bg-surface/40">
          <div className="flex flex-wrap items-center gap-2">
            {!trashMode && (
              <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-line bg-surface/90 p-1">
                {STATUS_OPTIONS.map((s) => {
                  const active = status === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setStatus(s);
                        setPage(1);
                      }}
                      className={cn(
                        "rounded-lg px-3.5 py-1 text-xs font-bold transition-all",
                        active ? "bg-primary text-white shadow-glow-sm" : "text-subtle hover:bg-white/[0.05] hover:text-ink"
                      )}
                    >
                      {s === "all" ? t("common.all") : t(`status.${s}`)}
                    </button>
                  );
                })}
              </div>
            )}
            {hasPermission("members.restore") && (
              <Button
                variant={trashMode ? "primary" : "secondary"}
                size="sm"
                onClick={() => {
                  setTrashMode((v) => !v);
                  setPage(1);
                }}
              >
                <Trash2 className="size-3.5" />
                {t("members.trashTab")}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-72">
              <SearchInput value={term} onValueChange={setTerm} placeholder={t("members.searchPh")} />
            </div>
            {!trashMode && (
              <div className="w-full sm:w-48">
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
            )}
          </div>
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

      <MemberImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportComplete={reload}
      />

      {whatsAppMemberId && (
        <QuickWhatsAppModal
          open={Boolean(whatsAppMemberId)}
          onClose={() => setWhatsAppMemberId(null)}
          memberId={whatsAppMemberId}
        />
      )}
    </div>
  );
}
