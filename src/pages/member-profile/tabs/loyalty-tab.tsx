import { useCallback, useEffect, useState } from "react";
import { Coins, Minus, Plus, Star } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type LoyaltyBalance,
  type LoyaltyTransactionRow,
  type RedemptionItem,
} from "@/api";
import { formatMinor } from "@/core/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { TabProps } from "../types";
import { permissionDeniedNode } from "../helpers";

function kindBadge(kind: string): BadgeVariant {
  if (kind === "earn") return "success";
  if (kind === "redeem") return "warning";
  if (kind === "void") return "neutral";
  return "info";
}

function kindLabel(t: (k: string) => string, kind: string): string {
  switch (kind) {
    case "earn": return t("loyalty.kindEarn");
    case "redeem": return t("loyalty.kindRedeem");
    case "adjust": return t("loyalty.kindAdjust");
    case "void": return t("loyalty.kindVoid");
    default: return kind;
  }
}

function sourceLabel(t: (k: string) => string, source: string): string {
  switch (source) {
    case "checkin": return t("loyalty.sourceCheckin");
    case "renewal": return t("loyalty.sourceRenewal");
    case "referral": return t("loyalty.sourceReferral");
    case "store_purchase": return t("loyalty.sourceStorePurchase");
    case "manual": return t("loyalty.sourceManual");
    case "redemption": return t("loyalty.sourceRedemption");
    default: return source;
  }
}

function rewardTypeLabel(t: (k: string) => string, type: string): string {
  switch (type) {
    case "free_days": return t("loyalty.rewardTypeFreeDays");
    case "discount": return t("loyalty.rewardTypeDiscount");
    case "product": return t("loyalty.rewardTypeProduct");
    case "pt_session": return t("loyalty.rewardTypePtSession");
    case "custom": return t("loyalty.rewardTypeCustom");
    default: return type;
  }
}

