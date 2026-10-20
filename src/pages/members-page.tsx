import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArchiveRestore,
  FileSpreadsheet,
  MessageSquare,
  Pencil,
  Trash2,
  UserPlus,
  UsersRound,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useDebounce } from "@/hooks/use-debounce";
import { useT } from "@/i18n";
import { appConfig } from "@/config/app.config";
import { api } from "@/api";
import type {
  MemberStatus,
  PublicMember,
  SmartFilter,
  TrashedMemberInfo,
} from "@/core/services/members.service";
import type { DepartmentScope } from "@/core/permissions";
import { parseDateKey } from "@/core/dates";
import { formatDateShort, formatNumber } from "@/services/format";
import { memberStatusMeta } from "@/utils/status-meta";
import { cn } from "@/utils/cn";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
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
import { PageHeader } from "@/components/ui/page-header";

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
  const debounced = useDebounce(term.trim(), 250);
  const [status, setStatus] = useState<string>("all");
  const [smart, setSmart] = useState<SmartFilter>("all");
  const [deptFilter, setDeptFilter] = useState<"all" | DepartmentScope>("all");
  const [trashMode, setTrashMode] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: PublicMember[]; total: number }>({ items: [], total: 0 });
  const [kpiStats, setKpiStats] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    expiring: 0,
    archived: 0,
  });
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

  const canViewAllDepts =
    actor?.roleId === "owner" ||
    hasPermission("members.view_all_departments") ||
    !actor?.department ||
    actor?.department === "general";

  const deptOptions: Array<{ value: "all" | DepartmentScope; label: string }> = useMemo(() => {
    return [
      { value: "all", label: "الكل" },
      { value: "general", label: "عام" },
      ...(canViewAllDepts || actor?.department === "men" ? [{ value: "men" as const, label: "رجال" }] : []),
      ...(canViewAllDepts || actor?.department === "women" ? [{ value: "women" as const, label: "سيدات" }] : []),
    ];
  }, [canViewAllDepts, actor?.department]);

  // Load KPI telemetry stats
  useEffect(() => {
    if (!actor) return;
    let alive = true;
    const dept = deptFilter !== "all" ? deptFilter : undefined;
    Promise.all([
      api.members.list({ status: "all", department: dept, pageSize: 1 }),
      api.members.list({ status: "active", department: dept, pageSize: 1 }),
      api.members.list({ status: "inactive", department: dept, pageSize: 1 }),
      api.members.list({ smart: "expired", department: dept, pageSize: 1 }),
      api.members.list({ status: "archived", department: dept, pageSize: 1 }),
    ])
      .then(([allRes, activeRes, inactiveRes, expiringRes, archivedRes]) => {
        if (!alive) return;
        setKpiStats({
          total: allRes.total,
          active: activeRes.total,
          inactive: inactiveRes.total,
          expiring: expiringRes.total,
          archived: archivedRes.total,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [actor, deptFilter, reloadTick]);

  useEffect(() => {
    setPage(1);
  }, [debounced]);

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
          department: deptFilter !== "all" ? deptFilter : undefined,
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
  }, [actor, debounced, status, smart, deptFilter, trashMode, page, reloadTick]);

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

  const handleQuickStatusToggle = async (memberId: string, nextStatus: MemberStatus) => {
    try {
      await api.members.setStatus(memberId, nextStatus);
      toast(
        "success",
        nextStatus === "active" ? "تم تفعيل حساب العضو بنجاح" : "تم إلغاء تفعيل حساب العضو",
      );
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

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
        const canToggle = (hasPermission("members.change_status") || hasPermission("members.edit")) && !trashMode;
        if (!canToggle || row.status === "archived") {
          return (
            <Badge variant={meta.variant} dot>
              {meta.label}
            </Badge>
          );
        }
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const nextStatus: MemberStatus = row.status === "active" ? "inactive" : "active";
              void handleQuickStatusToggle(row.id, nextStatus);
            }}
            className="group inline-flex items-center gap-1 transition-transform hover:scale-105 cursor-pointer"
            title={
              row.status === "active"
                ? "انقر للتحويل إلى غير نشط"
                : "انقر لتفعيل العضو"
            }
          >
            <Badge
              variant={meta.variant}
              dot
              className="cursor-pointer group-hover:ring-1 group-hover:ring-primary/60 transition-all"
            >
              {meta.label}
            </Badge>
          </button>
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
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={UsersRound}
        title={t("nav.members")}
        subtitle="دليل الأعضاء المشتركين واللاعبين وإدارة البيانات الشخصية والاشتراكات"
        badge={
          <Badge variant="neutral" className="font-mono text-xs">
            {t("members.count", { count: formatNumber(data.total) })}
          </Badge>
        }
        actions={
          hasPermission("members.create") && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setImportModalOpen(true)}
              >
                <FileSpreadsheet className="size-4 text-emerald-400" />
                <span>{t("members.importBtn")}</span>
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditTarget(null);
                  setFormOpen(true);
                }}
                className="bg-primary text-white font-bold shadow-glow-sm"
              >
                <UserPlus className="size-4" />
                <span>{t("members.addMember")}</span>
              </Button>
            </div>
          )
        }
      />

      {/* 2. TOP KPI TELEMETRY STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => {
            setTrashMode(false);
            setStatus("all");
            setSmart("all");
            setPage(1);
          }}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            !trashMode && status === "all" && smart === "all"
              ? "ring-2 ring-cyan shadow-md shadow-cyan/20"
              : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<UsersRound className="w-5 h-5 text-cyan" />}
            title="إجمالي الأعضاء"
            value={formatNumber(kpiStats.total)}
            accent="cyan"
            subtitle="جميع المسجلين بالسيستم"
          />
        </button>

        <button
          type="button"
          onClick={() => {
            setTrashMode(false);
            setStatus("active");
            setSmart("all");
            setPage(1);
          }}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            !trashMode && status === "active" && smart === "all"
              ? "ring-2 ring-emerald shadow-md shadow-emerald/20"
              : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<CheckCircle2 className="w-5 h-5 text-emerald" />}
            title="المشتركون النشطون"
            value={formatNumber(kpiStats.active)}
            accent="emerald"
            subtitle="حسابات نشطة وسارية"
          />
        </button>

        <button
          type="button"
          onClick={() => {
            setTrashMode(false);
            setStatus("inactive");
            setSmart("all");
            setPage(1);
          }}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            !trashMode && status === "inactive" && smart === "all"
              ? "ring-2 ring-amber shadow-md shadow-amber/20"
              : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<Clock className="w-5 h-5 text-amber" />}
            title="الأعضاء غير النشطين"
            value={formatNumber(kpiStats.inactive)}
            accent="amber"
            subtitle="بحاجة لإعادة تفعيل"
          />
        </button>

        <button
          type="button"
          onClick={() => {
            setTrashMode(false);
            setStatus("all");
            setSmart("expired");
            setPage(1);
          }}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            !trashMode && smart === "expired"
              ? "ring-2 ring-neon shadow-md shadow-neon/20"
              : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<AlertTriangle className="w-5 h-5 text-neon" />}
            title="أوشكت / انتهت"
            value={formatNumber(kpiStats.expiring)}
            accent="neon"
            subtitle="اشتراكات بحاجة للتجديد"
          />
        </button>

        <button
          type="button"
          onClick={() => {
            setTrashMode(false);
            setStatus("archived");
            setSmart("all");
            setPage(1);
          }}
          className={cn(
            "text-start transition-all duration-200 rounded-xl p-0.5",
            !trashMode && status === "archived"
              ? "ring-2 ring-red shadow-md shadow-red/20"
              : "hover:opacity-90",
          )}
        >
          <StatCard
            icon={<ArchiveRestore className="w-5 h-5 text-red" />}
            title="المؤرشفون"
            value={formatNumber(kpiStats.archived)}
            accent="red"
            subtitle="سجلات مؤرشفة"
          />
        </button>
      </div>

      <Card>


        <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between bg-surface/40">
          <div className="flex flex-wrap items-center gap-2">
            {/* Glass capsule department filter pills */}
            <div className="flex items-center gap-1 rounded-full border border-panel-border/50 bg-panel/60 p-1 backdrop-blur-md">
              {deptOptions.map((opt) => {
                const isActive = deptFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setDeptFilter(opt.value);
                      setPage(1);
                    }}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-bold transition-all duration-200",
                      isActive
                        ? "bg-primary text-black font-extrabold shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
                        : "text-subtle hover:text-white hover:bg-surface/60",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

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
