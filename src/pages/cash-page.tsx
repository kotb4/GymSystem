import { useEffect, useState, type FormEvent } from "react";
import { ArrowDownCircle, ArrowUpCircle, LockKeyhole, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type {
  CashTotalsForOpen,
  CashSession,
} from "@/core/services/cash-session.service";
import { formatMinor, toMinor } from "@/core/money";
import { appConfig } from "@/config/app.config";
import { formatDateShort } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function CashSessionsPanel() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();

  const [openTotals, setOpenTotals] = useState<(CashTotalsForOpen & { session: CashSession }) | null>(null);
  const [openingMajor, setOpeningMajor] = useState("");
  const [countedMajor, setCountedMajor] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CashSession[]>([]);
  const [total, setTotal] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const reload = () => setReloadTick((v) => v + 1);

  const canView = hasPermission("payments.view");

  useEffect(() => {
    if (!actor || !canView) return;
    let alive = true;
    void api.cash
      .openTotals()
      .then((totals) => {
        if (alive) {
          setOpenTotals(totals as (CashTotalsForOpen & { session: CashSession }) | null);
          setCountedMajor("");
          setCloseNote("");
        }
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [actor, canView, reloadTick]);

  useEffect(() => {
    if (!actor) return;
    let alive = true;
    void api.cash
      .list({ page, pageSize: appConfig.pageSize })
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
  }, [actor, page, reloadTick]);

  const onOpen = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setBusy(true);
    setError(null);
    try {
      await api.cash.open({ openingBalanceMinor: toMinor(openingMajor || "0") });
      toast("success", t("cashPage.openedToast"));
      setOpeningMajor("");
      reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteOpenSession = async () => {
    if (!openTotals) return;
    setBusy(true);
    setError(null);
    try {
      await api.cash.removeSession(openTotals.session.id);
      toast("success", t("cashPage.sessionDeletedToast"));
      setConfirmAbort(false);
      reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onClose = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor || !openTotals) return;
    setBusy(true);
    setError(null);
    try {
      await api.cash.close(openTotals.session.id, {
        countedClosingMinor: toMinor(countedMajor || "0"),
        closeNote: closeNote || null,
      });
      toast("success", t("cashPage.closedToast"));
      reload();
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const previewDifference =
    openTotals && countedMajor !== ""
      ? toMinor(countedMajor) - openTotals.expectedMinor
      : null;

  interface Row {
    id: string;
    openedAt: string;
    closedAt: string | null;
    openedByName: string;
    openingBalanceMinor: number;
    expectedClosingMinor: number | null;
    countedClosingMinor: number | null;
    differenceMinor: number | null;
    status: "open" | "closed";
    session: CashSession;
  }

  const rows: Row[] = items.map((s) => ({
    id: s.id,
    openedAt: s.openedAt,
    closedAt: s.closedAt,
    openedByName: s.openedByName,
    openingBalanceMinor: s.openingBalanceMinor,
    expectedClosingMinor: s.expectedClosingMinor,
    countedClosingMinor: s.countedClosingMinor,
    differenceMinor: s.differenceMinor,
    status: s.status,
    session: s,
  }));

  const columns: Column<Row>[] = [
    {
      key: "opened",
      header: t("cashPage.colOpened"),
      render: (row) => (
        <span className="tabnum text-subtle">{formatDateShort(new Date(row.openedAt.replace(" ", "T")))}</span>
      ),
    },
    {
      key: "closed",
      header: t("cashPage.colClosed"),
      render: (row) =>
        row.closedAt ? (
          <span className="tabnum text-subtle">
            {formatDateShort(new Date(row.closedAt.replace(" ", "T")))}
            <span dir="ltr" className="ms-1 text-[11px] text-faint">
              {row.closedAt.slice(11, 16)}
            </span>
          </span>
        ) : (
          <Badge variant="warning" dot>
            {t("cashPage.statusOpen")}
          </Badge>
        ),
    },
    { key: "by", header: t("cashPage.colBy"), render: (row) => <span className="text-faint">{row.openedByName}</span> },
    {
      key: "expected",
      header: t("cashPage.colExpected"),
      render: (row) => (
        <span dir="ltr" className="font-bold tabnum">
          {row.expectedClosingMinor == null ? "—" : formatMinor(row.expectedClosingMinor)}
        </span>
      ),
    },
    {
      key: "counted",
      header: t("cashPage.colCounted"),
      render: (row) => (
        <span dir="ltr" className="font-bold tabnum">
          {row.countedClosingMinor == null ? "—" : formatMinor(row.countedClosingMinor)}
        </span>
      ),
    },
    {
      key: "diff",
      header: t("cashPage.colDiff"),
      render: (row) =>
        row.differenceMinor == null ? (
          <span className="text-faint">—</span>
        ) : (
          <Badge variant={row.differenceMinor === 0 ? "success" : row.differenceMinor > 0 ? "warning" : "danger"}>
            <span dir="ltr" className="tabnum">
              {row.differenceMinor === 0
                ? t("cashPage.diffZero")
                : row.differenceMinor > 0
                  ? t("cashPage.diffSurplus", { amount: formatMinor(row.differenceMinor) })
                  : t("cashPage.diffShortage", { amount: formatMinor(-row.differenceMinor) })}
            </span>
          </Badge>
        ),
    },
  ];

  if (!canView) {
    return <EmptyState icon={<Wallet />} title={t("errors.forbidden")} />;
  }

  return (
    <div className="space-y-5">
      {openTotals ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title={t("cashPage.cardOpening")}
              value={formatMinor(openTotals.openingMinor)}
              icon={<Wallet className="size-5" />}
              accent="cyan"
            />
            <StatCard
              title={t("cashPage.cardCashIn")}
              value={formatMinor(openTotals.cashInMinor)}
              icon={<ArrowUpCircle className="size-5" />}
              accent="neon"
            />
            <StatCard
              title={t("cashPage.cardCashOut")}
              value={formatMinor(openTotals.cashOutMinor)}
              icon={<ArrowDownCircle className="size-5" />}
              accent="amber"
            />
            <StatCard
              title={t("cashPage.cardExpected")}
              value={formatMinor(openTotals.expectedMinor)}
              icon={<LockKeyhole className="size-5" />}
              accent="violet"
            />
          </section>

          {hasPermission("cash.close") && (
            <Card>
              <CardHeader title={t("cashPage.closeSession")} description={`${t("cashPage.sessionSince")} ${openTotals.session.openedAt.slice(0, 16)}`} />
              <form onSubmit={(e) => void onClose(e)} noValidate className="space-y-4 px-5 pb-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label={t("cashPage.countedBalance")}
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    value={countedMajor}
                    onChange={(e) => setCountedMajor(e.target.value)}
                    disabled={busy}
                  />
                  <Input
                    label={t("cashPage.closeNote")}
                    value={closeNote}
                    onChange={(e) => setCloseNote(e.target.value)}
                    disabled={busy}
                  />
                </div>

                {previewDifference !== null && Number.isFinite(previewDifference) && (
                  <div
                    className={`rounded-xl border px-4 py-3 text-sm font-extrabold ${
                      previewDifference === 0
                        ? "border-neon/30 bg-neon/10 text-neon"
                        : previewDifference > 0
                          ? "border-amber/30 bg-amber/10 text-amber"
                          : "border-red/30 bg-red/10 text-red"
                    }`}
                  >
                    {t("cashPage.difference")}:{" "}
                    <span dir="ltr" className="tabnum">
                      {previewDifference === 0
                        ? t("cashPage.diffZero")
                        : previewDifference > 0
                          ? t("cashPage.diffSurplus", { amount: formatMinor(previewDifference) })
                          : t("cashPage.diffShortage", { amount: formatMinor(-previewDifference) })}
                    </span>
                  </div>
                )}

                <p className="rounded-xl border border-line bg-white/[0.03] px-3.5 py-2.5 text-[12px] font-semibold text-amber">
                  {t("cashPage.closeWarning")}
                </p>

                {error && (
                  <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
                    {error}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Button type="submit" loading={busy} disabled={busy || countedMajor === ""}>
                    <LockKeyhole className="size-4" />
                    {t("cashPage.closeBtn")}
                  </Button>
                  {hasPermission("cash.purge") && (
                    <Button type="button" variant="ghost" className="text-red hover:text-red" disabled={busy}
                      onClick={() => setConfirmAbort(true)}>
                      {t("cashPage.deleteSessionBtn")}
                    </Button>
                  )}
                </div>
              </form>
            </Card>
          )}
        </>
      ) : (
        hasPermission("cash.open") && (
          <Card>
            <CardHeader title={t("cashPage.openSession")} />
            <form onSubmit={(e) => void onOpen(e)} noValidate className="max-w-md space-y-4 px-5 pb-5">
              <div>
                <Input
                  label={t("cashPage.openingBalance")}
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={openingMajor}
                  onChange={(e) => setOpeningMajor(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                <p className="mt-1 text-[11px] text-faint">{t("cashPage.openingHint")}</p>
              </div>
              {error && (
                <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
                  {error}
                </p>
              )}
              <Button type="submit" loading={busy} disabled={busy}>
                <Wallet className="size-4" />
                {t("cashPage.openBtn")}
              </Button>
            </form>
          </Card>
        )
      )}

      <Card>
        <CardHeader title={t("cashPage.historyTitle")} />
        {rows.length === 0 ? (
          <EmptyState icon={<Wallet />} title={t("cashPage.historyEmpty")} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
            <Pagination page={page} pageSize={appConfig.pageSize} total={total} onPageChange={setPage} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={confirmAbort}
        onClose={() => setConfirmAbort(false)}
        title={t("cashPage.deleteSessionBtn")}
        message={t("cashPage.deleteSessionConfirm")}
        confirmLabel={t("common.confirm")}
        onConfirm={() => void onDeleteOpenSession()}
      />
    </div>
  );
}