export function LoyaltyTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const member = ctx.member;

  const [balance, setBalance] = useState<LoyaltyBalance | null>(null);
  const [rows, setRows] = useState<LoyaltyTransactionRow[]>([]);
  const [catalog, setCatalog] = useState<RedemptionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [redeem, setRedeem] = useState<RedemptionItem | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canManage = hasPermission("loyalty.manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bal, tx, cat] = await Promise.all([
        api.loyalty.getMemberBalance(member.id),
        api.loyalty.listMemberTransactions(member.id),
        canManage ? api.loyalty.getRedemptionCatalog() : Promise.resolve([] as RedemptionItem[]),
      ]);
      setBalance(bal);
      setRows(tx.items);
      setCatalog(cat);
    } catch {
      // errors surface via actions
    } finally {
      setLoading(false);
    }
  }, [member.id, canManage]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission("loyalty.view")) {
    return permissionDeniedNode(t);
  }

  const handleRedeem = async () => {
    if (!redeem) return;
    setSubmitting(true);
    try {
      const r = await api.loyalty.redeemReward(member.id, redeem.id);
      toast("success", `${t("loyalty.msgRedeemed")}${r.creditMinor > 0 ? ` (+${formatMinor(r.creditMinor)})` : ""}`);
      setRedeem(null);
      await load();
      ctx.reload();
    } catch (e) {
      toast("error", describeError(e, t));
      setRedeem(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjust = async () => {
    setFormError(null);
    const points = Number(adjustPoints);
    if (!Number.isInteger(points) || points === 0) {
      setFormError(t("errors.loyalty.invalidPoints"));
      return;
    }
    if (adjustReason.trim().length === 0) {
      setFormError(t("errors.loyalty.reasonRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await api.loyalty.adjustPoints(member.id, points, adjustReason.trim());
      toast("success", t("loyalty.msgAdjusted"));
      setAdjustOpen(false);
      setAdjustPoints("");
      setAdjustReason("");
      await load();
      ctx.reload();
    } catch (e) {
      setFormError(describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const cols: Column<LoyaltyTransactionRow>[] = [
    {
      key: "delta",
      header: t("loyalty.labelDelta"),
      render: (r) => (
        <span className={`font-bold tabnum ${r.delta >= 0 ? "text-emerald" : "text-red"}`}>
          {r.delta >= 0 ? `+${r.delta}` : r.delta}
        </span>
      ),
    },
    { key: "kind", header: t("loyalty.labelKind"), render: (r) => <Badge variant={kindBadge(r.kind)}>{kindLabel(t, r.kind)}</Badge> },
    { key: "source", header: t("loyalty.labelSource"), render: (r) => sourceLabel(t, r.source) },
    { key: "reason", header: t("loyalty.labelReason"), render: (r) => (r.reason ? <span className="text-subtle">{r.reason}</span> : <span className="text-faint">—</span>) },
    { key: "createdAt", header: t("loyalty.labelDate"), render: (r) => <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.createdAt}</span> },
  ];

  const stat = (icon: React.ReactNode, label: string, value: string) => (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-neon/10 text-neon">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-subtle">{label}</p>
        <p className="truncate text-2xl font-bold text-ink">{value}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat(<Star />, t("loyalty.labelBalance"), balance ? String(balance.balance) : "—")}
        {stat(<Plus />, t("loyalty.labelEarned"), balance ? String(balance.earned) : "—")}
        {stat(<Minus />, t("loyalty.labelRedeemed"), balance ? String(balance.redeemed) : "—")}
        {stat(<Coins />, t("loyalty.labelCredit"), balance ? formatMinor(balance.usableCreditMinor) : "—")}
      </div>

      {canManage && catalog.length > 0 && (
        <Card>
          <CardHeader title={t("loyalty.catalogTitle")} description={t("loyalty.emptyCatalog")} />
          <div className="grid gap-2.5 px-5 pb-5 md:grid-cols-2 lg:grid-cols-3">
            {catalog.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-panel p-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="text-xs text-subtle">
                    {rewardTypeLabel(t, r.rewardType)}{r.valueMinor != null ? ` · ${formatMinor(r.valueMinor)}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="secondary" disabled={!r.active} onClick={() => setRedeem(r)}>
                  {t("loyalty.btnRedeem")} · {r.pointsCost}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title={t("loyalty.tabLoyalty")}
          action={
            canManage ? (
              <Button variant="secondary" onClick={() => { setAdjustOpen(true); setFormError(null); }}>
                {t("loyalty.btnAdjust")}
              </Button>
            ) : null
          }
        />
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-subtle">{t("common.loading")}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Star />} title={t("loyalty.emptyTransactions")} />
        ) : (
          <DataTable columns={cols} data={rows} rowKey={(r) => r.id} />
        )}
      </Card>

      <ConfirmDialog
        open={!!redeem}
        onClose={() => setRedeem(null)}
        onConfirm={handleRedeem}
        loading={submitting}
        title={t("loyalty.btnRedeem")}
        message={redeem ? t("loyalty.confirmRedeem", { points: String(redeem.pointsCost) }) : ""}
        confirmLabel={t("loyalty.btnRedeem")}
        tone="primary"
      />

      <AdjustModal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        onSubmit={handleAdjust}
        submitting={submitting}
        error={formError}
        points={adjustPoints}
        setPoints={setAdjustPoints}
        reason={adjustReason}
        setReason={setAdjustReason}
      />
    </div>
  );
}

function AdjustModal({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
  points,
  setPoints,
  reason,
  setReason,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  points: string;
  setPoints: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
}) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={t("loyalty.btnAdjust")} widthClass="max-w-md">
      <div className="space-y-3.5">
        <Input
          label={t("loyalty.labelPoints")}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="+10 / -5"
          type="number"
        />
        <Input
          label={t("loyalty.labelReason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("loyalty.labelReason")}
        />
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </div>
      <div className="mt-6 flex items-center gap-2.5">
        <Button onClick={onSubmit} loading={submitting} disabled={submitting}>
          {t("loyalty.btnAdjust")}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          {t("common.cancel")}
        </Button>
      </div>
    </Modal>
  );
}