import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CircleOff,
  CreditCard,
  Layers,
  Link2,
  PlusCircle,
  ShieldBan,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { appConfig } from "@/config/app.config";
import { api, type BulkRegisterResult, type CardStatus, type CardWithMember } from "@/api";
import { parseDateKey } from "@/core/dates";
import { formatDateShort, formatNumber } from "@/services/format";
import { cardStatusMeta } from "@/utils/status-meta";
import { Card, CardHeader } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
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

const STATUS_OPTIONS: Array<CardStatus | "all"> = ["all", "assigned", "available", "lost", "blocked"];

type ConfirmKind = "unassign" | "lost" | null;

export function CardsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: CardWithMember[]; total: number }>({ items: [], total: 0 });
  const [registerOpen, setRegisterOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<BulkRegisterResult | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [target, setTarget] = useState<CardWithMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((v) => v + 1);

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

  useEffect(() => {
    if (!actor) return;
    try {
      void api.cards
        .list({
          search: debounced || undefined,
          status: status as CardStatus | "all",
          page,
          pageSize: appConfig.pageSize,
        })
        .then(setData)
        .catch(console.error);
    } catch (err) {
      console.error(err);
    }
  }, [actor, debounced, status, page, reloadTick]);

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

  const runConfirm = async () => {
    if (!actor || !target || !confirmKind) return;
    setBusy(true);
    try {
      if (confirmKind === "unassign") await api.cards.unassign(target.id);
      else await api.cards.reportLost(target.id);
      toast("success", confirmKind === "unassign" ? t("cards.unassignedToast") : t("cards.lostToast"));
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

  interface Row {
    id: string;
    barcodeValue: string;
    status: CardStatus;
    memberId: string | null;
    memberName: string | null;
    assignedAtKey: string | null;
  }

  const rows: Row[] = data.items.map((c) => ({
    id: c.id,
    barcodeValue: c.barcodeValue,
    status: c.status,
    memberId: c.memberId,
    memberName: c.memberName,
    assignedAtKey: c.assignedAt?.slice(0, 10) ?? null,
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
      key: "holder",
      header: t("cards.holder"),
      render: (row) =>
        row.memberId && row.memberName ? (
          <button
            type="button"
            onClick={() => navigate(`/members/${row.memberId}`)}
            className="font-semibold hover:text-neon"
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

  if (hasPermission("cards.unassign") || hasPermission("cards.report_lost") || hasPermission("cards.block")) {
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
              <IconAction label={t("cards.actionUnassign")} onClick={() => { setTarget(original); setConfirmKind("unassign"); }}>
                <Undo2 className="size-4" />
              </IconAction>
            )}
            {hasPermission("cards.report_lost") && (original.status === "assigned" || original.status === "available") && (
              <IconAction label={t("cards.actionLost")} onClick={() => { setTarget(original); setConfirmKind("lost"); }}>
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
          </div>
        );
      },
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("nav.cards")}
          action={
            <div className="flex items-center gap-2">
              {hasPermission("cards.register") && (
                <>
                  <Button variant="secondary" onClick={() => { setBulkResult(null); setBulkText(""); setBulkOpen(true); }}>
                    <Layers className="size-4" />
                    {t("cards.bulk")}
                  </Button>
                  <Button variant="secondary" onClick={openRegister}>
                    <PlusCircle className="size-4" />
                    {t("cards.register")}
                  </Button>
                </>
              )}
              {hasPermission("cards.assign") && (
                <Button onClick={() => setAssignOpen(true)}>
                  <Link2 className="size-4" />
                  {t("cards.assign")}
                </Button>
              )}
            </div>
          }
        />
        <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center">
          <div className="sm:w-72">
            <SearchInput value={search} onValueChange={setSearch} placeholder={t("common.searchPlaceholder")} />
          </div>
          <div className="sm:w-44">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={STATUS_OPTIONS.map((s) => ({
                value: s,
                label: s === "all" ? t("common.all") : t(`cards.status${s.charAt(0).toUpperCase()}${s.slice(1)}`),
              }))}
            />
          </div>
          <p className="text-xs font-semibold text-faint tabnum sm:ms-auto">{formatNumber(data.total)}</p>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<CreditCard />} title={t("cards.empty")} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />
            <div className="border-t border-line px-5 py-3.5">
              <Pagination page={page} pageSize={appConfig.pageSize} total={data.total} onPageChange={setPage} />
            </div>
          </>
        )}
      </Card>

      <Modal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title={t("cards.register")}
        widthClass="max-w-sm"
        footer={
          <>
            <Button type="submit" form="register-card-form" loading={submitting} disabled={submitting}>
              {t("common.save")}
            </Button>
            <Button variant="secondary" onClick={() => setRegisterOpen(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <form id="register-card-form" onSubmit={(e) => { e.preventDefault(); void onRegister(); }} noValidate className="space-y-3.5">
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
            <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
              {error}
            </p>
          )}
        </form>
      </Modal>

      <AssignCardModal open={assignOpen} onClose={() => setAssignOpen(false)} onDone={reload} />

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
                void api.cards.bulkRegister(bulkText.split(/\r?\n/))
                  .then((result) => {
                    setBulkResult(result);
                    if (result.registered.length > 0) {
                      toast("success", t("cards.bulkDoneToast", { count: result.registered.length }));
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

      <ConfirmDialog
        open={confirmKind !== null}
        onClose={() => setConfirmKind(null)}
        title={confirmKind === "unassign" ? t("cards.actionUnassign") : t("cards.actionLost")}
        message={confirmKind === "unassign" ? t("cards.unassignMsg") : t("cards.lostMsg")}
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
        danger ? "text-faint hover:bg-red/10 hover:text-red" : "text-faint hover:bg-white/5 hover:text-subtle"
      }`}
    >
      {children}
    </button>
  );
}
