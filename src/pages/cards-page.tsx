import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Ban,
  CircleOff,
  CreditCard,
  Layers,
  Link2,
  PackageCheck,
  PlusCircle,
  Send,
  ShieldBan,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Undo2,
  UserCheck,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { appConfig } from "@/config/app.config";
import {
  api,
  type BulkRegisterResult,
  type CardStats,
  type CardStatus,
  type CardWithMember,
} from "@/api";
import type { PublicMember } from "@/core/services/members.service";
import { parseDateKey } from "@/core/dates";
import { formatDateShort, formatNumber } from "@/services/format";
import { cardStatusMeta } from "@/utils/status-meta";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { BarcodeField } from "@/components/ui/barcode-field";
import { AssignCardModal } from "@/components/cards/assign-card-modal";
import { CardQrDeliveryModal } from "@/components/cards/card-qr-delivery-modal";
import { AutoGenerateCardsModal } from "@/components/cards/auto-generate-cards-modal";
import { MemberPickerModal } from "@/components/members/member-picker-modal";
import { PageHeader } from "@/components/ui/page-header";

type FilterMode = "all" | "available" | "assigned" | "virtual" | "physical" | "lost_blocked";

type ConfirmKind = "unassign" | "lost" | "delete" | null;

export function CardsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters & Pagination
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: CardWithMember[]; total: number }>({ items: [], total: 0 });
  const [stats, setStats] = useState<CardStats | null>(null);

  // Modals state
  const [registerOpen, setRegisterOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkRegisterResult | null>(null);

  const [autoGenOpen, setAutoGenOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [target, setTarget] = useState<CardWithMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Instant Scan & Assign Hub State
  const [hubBarcode, setHubBarcode] = useState("");
  const [hubMember, setHubMember] = useState<PublicMember | null>(null);
  const [hubMemberPickerOpen, setHubMemberPickerOpen] = useState(false);
  const [hubSendWhatsapp, setHubSendWhatsapp] = useState(true);
  const [hubSubmitting, setHubSubmitting] = useState(false);

  // Deliveries state
  const [pendingCount, setPendingCount] = useState(0);
  const [sendingPending, setSendingPending] = useState(false);
  const [qrCard, setQrCard] = useState<CardWithMember | null>(null);

  const reload = () => setReloadTick((v) => v + 1);

  // Load KPI Stats
  useEffect(() => {
    if (!actor || !hasPermission("cards.view")) return;
    void api.cards
      .getStats()
      .then(setStats)
      .catch((err) => console.error("Failed to load card stats:", err));
  }, [actor, hasPermission, reloadTick]);

  useEffect(() => {
    if (searchParams.get("assign") === "1" && hasPermission("cards.assign")) {
      setAssignOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, hasPermission, setSearchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Load cards list based on filter mode
  useEffect(() => {
    if (!actor) return;

    let statusParam: CardStatus | "all" | "lost_or_blocked" = "all";
    let kindParam: "all" | "virtual" | "physical" = "all";

    if (filterMode === "available") statusParam = "available";
    else if (filterMode === "assigned") statusParam = "assigned";
    else if (filterMode === "lost_blocked") statusParam = "lost_or_blocked";
    else if (filterMode === "virtual") kindParam = "virtual";
    else if (filterMode === "physical") kindParam = "physical";

    try {
      void api.cards
        .list({
          search: debounced || undefined,
          status: statusParam,
          kind: kindParam,
          page,
          pageSize: appConfig.pageSize,
        })
        .then(setData)
        .catch(console.error);
    } catch (err) {
      console.error(err);
    }
  }, [actor, debounced, filterMode, page, reloadTick]);

  // Pending card deliveries
  useEffect(() => {
    if (!actor || !hasPermission("cards.send")) return;
    let alive = true;
    void api.cards
      .countPendingDeliveries()
      .then((n) => {
        if (alive) setPendingCount(n);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [actor, hasPermission, reloadTick]);

  // Open single register
  const openRegister = () => {
    setError(null);
    setNotes("");
    try {
      void api.cards.nextBarcodePreview().then(setBarcode);
    } catch {
      setBarcode("");
    }
    setRegisterOpen(true);
  };

  const onRegister = async () => {
    if (!actor) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.cards.register({ barcodeValue: barcode, notes: notes.trim() || null });
      toast("success", t("cards.registeredToast"));
      setRegisterOpen(false);
      reload();
      setPage(1);
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  // Instant Hub Submit
  const onInstantHubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !hubMember || !hubBarcode.trim()) return;

    setHubSubmitting(true);
    try {
      const trimmedBarcode = hubBarcode.trim();
      const assignRes = (await api.cards.assignByBarcode({
        barcodeValue: trimmedBarcode,
        memberId: hubMember.id,
      })) as { card?: { id: string } } | undefined;

      const cardId = assignRes?.card?.id;

      if (hubSendWhatsapp && cardId && hasPermission("cards.send")) {
        try {
          await api.cards.queueDelivery(cardId, true);
          await api.cards.sendPendingDeliveries(1);
        } catch (deliveryErr) {
          console.warn("WhatsApp auto-delivery skipped or pending:", deliveryErr);
        }
      }

      toast(
        "success",
        `${t("cards.assignedToast")}: ${hubMember.fullName} (${trimmedBarcode})`,
      );

      setHubBarcode("");
      setHubMember(null);
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setHubSubmitting(false);
    }
  };

  const runConfirm = async () => {
    if (!actor || !target || !confirmKind) return;
    setBusy(true);
    try {
      if (confirmKind === "unassign") {
        await api.cards.unassign(target.id);
        toast("success", t("cards.unassignedToast"));
      } else if (confirmKind === "lost") {
        await api.cards.reportLost(target.id);
        toast("success", t("cards.lostToast"));
      } else {
        const result = await api.cards.delete(target.id, true);
        if (result.detachedAttendance > 0) {
          toast(
            "success",
            t("cards.deletedToastWithAttendance", { count: result.detachedAttendance }),
          );
        } else {
          toast(
            "success",
            result.unassigned ? t("cards.deletedToastUnassigned") : t("cards.deletedToast"),
          );
        }
      }
      setConfirmKind(null);
      reload();
      setPage(1);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const toggleBlock = async (card: CardWithMember) => {
    if (!actor) return;
    const blocking = card.status !== "blocked";
    try {
      await api.cards.setBlocked(card.id, blocking);
      toast("success", blocking ? t("cards.blockedToast") : t("cards.unblockedToast"));
      reload();
      setPage(1);
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const sendPending = async () => {
    if (!actor) return;
    setSendingPending(true);
    try {
      const result = await api.cards.sendPendingDeliveries(50);
      toast(
        result.sent > 0 ? "success" : result.failed > 0 ? "warning" : "info",
        t("cards.sendPendingDone", {
          sent: result.sent,
          failed: result.failed,
          noPhone: result.skippedNoPhone,
          notConfigured: result.notConfigured,
        }),
      );
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSendingPending(false);
    }
  };

  interface Row {
    id: string;
    barcodeValue: string;
    status: CardStatus;
    kind: CardWithMember["kind"];
    memberId: string | null;
    memberName: string | null;
    assignedAtKey: string | null;
  }

  const rows: Row[] = data.items.map((c) => ({
    id: c.id,
    barcodeValue: c.barcodeValue,
    status: c.status,
    kind: c.kind,
    memberId: c.memberId,
    memberName: c.memberName,
    assignedAtKey: c.assignedAt?.slice(0, 10) ?? null,
  }));

  const columns: Column<Row>[] = [
    {
      key: "barcode",
      header: t("cards.barcode"),
      render: (row) => (
        <div className="flex items-center gap-2">
          <span dir="ltr" className="font-mono font-bold tracking-wider text-ink">
            {row.barcodeValue}
          </span>
          <Badge variant={row.kind === "virtual" ? "info" : "neutral"}>
            {row.kind === "virtual" ? t("cards.kindVirtual") : t("cards.kindPhysical")}
          </Badge>
        </div>
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
      key: "holder",
      header: t("cards.holder"),
      render: (row) =>
        row.memberId && row.memberName ? (
          <button
            type="button"
            onClick={() => navigate(`/members/${row.memberId}`)}
            className="font-semibold text-ink hover:text-neon transition-colors"
          >
            {row.memberName}
          </button>
        ) : (
          <span className="text-faint">{t("cards.unassigned")}</span>
        ),
    },
    {
      key: "assigned",
      header: t("cards.assignedAt"),
      render: (row) =>
        row.assignedAtKey ? (
          <span className="tabnum text-subtle">{formatDateShort(parseDateKey(row.assignedAtKey))}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
  ];

  if (
    hasPermission("cards.unassign") ||
    hasPermission("cards.report_lost") ||
    hasPermission("cards.block") ||
    hasPermission("cards.delete")
  ) {
    columns.push({
      key: "actions",
      header: t("common.actions"),
      align: "end",
      render: (row) => {
        const original = data.items.find((c) => c.id === row.id);
        if (!original) return null;
        return (
          <div className="flex items-center justify-end gap-1">
            {hasPermission("cards.unassign") && original.status === "assigned" && (
              <IconAction
                label={t("cards.actionUnassign")}
                onClick={() => {
                  setTarget(original);
                  setConfirmKind("unassign");
                }}
              >
                <Undo2 className="size-4" />
              </IconAction>
            )}
            {hasPermission("cards.report_lost") &&
              (original.status === "assigned" || original.status === "available") && (
                <IconAction
                  label={t("cards.actionLost")}
                  onClick={() => {
                    setTarget(original);
                    setConfirmKind("lost");
                  }}
                >
                  <CircleOff className="size-4" />
                </IconAction>
              )}
            {hasPermission("cards.block") && original.status !== "lost" && (
              <IconAction
                label={original.status === "blocked" ? t("cards.actionUnblock") : t("cards.actionBlock")}
                danger={original.status !== "blocked"}
                onClick={() => void toggleBlock(original)}
              >
                {original.status === "blocked" ? <ShieldCheck className="size-4" /> : <ShieldBan className="size-4" />}
              </IconAction>
            )}
            {hasPermission("cards.send") && original.status === "assigned" && original.memberId && (
              <IconAction label={t("cards.sendQr")} onClick={() => setQrCard(original)}>
                <Send className="size-4" />
              </IconAction>
            )}
            {hasPermission("cards.delete") && (
              <IconAction
                label={t("cards.actionDelete")}
                danger
                onClick={() => {
                  setTarget(original);
                  setConfirmKind("delete");
                }}
              >
                <Trash2 className="size-4" />
              </IconAction>
            )}
          </div>
        );
      },
    });
  }

  // Capsule Pills Configuration
  const capsulePills: Array<{ mode: FilterMode; label: string; count?: number }> = [
    { mode: "all", label: t("cards.filterAll"), count: stats?.total },
    { mode: "available", label: t("cards.filterAvailable"), count: stats?.available },
    { mode: "assigned", label: t("cards.filterAssigned"), count: stats?.assigned },
    { mode: "virtual", label: t("cards.filterVirtual"), count: stats?.virtual },
    { mode: "physical", label: t("cards.filterPhysical"), count: stats?.physical },
    {
      mode: "lost_blocked",
      label: t("cards.filterLostBlocked"),
      count: stats ? stats.lost + stats.blocked : undefined,
    },
  ];

  return (
    <div className="space-y-4">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={CreditCard}
        title={t("nav.cards")}
        subtitle="منظومة إدارة البطاقات الذكية (RFID / Barcode) والربط الفوري وتوليد الباركودات وإرسالها عبر WhatsApp"
        badge={
          stats ? (
            <Badge variant="neutral" className="font-mono text-xs">
              {formatNumber(stats.total)} بطاقة
            </Badge>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {hasPermission("cards.send") && pendingCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void sendPending()}
                loading={sendingPending}
                disabled={sendingPending}
              >
                <Send className="size-4 text-emerald-400" />
                <span>{t("cards.sendPending", { count: formatNumber(pendingCount) })}</span>
              </Button>
            )}
            {hasPermission("cards.register") && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAutoGenOpen(true)}
                  title={t("cards.autoGenerate")}
                >
                  <Sparkles className="size-4 text-neon" />
                  <span>{t("cards.autoGenerate")}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setBulkResult(null);
                    setBulkText("");
                    setBulkOpen(true);
                  }}
                >
                  <Layers className="size-4" />
                  <span>{t("cards.bulk")}</span>
                </Button>
                <Button
                  size="sm"
                  onClick={openRegister}
                  className="bg-primary text-white font-bold shadow-glow-sm"
                >
                  <PlusCircle className="size-4" />
                  <span>{t("cards.register")}</span>
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* 2. TOP KPI TELEMETRY STRIP */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button
          type="button"
          onClick={() => {
            setFilterMode("all");
            setPage(1);
          }}
          className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 ${
            filterMode === "all"
              ? "border-neon/60 bg-neon/10 shadow-sm shadow-neon/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-subtle">
            <span className="text-xs font-semibold">{t("cards.statsTotal")}</span>
            <CreditCard className="size-4 text-faint" />
          </div>
          <p className="tabnum text-2xl font-black text-ink">{formatNumber(stats?.total ?? 0)}</p>
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterMode("available");
            setPage(1);
          }}
          className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 ${
            filterMode === "available"
              ? "border-amber/60 bg-amber/10 shadow-sm shadow-amber/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-amber">
            <span className="text-xs font-semibold">{t("cards.statsAvailable")}</span>
            <PackageCheck className="size-4 text-amber" />
          </div>
          <p className="tabnum text-2xl font-black text-amber">{formatNumber(stats?.available ?? 0)}</p>
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterMode("assigned");
            setPage(1);
          }}
          className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 ${
            filterMode === "assigned"
              ? "border-emerald/60 bg-emerald/10 shadow-sm shadow-emerald/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-emerald">
            <span className="text-xs font-semibold">{t("cards.statsAssigned")}</span>
            <UserCheck className="size-4 text-emerald" />
          </div>
          <p className="tabnum text-2xl font-black text-emerald">{formatNumber(stats?.assigned ?? 0)}</p>
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterMode("virtual");
            setPage(1);
          }}
          className={`flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 ${
            filterMode === "virtual"
              ? "border-sky-500/60 bg-sky-500/10 shadow-sm shadow-sky-500/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-sky-400">
            <span className="text-xs font-semibold">{t("cards.statsVirtual")}</span>
            <Smartphone className="size-4 text-sky-400" />
          </div>
          <p className="tabnum text-2xl font-black text-sky-400">{formatNumber(stats?.virtual ?? 0)}</p>
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterMode("lost_blocked");
            setPage(1);
          }}
          className={`col-span-2 flex flex-col gap-1 rounded-2xl border p-4 text-start transition-all duration-150 sm:col-span-1 ${
            filterMode === "lost_blocked"
              ? "border-red/60 bg-red/10 shadow-sm shadow-red/10"
              : "border-line bg-surface/80 hover:border-line hover:bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-red">
            <span className="text-xs font-semibold">{t("cards.statsLostBlocked")}</span>
            <Ban className="size-4 text-red" />
          </div>
          <p className="tabnum text-2xl font-black text-red">
            {formatNumber((stats?.lost ?? 0) + (stats?.blocked ?? 0))}
          </p>
        </button>
      </div>

      {/* 2. INSTANT SCAN & ASSIGN HUB */}
      {hasPermission("cards.assign") && (
        <Card className="border-neon/20 bg-gradient-to-r from-panel via-panel to-neon/5">
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-neon">
                <Sparkles className="size-4" />
                <h3 className="text-sm font-bold">{t("cards.hubTitle")}</h3>
              </div>
              <p className="hidden text-xs text-faint sm:block">{t("cards.hubDesc")}</p>
            </div>

            <form onSubmit={onInstantHubSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                {/* Barcode input */}
                <div className="sm:col-span-4">
                  <label className="mb-1.5 block text-xs font-semibold text-subtle">
                    {t("cards.barcode")}
                  </label>
                  <BarcodeField
                    value={hubBarcode}
                    onValueChange={setHubBarcode}
                    placeholder={t("cards.hubBarcodePlaceholder")}
                    disabled={hubSubmitting}
                  />
                </div>

                {/* Member selector */}
                <div className="sm:col-span-4">
                  <label className="mb-1.5 block text-xs font-semibold text-subtle">
                    {t("common.member")}
                  </label>
                  {hubMember ? (
                    <div className="flex h-10 w-full items-center justify-between rounded-xl border border-neon/50 bg-neon/10 px-3 text-sm">
                      <span className="truncate font-bold text-ink">{hubMember.fullName}</span>
                      <button
                        type="button"
                        onClick={() => setHubMember(null)}
                        className="text-faint hover:text-red transition-colors"
                        title={t("common.cancel")}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setHubMemberPickerOpen(true)}
                      disabled={hubSubmitting}
                      className="flex h-10 w-full items-center justify-between rounded-xl border border-line bg-panel px-3.5 text-sm text-faint transition-colors hover:border-neon/50 hover:text-ink disabled:opacity-50"
                    >
                      <span>{t("cards.hubMemberPlaceholder")}</span>
                      <UserRound className="size-4 text-faint" />
                    </button>
                  )}
                </div>

                {/* Assign Button */}
                <div className="sm:col-span-4">
                  <Button
                    type="submit"
                    className="w-full"
                    loading={hubSubmitting}
                    disabled={hubSubmitting || !hubBarcode.trim() || !hubMember}
                  >
                    <Link2 className="size-4" />
                    {t("cards.hubAssignBtn")}
                  </Button>
                </div>
              </div>

              {/* WhatsApp Toggle option */}
              {hasPermission("cards.send") && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <label className="flex cursor-pointer select-none items-center gap-2 text-subtle hover:text-ink">
                    <input
                      type="checkbox"
                      checked={hubSendWhatsapp}
                      onChange={(e) => setHubSendWhatsapp(e.target.checked)}
                      className="size-4 rounded border-line bg-panel text-neon focus:ring-neon"
                    />
                    <span>{t("cards.hubInstantWhatsapp")}</span>
                  </label>
                </div>
              )}
            </form>
          </div>
        </Card>
      )}

      {/* 4. MAIN CARDS TABLE & CAPSULE FILTERS */}
      <Card>
        <div className="flex flex-col gap-1 px-5 py-4 border-b border-line sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-ink tracking-tight">سجل وقائمة البطاقات الذكية</h2>
            <p className="text-xs text-subtle mt-0.5">
              إجمالي النتائج المسجلة: {formatNumber(data.total)} بطاقة
            </p>
          </div>
        </div>

        {/* CAPSULE FILTER PILLS & SEARCH */}
        <div className="space-y-3 border-b border-line px-5 py-3.5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="sm:w-80">
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder={t("common.searchPlaceholder")}
              />
            </div>
            <p className="text-xs font-semibold text-faint tabnum sm:ms-auto">
              إجمالي النتائج: {formatNumber(data.total)}
            </p>
          </div>

          {/* Capsule Pills Row */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {capsulePills.map((pill) => {
              const active = filterMode === pill.mode;
              return (
                <button
                  key={pill.mode}
                  type="button"
                  onClick={() => {
                    setFilterMode(pill.mode);
                    setPage(1);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-150 ${
                    active
                      ? "bg-neon text-dark shadow-sm shadow-neon/30"
                      : "border border-line bg-surface/60 text-subtle hover:border-line hover:bg-surface hover:text-ink"
                  }`}
                >
                  <span>{pill.label}</span>
                  {pill.count !== undefined && (
                    <span
                      className={`tabnum rounded-full px-1.5 py-0.5 text-[10px] ${
                        active ? "bg-dark/20 text-dark" : "bg-panel text-faint"
                      }`}
                    >
                      {formatNumber(pill.count)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<CreditCard />} title={t("cards.empty")} />
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

      {/* 4. MODALS */}
      {/* Auto-Sequence Batch Generator Modal */}
      <AutoGenerateCardsModal
        open={autoGenOpen}
        onClose={() => setAutoGenOpen(false)}
        onDone={() => {
          reload();
          setPage(1);
        }}
      />

      {/* Single Card Register Modal */}
      <Modal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title={t("cards.register")}
        widthClass="max-w-sm"
        footer={
          <>
            <Button
              type="submit"
              form="register-card-form"
              loading={submitting}
              disabled={submitting}
            >
              {t("common.save")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setRegisterOpen(false)}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <form
          id="register-card-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onRegister();
          }}
          noValidate
          className="space-y-3.5"
        >
          <BarcodeField
            label={`${t("cards.nextBarcode")} — ${t("cards.barcode")}`}
            value={barcode}
            onValueChange={setBarcode}
            disabled={submitting}
            autoFocus
          />
          <Input
            label={`${t("common.notes")} (${t("common.optional")})`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
          />
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red"
            >
              {error}
            </p>
          )}
        </form>
      </Modal>

      {/* Member Picker for Instant Hub */}
      <MemberPickerModal
        open={hubMemberPickerOpen}
        onClose={() => setHubMemberPickerOpen(false)}
        onSelect={(m) => {
          setHubMember(m);
          setHubMemberPickerOpen(false);
        }}
      />

      {/* Assign Card Modal (Legacy/Direct) */}
      <AssignCardModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onDone={reload}
      />

      {/* QR Delivery Modal */}
      {qrCard && (
        <CardQrDeliveryModal
          open
          memberName={qrCard.memberName ?? ""}
          memberPhone={qrCard.memberPhone ?? null}
          barcodeValue={qrCard.barcodeValue}
          cardId={qrCard.id}
          memberId={qrCard.memberId ?? undefined}
          onClose={() => setQrCard(null)}
        />
      )}

      {/* Bulk Register Modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t("cards.bulkTitle")}
        widthClass="max-w-lg"
        footer={
          <>
            <Button
              onClick={() => {
                if (!actor) return;
                setSubmitting(true);
                void api.cards
                  .bulkRegister(bulkText.split(/\r?\n/))
                  .then((result) => {
                    setBulkResult(result);
                    if (result.registered.length > 0) {
                      toast(
                        "success",
                        t("cards.bulkDoneToast", { count: result.registered.length }),
                      );
                      reload();
                    }
                  })
                  .catch((err: unknown) => toast("error", describeError(err, t)))
                  .finally(() => setSubmitting(false));
              }}
              loading={submitting}
              disabled={submitting || bulkText.trim() === ""}
            >
              {t("cards.bulkSubmit")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (bulkResult && bulkResult.registered.length > 0) {
                  setBulkOpen(false);
                  setBulkText("");
                  setBulkResult(null);
                } else {
                  setBulkOpen(false);
                }
              }}
              disabled={submitting}
            >
              {bulkResult ? t("common.close") : t("common.cancel")}
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <p className="text-[12px] leading-relaxed text-subtle">{t("cards.bulkHint")}</p>
          <textarea
            dir="ltr"
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            disabled={submitting}
            spellCheck={false}
            className="w-full rounded-xl border border-line bg-panel px-3.5 py-3 font-mono text-sm text-ink outline-none transition-colors duration-150 placeholder:text-faint focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
            placeholder={"GYM-000101\nGYM-000102\n..."}
            aria-label={t("cards.bulkTitle")}
          />
          {bulkResult && (
            <div className="space-y-1.5 rounded-xl border border-line bg-surface p-3.5 text-[13px]">
              <p className="font-bold text-emerald">
                {t("cards.bulkRegistered", { count: bulkResult.registered.length })}
              </p>
              {bulkResult.existing.length > 0 && (
                <p dir="ltr" className="text-start font-semibold text-amber">
                  {t("cards.bulkExisting", { count: bulkResult.existing.length })}
                </p>
              )}
              {bulkResult.duplicateInBatch.length > 0 && (
                <p dir="ltr" className="text-start font-semibold text-amber">
                  {t("cards.bulkDupes", { count: bulkResult.duplicateInBatch.length })}
                </p>
              )}
              {bulkResult.invalid.length > 0 && (
                <p dir="ltr" className="text-start font-semibold text-red">
                  {t("cards.bulkInvalid", { count: bulkResult.invalid.length })}
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmKind !== null}
        onClose={() => setConfirmKind(null)}
        title={
          confirmKind === "unassign"
            ? t("cards.actionUnassign")
            : confirmKind === "lost"
              ? t("cards.actionLost")
              : t("cards.deleteTitle")
        }
        confirmLabel={confirmKind === "delete" ? t("cards.deleteConfirm") : undefined}
        message={
          confirmKind === "unassign" ? (
            t("cards.unassignMsg")
          ) : confirmKind === "lost" ? (
            t("cards.lostMsg")
          ) : (
            <span className="space-y-2">
              <span className="block">
                {target?.status === "assigned" && target.memberName
                  ? t("cards.deleteMsgAssigned", { member: target.memberName })
                  : t("cards.deleteMsg")}
              </span>
              <span className="block text-[12px] text-faint">
                {t("cards.deleteAttendanceNote")}
              </span>
            </span>
          )
        }
        loading={busy}
        onConfirm={() => void runConfirm()}
      />
    </div>
  );
}

function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-lg transition-colors ${
        danger
          ? "text-faint hover:bg-red/10 hover:text-red"
          : "text-faint hover:bg-white/5 hover:text-subtle"
      }`}
    >
      {children}
    </button>
  );
}
