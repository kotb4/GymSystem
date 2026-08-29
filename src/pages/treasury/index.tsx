import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type {
  DailyClosingDetail,
  TreasurySnapshot,
  DailyClosingSnapshot,
  CashBox,
  DailyClosingStatus,
} from "@/core/services/daily-closing.service";
import { todayKey } from "@/core/dates";
import { formatMinor, toMinor } from "@/core/money";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Coins, Wallet, LockKeyhole, ArrowUpCircle } from "lucide-react";

export function TreasuryPage() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();

  const canView = hasPermission("cash.daily_close");
  const canCreate = hasPermission("cash.daily_close");
  const canClose = hasPermission("cash.daily_close");
  const canReopen = hasPermission("cash.daily_reopen");

  const [dateKey, setDateKey] = useState(() => todayKey());
  const [gymSnapshot, setGymSnapshot] = useState<TreasurySnapshot | null>(null);
  const [storeSnapshot, setStoreSnapshot] = useState<TreasurySnapshot | null>(null);
  const [dashboardTreasury, setDashboardTreasury] = useState<{ gym: TreasurySnapshot; store: TreasurySnapshot } | null>(null);
  const [detail, setDetail] = useState<DailyClosingDetail | null>(null);
  const [detailClosingId, setDetailClosingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DailyClosingSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [confirmReopen, setConfirmReopen] = useState<{ id: string; reason: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState<{ id: string; counted: string; reason: string | null } | null>(null);

  const reload = () => setReloadTick((v) => v + 1);

  // Load today's treasury data
  useEffect(() => {
    if (!actor || !canView) return;
    let alive = true;
    void api.treasury
      .snapshotsForDate(dateKey)
      .then((result) => {
        if (alive) {
          setDashboardTreasury(result);
          setGymSnapshot(result.gym);
          setStoreSnapshot(result.store);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!!err?.body?.error?.messageKey) {
          (describeError(err, t));
        }
      });
    return () => {
      alive = false;
    };
  }, [actor, canView, dateKey, reloadTick]);

  // Load list of recent closings
  useEffect(() => {
    if (!actor || !canView) return;
    let alive = true;
    void api.treasury
      .list({ page, pageSize: 20, currentOnly: false })
      .then((result) => {
        if (alive) {
          setItems(result.items);
          setTotal(result.total);
        }
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [actor, canView, page, reloadTick]);

  // Handle creating/getting today's closing for a box
  const handleCreateOrUpdate = async (box: CashBox) => {
    if (!actor || !canCreate) return;
    setBusy(true);
    (null);
    try {
      // First get or create the closing for today
      await api.treasury.getOrCreate({
        businessDate: dateKey,
        box,
        openingBalanceMinor: 0, // Will be updated with actual expected from ledger
      });
      // Refresh the snapshots
      reload();
      toast("success", t(`treasury.${box}CreatedToast`));
    } catch (err) {
      (describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  // Handle recording counted cash and closing
  const handleClose = async (box: CashBox, counted: string, reason: string | null) => {
    if (!actor || !canClose) return;
    setBusy(true);
    (null);
    try {
      // Get current closing for this date+box
      const closing = await api.treasury.snapshot(dateKey, box);
      if (!closing.closingId) {
        throw new Error("No closing found for this date and box");
      }
      await api.treasury.close(closing.closingId, {
        countedCashMinor: toMinor(counted || "0"),
        reason: reason ?? null,
      });
      reload();
      toast("success", t("treasury.closedToast"));
      setConfirmClose(null);
    } catch (err) {
      (describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  // Handle reopening a closing
  const handleReopen = async (closingId: string, reason: string) => {
    if (!actor || !canReopen) return;
    setBusy(true);
    (null);
    try {
      await api.treasury.reopen(closingId, reason);
      reload();
      toast("success", t("treasury.reopenedToast"));
      setConfirmReopen(null);
    } catch (err) {
      (describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  // Handle viewing details
  const handleViewDetails = async (closingId: string) => {
    setBusy(true);
    (null);
    try {
      const detail = await api.treasury.getById(closingId);
      setDetail(detail);
      setDetailClosingId(closingId);
    } catch (err) {
      (describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  // Handle closing detail view
  const handleCloseDetail = () => {
    setDetail(null);
    setDetailClosingId(null);
  };

  // Handle printing
  const handlePrint = () => {
    if (detailClosingId) {
      window.open(`/treasury/print/${detailClosingId}`, "_blank");
    }
  };

  const formatStatus = (status: DailyClosingStatus | "missing"): string => {
    switch (status) {
      case "open": return t("treasury.statusOpen");
      case "closed": return t("treasury.statusClosed");
      case "reopened": return t("treasury.statusReopened");
      default: return t("treasury.snapshotMissing");
    }
  };

  if (!canView) {
    return (
      <div className="space-y-5">
        <EmptyState icon={<Coins />} title={t("errors.forbidden")} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header with date picker and actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">{t("treasury.title")}</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-medium text-subtle">{t("treasury.dateLabel")}</label>
            <Input
              type="date"
              value={dateKey}
              onChange={(e) => setDateKey(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            onClick={() => {
              setDateKey(
                new Date().toISOString().split("T")[0]
              ); // Reset to today
            }}
            variant="ghost"
            size="sm"
          >
            <ArrowUpCircle className="size-4" />
          </Button>
        </div>
      </div>

      {/* Today's treasury KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Gym Treasury Card */}
        <Card>
          <CardHeader title={t("treasury.sectionOpen")} description={t("treasury.boxGym")} />
          {gymSnapshot ? (
            <>
              {gymSnapshot.status === "missing" ? (
                <div className="space-y-4 px-5 pt-5">
                  <Button
                    onClick={() => handleCreateOrUpdate("gym")}
                    className="w-full"
                  >
                    <Coins className="size-4 me-2" />
                    {t("treasury.createSnapshotBtn")}
                  </Button>
                  <p className="text-[12px] text-faint">{t("treasury.snapshotMissingHint")}</p>
                </div>
              ) : (
                <>
                  <div className="space-y-4 px-5 pt-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.expectedTotal")}</p>
                        <p className="text-lg font-semibold tabnum">
                          {formatMinor(gymSnapshot.expectedMinor ?? 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.countedCash")}</p>
                        <p className="text-lg font-semibold tabnum">
                          {gymSnapshot.countedCashMinor == null ? "—" : formatMinor(gymSnapshot.countedCashMinor)}
                        </p>
                      </div>
                    </div>
                    {gymSnapshot.status === "open" && (
                      <>
                        <div className="pt-4">
                          <p className="text-[12px] text-faint">{t("treasury.difference")}</p>
                          <p className="text-lg font-semibold tabnum">
                            {gymSnapshot.differenceMinor == null ? "—" : formatMinor(gymSnapshot.differenceMinor)}
                          </p>
                        </div>
                        {gymSnapshot.differenceMinor !== null && gymSnapshot.differenceMinor !== 0 && (
                          <div className="pt-2">
                            <Input
                              label={t("treasury.reasonLabel")}
                              placeholder={t("treasury.reasonPlaceholder")}
                              value=""
onChange={() => {}}
                              />
                            </div>
                         )}
                        <div className="pt-4 flex items-center gap-2">
                          <Button
                            onClick={() => {
                              setConfirmClose({
                                id: gymSnapshot.closingId ?? "",
                                counted: "",
                                reason: null,
                              });
                            }}
                            disabled={!gymSnapshot.closingId || busy}
                          >
                            <LockKeyhole className="size-4" />
                            {t("treasury.closeBtn")}
                          </Button>
                        </div>
                      </>
                    )}
                    {gymSnapshot.status === "closed" && (
                      <div className="pt-4 text-center text-sm">
                        <Badge variant="neutral">
                          {t("treasury.closedToast")}
                        </Badge>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <EmptyState icon={<Coins />} title={t("treasury.noClosings")} />
          )}
        </Card>

        {/* Store Treasury Card */}
        <Card>
          <CardHeader title={t("treasury.sectionOpen")} description={t("treasury.boxStore")} />
          {storeSnapshot ? (
            <>
              {storeSnapshot.status === "missing" ? (
                <div className="space-y-4 px-5 pt-5">
                  <Button
                    onClick={() => handleCreateOrUpdate("store")}
                    className="w-full"
                  >
                    <Wallet className="size-4 me-2" />
                    {t("treasury.createSnapshotBtn")}
                  </Button>
                  <p className="text-[12px] text-faint">{t("treasury.snapshotMissingHint")}</p>
                </div>
              ) : (
                <>
                  <div className="space-y-4 px-5 pt-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.expectedTotal")}</p>
                        <p className="text-lg font-semibold tabnum">
                          {formatMinor(storeSnapshot.expectedMinor ?? 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.countedCash")}</p>
                        <p className="text-lg font-semibold tabnum">
                          {storeSnapshot.countedCashMinor == null ? "—" : formatMinor(storeSnapshot.countedCashMinor)}
                        </p>
                      </div>
                    </div>
                    {storeSnapshot.status === "open" && (
                      <>
                        <div className="pt-4">
                          <p className="text-[12px] text-faint">{t("treasury.difference")}</p>
                          <p className="text-lg font-semibold tabnum">
                            {storeSnapshot.differenceMinor == null ? "—" : formatMinor(storeSnapshot.differenceMinor)}
                          </p>
                        </div>
                        {storeSnapshot.differenceMinor !== null && storeSnapshot.differenceMinor !== 0 && (
                          <div className="pt-2">
                            <Input
                              label={t("treasury.reasonLabel")}
                              placeholder={t("treasury.reasonPlaceholder")}
                              value=""
                              onChange={() => {}}
/>
                           </div>
                          )}
                        <div className="pt-4 flex items-center gap-2">
                          <Button
                            onClick={() => {
                              setConfirmClose({
                                id: storeSnapshot.closingId ?? "",
                                counted: "",
                                reason: null,
                              });
                            }}
                            disabled={!storeSnapshot.closingId || busy}
                          >
                            <LockKeyhole className="size-4" />
                            {t("treasury.closeBtn")}
                          </Button>
                        </div>
                      </>
                    )}
                    {storeSnapshot.status === "closed" && (
                      <div className="pt-4 text-center text-sm">
                        <Badge variant="neutral">
                          {t("treasury.closedToast")}
                        </Badge>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <EmptyState icon={<Wallet />} title={t("treasury.noClosings")} />
          )}
        </Card>

        {/* Today's KPI from dashboard */}
        <Card>
          <CardHeader title={t("treasury.todayKpiTitle")} />
          {dashboardTreasury ? (
            <>
              <div className="space-y-4 px-5 pt-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.todayKpiExpected")}</p>
                    <p className="text-lg font-semibold tabnum">
                      {formatMinor(
                        (dashboardTreasury.gym.expectedMinor ?? 0) +
                          (dashboardTreasury.store.expectedMinor ?? 0)
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.todayKpiCounted")}</p>
                    <p className="text-lg font-semibold tabnum">
                      {formatMinor(
                        (dashboardTreasury.gym.countedCashMinor ?? 0) +
                          (dashboardTreasury.store.countedCashMinor ?? 0)
                      )}
                    </p>
                  </div>
                </div>
                <div className="pt-4">
                  <p className="text-[12px] text-faint">{t("treasury.todayKpiDiff")}</p>
                  <p className="text-lg font-semibold tabnum">
                    {formatMinor(
                      (dashboardTreasury.gym.differenceMinor ?? 0) +
                        (dashboardTreasury.store.differenceMinor ?? 0)
                    )}
                  </p>
                </div>
                <div className="pt-4">
                  <p className="text-[12px] text-faint">{t("treasury.todayKpiStatus")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={
                        dashboardTreasury.gym.status === "open" ||
                        dashboardTreasury.store.status === "open"
                          ? "warning"
                          : dashboardTreasury.gym.status === "closed" &&
                            dashboardTreasury.store.status === "closed"
                          ? "success"
                          : "neutral"
                      }
                    >
                      {formatStatus(
                        dashboardTreasury.gym.status === "open" ||
                        dashboardTreasury.store.status === "open"
                          ? "open"
                          : dashboardTreasury.gym.status === "closed" &&
                            dashboardTreasury.store.status === "closed"
                          ? "closed"
                          : "missing"
                      )}
                    </Badge>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <EmptyState icon={<Coins />} title={t("treasury.snapshotMissingHint")} />
          )}
        </Card>
      </div>

      {/* Detail view or list view */}
      {detail ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-extrabold tracking-tight">
              {t("treasury.detailTitle")}
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseDetail}
              >
                <ArrowUpCircle className="size-4" />
              </Button>
              <Button
                onClick={handlePrint}
                disabled={!detailClosingId}
              >
                <Coins className="size-4" />
                {t("treasury.printBtn")}
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Basic Info */}
            <Card>
              <CardHeader title={t("treasury.sectionInfo")} />
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.dateLabel")}</p>
                    <p className="text-sm tabnum">
                      {formatDateShort(new Date(detail.businessDate.replace(" ", "T")))}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.boxLabel")}</p>
                    <p className="text-sm tabnum capitalize">
                      {detail.box === "gym" ? t("treasury.boxGym") : t("treasury.boxStore")}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.statusLabel")}</p>
                    <p className="text-sm tabnum">
                      {formatStatus(detail.status)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.openedBy")}</p>
                    <p className="text-sm tabnum">
                      {detail.openedByName}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.openedAt")}</p>
                    <p className="text-sm tabnum">
                      {detail.openedAt.slice(0, 16)}
                    </p>
                  </div>
                  {detail.closedById && (
                    <>
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.closedBy")}</p>
                        <p className="text-sm tabnum">
                          {detail.closedByName}
                        </p>
                      </div>
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.closedAt")}</p>
                        <p className="text-sm tabnum">
                          {detail.closedAt?.slice(0, 16) ?? "—"}
                        </p>
                      </div>
                    </>
                  )}
                  {detail.reopenedById && (
                    <>
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.reopenedBy")}</p>
                        <p className="text-sm tabnum">
                          {detail.reopenedByName}
                        </p>
                      </div>
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.reopenedAt")}</p>
                        <p className="text-sm tabnum">
                          {detail.reopenedAt?.slice(0, 16) ?? "—"}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Card>

            {/* Financials */}
            <Card>
              <CardHeader title={t("treasury.expectedByMethod")} />
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.expectedCash")}</p>
                    <p className="text-sm font-semibold tabnum">
                      {formatMinor(detail.expected.cash)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.countedCash")} (نقدي)</p>
                    <p className="text-sm font-semibold tabnum">
                      {formatMinor(detail.expected.cash)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.expectedCard")}</p>
                    <p className="text-sm font-semibold tabnum">
                      {formatMinor(detail.expected.card)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.expectedTransfer")}</p>
                    <p className="text-sm font-semibold tabnum">
                      {formatMinor(detail.expected.transfer)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-faint">{t("treasury.expectedOther")}</p>
                    <p className="text-sm font-semibold tabnum">
                      {formatMinor(detail.expected.other)}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[12px] text-faint">{t("treasury.expectedTotal")}</p>
                    <p className="text-sm font-semibold tabnum">
                      {formatMinor(detail.expected.total)}
                    </p>
                  </div>
                </div>
                {detail.status === "closed" && detail.countedCashMinor !== null && (
                  <div className="pt-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.countedCash")}</p>
                        <p className="text-sm font-semibold tabnum">
                          {formatMinor(detail.countedCashMinor)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[12px] text-faint">{t("treasury.difference")}</p>
                        <p className="text-sm font-semibold tabnum">
                          {formatMinor(detail.differenceMinor ?? 0)}
                        </p>
                      </div>
                    </div>
                    {detail.reason && (
                      <div className="pt-3">
                        <p className="text-[12px] text-faint">{t("treasury.reasonLabel")}</p>
                        <p className="text-sm break-all">
                          {detail.reason}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Method Breakdown */}
          {detail.methodBreakdown && detail.methodBreakdown.length > 0 && (
            <Card>
              <CardHeader title={t("treasury.methodBreakdown")} />
              <DataTable
                columns={[
                  {
                    key: "method",
                    header: t("treasury.method"),
                    render: (row) => {
                      const methodMap: Record<string, string> = {
                        cash: t("treasury.expectedCash"),
                        bank_card: t("treasury.expectedCard"),
                        transfer: t("treasury.expectedTransfer"),
                        other: t("treasury.expectedOther"),
                      };
                      return methodMap[row.methodCode] || row.methodCode;
                    },
                  },
                  {
                    key: "expected",
                    header: t("treasury.expected"),
                    render: (row) => <span className="tabnum">{formatMinor(row.expectedMinor)}</span>,
                  },
                  {
                    key: "actual",
                    header: t("treasury.counted"),
                    render: (row) =>
                      row.actualMinor == null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className="tabnum">{formatMinor(row.actualMinor)}</span>
                      ),
                  },
                  {
                    key: "diff",
                    header: t("treasury.difference"),
                    render: (row) =>
                      row.actualMinor == null || row.expectedMinor === row.actualMinor ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className={`tabnum ${row.actualMinor! > row.expectedMinor ? "text-success" : "text-danger"}`}>
                          {formatMinor(Math.abs(row.actualMinor! - row.expectedMinor))}
                        </span>
                      ),
                  },
                ]}
                data={detail.methodBreakdown}
                rowKey={(row) => row.methodCode}
              />
            </Card>
          )}

          {/* Payments */}
          {detail.payments && detail.payments.length > 0 && (
            <Card>
              <CardHeader title={t("treasury.payments")} />
              <DataTable
                columns={[
                  {
                    key: "time",
                    header: t("treasury.paidAt"),
                    render: (row) => <span className="text-[12px] text-subtle tabnum">{row.paidAt.slice(0, 16)}</span>,
                  },
                  {
                    key: "member",
                    header: t("treasury.member"),
                    render: (row) =>
                      row.memberName || row.memberCode
                        ? <span className="break-all">{row.memberName ?? row.memberCode}</span>
                        : <span className="text-faint">{t("treasury.memberNotFound")}</span>,
                  },
                  {
                    key: "method",
                    header: t("treasury.method"),
                    render: (row) => {
                      const methodMap: Record<string, string> = {
                        cash: t("treasury.expectedCash"),
                        bank_card: t("treasury.expectedCard"),
                        transfer: t("treasury.expectedTransfer"),
                        other: t("treasury.expectedOther"),
                      };
                      return methodMap[row.methodCode] || row.methodCode;
                    },
                  },
                  {
                    key: "amount",
                    header: t("treasury.amount"),
                    render: (row) => <span className="tabnum">{formatMinor(row.amountMinor)}</span>,
                  },
                ]}
                data={detail.payments}
                rowKey={(row) => row.id}
              />
            </Card>
          )}

          {/* Expenses */}
          {detail.expenses && detail.expenses.length > 0 && (
            <Card>
              <CardHeader title={t("treasury.expenses")} />
              <DataTable
                columns={[
                  {
                    key: "date",
                    header: t("treasury.expenseDate"),
                    render: (row) => <span className="text-[12px] text-subtle tabnum">{row.expenseDate}</span>,
                  },
                  {
                    key: "category",
                    header: t("treasury.category"),
                    render: (row) => <span className="break-all">{row.categoryName}</span>,
                  },
                  {
                    key: "description",
                    header: t("treasury.description"),
                    render: (row) => <span className="break-all">{row.description}</span>,
                  },
                  {
                    key: "method",
                    header: t("treasury.method"),
                    render: (row) => {
                      const methodMap: Record<string, string> = {
                        cash: t("treasury.expectedCash"),
                        bank_card: t("treasury.expectedCard"),
                        transfer: t("treasury.expectedTransfer"),
                        other: t("treasury.expectedOther"),
                      };
                      return methodMap[row.methodCode] || row.methodCode;
                    },
                  },
                  {
                    key: "amount",
                    header: t("treasury.amount"),
                    render: (row) => <span className="tabnum">{formatMinor(row.amountMinor)}</span>,
                  },
                ]}
                data={detail.expenses}
                rowKey={(row) => row.id}
              />
            </Card>
          )}

          {/* Refunds */}
          {detail.refunds && detail.refunds.length > 0 && (
            <Card>
              <CardHeader title={t("treasury.refunds")} />
              <DataTable
                columns={[
                  {
                    key: "time",
                    header: t("treasury.paidAt"),
                    render: (row) => <span className="text-[12px] text-subtle tabnum">{row.paidAt.slice(0, 16)}</span>,
                  },
                  {
                    key: "payment",
                    header: t("treasury.payment"),
                    render: (row) => <span className="break-all">{row.paymentId}</span>,
                  },
                  {
                    key: "method",
                    header: t("treasury.method"),
                    render: (row) => {
                      const methodMap: Record<string, string> = {
                        cash: t("treasury.expectedCash"),
                        bank_card: t("treasury.expectedCard"),
                        transfer: t("treasury.expectedTransfer"),
                        other: t("treasury.expectedOther"),
                      };
                      return methodMap[row.methodCode] || row.methodCode;
                    },
                  },
                  {
                    key: "amount",
                    header: t("treasury.amount"),
                    render: (row) => <span className="tabnum">{formatMinor(row.amountMinor)}</span>,
                  },
                ]}
                data={detail.refunds}
                rowKey={(row) => row.id}
              />
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader title={t("treasury.historyTitle")} />
          {items.length === 0 ? (
            <EmptyState icon={<Coins />} title={t("treasury.noClosings")} />
          ) : (
            <>
              <DataTable
                columns={[
                  {
                    key: "date",
                    header: t("treasury.dateLabel"),
                    render: (row) => <span className="tabnum">{formatDateShort(new Date(row.businessDate.replace(" ", "T")))}</span>,
                  },
                  {
                    key: "box",
                    header: t("treasury.boxLabel"),
                    render: (row) =>
                      row.box === "gym" ? t("treasury.boxGym") : t("treasury.boxStore"),
                  },
                  {
                    key: "status",
                    header: t("treasury.statusLabel"),
                    render: (row) => <span className="tabnum">{formatStatus(row.status)}</span>,
                  },
                  {
                    key: "expected",
                    header: t("treasury.expectedTotal"),
                    render: (row) => <span className="tabnum">{formatMinor(row.expected.total)}</span>,
                  },
                  {
                    key: "counted",
                    header: t("treasury.countedCash"),
                    render: (row) =>
                      row.countedCashMinor == null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className="tabnum">{formatMinor(row.countedCashMinor)}</span>
                      ),
                  },
                  {
                    key: "diff",
                    header: t("treasury.difference"),
                    render: (row) =>
                      row.differenceMinor == null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <span className={`tabnum ${row.differenceMinor! > 0 ? "text-success" : "text-danger"}`}>
                          {formatMinor(Math.abs(row.differenceMinor!))}
                        </span>
                      ),
                  },
                  {
                    key: "opened",
                    header: t("treasury.openedBy"),
                    render: (row) => <span className="tabnum">{row.openedByName}</span>,
                  },
                  {
                    key: "actions",
                    header: t("treasury.actions"),
                    render: (row) => {
                      if (row.status === "open") {
                        return (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewDetails(row.id)}
                            >
                              <Coins className="size-3" />
                            </Button>
                            {canClose && (
                              <Button
                                onClick={() => {
                                  setConfirmClose({
                                    id: row.id,
                                    counted: "",
                                    reason: null,
                                  });
                                }}
                                disabled={busy}
                              >
                                <LockKeyhole className="size-3" />
                                {t("treasury.closeBtn")}
                              </Button>
                            )}
                          </div>
                        );
                      }
                      if (row.status === "closed" && canReopen) {
                        return (
                          <Button
                            onClick={() => {
                              setConfirmReopen({
                                id: row.id,
                                reason: "",
                              });
                            }}
                            disabled={busy}
                          >
                            <Coins className="size-3" />
                            {t("treasury.reopenBtn")}
                          </Button>
                        );
                      }
                      return (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewDetails(row.id)}
                        >
                          <Coins className="size-3" />
                        </Button>
                      );
                    },
                  },
                ]}
                data={items}
                rowKey={(row) => row.id}
              />
              <Pagination
                page={page}
                pageSize={20}
                total={total}
                onPageChange={setPage}
              />
            </>
          )}
        </Card>
      )}

      {/* Confirmation dialogs */}
      {confirmClose && (
        <ConfirmDialog
          open={true}
          onClose={() => setConfirmClose(null)}
          title={t("treasury.closeBtn")}
          message={
            <>
              <p className="mb-3">
                {t("treasury.closeConfirmMsg", {
                  date: formatDateShort(new Date(dateKey.replace(" ", "T"))),
                  box:
                    confirmClose.id === gymSnapshot?.closingId
                      ? t("treasury.boxGym")
                      : t("treasury.boxStore"),
                })}
              </p>
              <div className="space-y-3">
                <Input
                  label={t("treasury.countedCash")}
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={confirmClose.counted}
                  onChange={(e) => setConfirmClose((prev) => prev ? {...prev!, counted: e.target.value} : null)}
                  disabled={busy}
                />
                {confirmClose.counted !== "" && (
                  <p className="text-[12px] text-faint">
                    {t("treasury.difference")}:{" "}
                    <span className="tabnum">
                      {toMinor(confirmClose.counted) -
                        (confirmClose.id === gymSnapshot?.closingId
                          ? gymSnapshot?.expectedMinor ?? 0
                          : storeSnapshot?.expectedMinor ?? 0)}
                    </span>
                  </p>
                )}
                <Input
                  label={t("treasury.reasonLabel")}
                  placeholder={t("treasury.reasonPlaceholder")}
                  value={confirmClose.reason ?? ""}
                  onChange={(e) => setConfirmClose((prev) => prev ? {...prev!, reason: e.target.value || null} : null)}
                  disabled={busy}
                />
                {(!confirmClose.reason || confirmClose.reason.trim().length < 3) && confirmClose.counted !== "" && (
                  <p className="text-[12px] text-faint text-red">
                    {t("treasury.differenceReasonRequired")}
                  </p>
                )}
              </div>
              <p className="text-[12px] text-faint">
                {t("treasury.closeHint")}
              </p>
            </>
          }
          confirmLabel={t("common.confirm")}
          onConfirm={() => {
            if (
              !confirmClose.counted ||
              !confirmClose.reason ||
              confirmClose.reason.trim().length < 3
            ) {
              return;
            }
            handleClose(
              confirmClose.id === gymSnapshot?.closingId ? "gym" : "store",
              confirmClose.counted,
              confirmClose.reason
            );
          }}
        />
      )}
      {confirmReopen && (
        <ConfirmDialog
          open={true}
          onClose={() => setConfirmReopen(null)}
          title={t("treasury.reopenBtn")}
          message={
            <>
              <p className="mb-3">
                {t("treasury.reopenConfirmMsg")}
              </p>
              <div className="space-y-3">
                <Input
                  label={t("treasury.reasonLabel")}
                  placeholder={t("treasury.reasonPlaceholder")}
                  value={confirmReopen.reason}
                  onChange={(e) => setConfirmReopen((prev) => prev ? {...prev!, reason: e.target.value} : null)}
                  disabled={busy}
                />
                {(!confirmReopen.reason || confirmReopen.reason.trim().length < 5) && (
                  <p className="text-[12px] text-faint text-red">
                    {t("treasury.reopenReasonRequired")}
                  </p>
                )}
              </div>
            </>
          }
          confirmLabel={t("common.confirm")}
          onConfirm={() => {
            if (!confirmReopen.reason || confirmReopen.reason.trim().length < 5) {
              return;
            }
            handleReopen(confirmReopen.id, confirmReopen.reason);
          }}
        />
      )}
    </div>
  );
}

export default TreasuryPage;