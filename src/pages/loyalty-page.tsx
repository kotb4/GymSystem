import { useCallback, useEffect, useState } from "react";
import { Gift, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type EarnAction,
  type EarnRule,
  type EarnRuleInput,
  type LoyaltySettings,
  type ProductPublic,
  type RedemptionInput,
  type RedemptionItem,
  type RewardType,
} from "@/api";
import { formatMinor } from "@/core/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const ACTIONS: { value: EarnAction; labelKey: string }[] = [
  { value: "checkin", labelKey: "loyalty.actionCheckin" },
  { value: "renewal", labelKey: "loyalty.actionRenewal" },
  { value: "referral", labelKey: "loyalty.actionReferral" },
  { value: "store_purchase", labelKey: "loyalty.actionStorePurchase" },
];

const REWARD_TYPES: { value: RewardType; labelKey: string }[] = [
  { value: "discount", labelKey: "loyalty.rewardTypeDiscount" },
  { value: "free_days", labelKey: "loyalty.rewardTypeFreeDays" },
  { value: "pt_session", labelKey: "loyalty.rewardTypePtSession" },
  { value: "product", labelKey: "loyalty.rewardTypeProduct" },
  { value: "custom", labelKey: "loyalty.rewardTypeCustom" },
];

function rewardBadge(type: string, active: boolean): BadgeVariant {
  if (!active) return "neutral";
  if (type === "discount") return "success";
  if (type === "custom") return "info";
  return "violet";
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

export function LoyaltyPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [settings, setSettings] = useState<LoyaltySettings | null>(null);
  const [rules, setRules] = useState<EarnRule[]>([]);
  const [catalog, setCatalog] = useState<RedemptionItem[]>([]);
  const [products, setProducts] = useState<ProductPublic[]>([]);
  const [loading, setLoading] = useState(true);

  const [ruleModal, setRuleModal] = useState<{ open: boolean; target: EarnRule | null }>({ open: false, target: null });
  const [rewardModal, setRewardModal] = useState<{ open: boolean; target: RedemptionItem | null }>({ open: false, target: null });
  const [removeRuleTarget, setRemoveRuleTarget] = useState<EarnRule | null>(null);
  const [toggleTarget, setToggleTarget] = useState<RedemptionItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManage = hasPermission("loyalty.manage");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, c, p] = await Promise.all([
        api.loyalty.getSettings(),
        api.loyalty.getEarnRules(),
        api.loyalty.getRedemptionCatalog(),
        api.store.listProducts({}).then((res) => res.items).catch(() => [] as ProductPublic[]),
      ]);
      setSettings(s);
      setRules(r);
      setCatalog(c);
      setProducts(p);
    } catch {
      // errors surface via actions
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleRewardEnabled = async (next: boolean) => {
    setSubmitting(true);
    try {
      await api.loyalty.updateSettings({ rewardEnabled: next });
      toast("success", t("loyalty.msgSaved"));
      await load();
    } catch (e) {
      toast("error", describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const saveRule = async (input: EarnRuleInput) => {
    setSubmitting(true);
    try {
      await api.loyalty.upsertEarnRule(input);
      toast("success", t("loyalty.msgRuleSaved"));
      setRuleModal({ open: false, target: null });
      await load();
    } catch (e) {
      toast("error", describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const removeRule = async () => {
    if (!removeRuleTarget) return;
    setSubmitting(true);
    try {
      await api.loyalty.removeEarnRule(removeRuleTarget.action);
      toast("success", t("loyalty.msgSaved"));
      setRemoveRuleTarget(null);
      await load();
    } catch (e) {
      toast("error", describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const saveReward = async (input: RedemptionInput) => {
    setSubmitting(true);
    try {
      await api.loyalty.upsertRedemption(input);
      toast("success", t("loyalty.msgCatalogSaved"));
      setRewardModal({ open: false, target: null });
      await load();
    } catch (e) {
      toast("error", describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRewardActive = async () => {
    if (!toggleTarget) return;
    setSubmitting(true);
    try {
      await api.loyalty.setRedemptionActive(toggleTarget.id, !toggleTarget.active);
      toast("success", t("loyalty.msgSaved"));
      setToggleTarget(null);
      await load();
    } catch (e) {
      toast("error", describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const ruleCols: Column<EarnRule>[] = [
    {
      key: "action",
      header: t("loyalty.earnRuleAction"),
      render: (r) => rewardTypeLabel(t, r.action),
    },
    {
      key: "value",
      header: t("loyalty.labelPoints"),
      render: (r) => (
        <span className="font-bold tabnum">
          {r.pointsPerMinor != null && r.pointsPerMinor > 0
            ? `${t("loyalty.earnRulePointsPerEgp")}: ${r.pointsPerMinor}`
            : r.points}
        </span>
      ),
    },
    {
      key: "minSpend",
      header: t("loyalty.earnRuleMinSpend"),
      render: (r) => (r.minMinor != null ? formatMinor(r.minMinor) : <span className="text-faint">—</span>),
    },
    {
      key: "enabled",
      header: t("loyalty.earnRuleEnabled"),
      render: (r) => (r.enabled ? <Badge variant="success">{t("loyalty.labelEnable")}</Badge> : <Badge variant="neutral">{t("common.no")}</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setRuleModal({ open: true, target: r })} title={t("common.edit")}>
              <Pencil className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" className="text-red" onClick={() => setRemoveRuleTarget(r)} title={t("common.delete")}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ) : null,
    },
  ];

  const rewardCols: Column<RedemptionItem>[] = [
    {
      key: "title",
      header: t("loyalty.labelRewardTitle"),
      render: (r) => <span className="font-semibold">{r.title}</span>,
    },
    {
      key: "type",
      header: t("loyalty.rewardTypeCustom"),
      render: (r) => <Badge variant={rewardBadge(r.rewardType, r.active)}>{rewardTypeLabel(t, r.rewardType)}</Badge>,
    },
    {
      key: "value",
      header: t("loyalty.labelValue"),
      render: (r) => {
        if (r.valueMinor != null) return <span className="tabnum">{formatMinor(r.valueMinor)}</span>;
        if (r.days != null) return <span className="tabnum">{r.days} {t("common.days")}</span>;
        if (r.sessions != null) return <span className="tabnum">{r.sessions}</span>;
        return <span className="text-faint">—</span>;
      },
    },
    {
      key: "cost",
      header: t("loyalty.labelPointsCost"),
      render: (r) => <span className="font-bold tabnum">{r.pointsCost}</span>,
    },
    {
      key: "active",
      header: t("loyalty.labelActive"),
      render: (r) => (r.active ? <Badge variant="success">{t("loyalty.labelRewardActive")}</Badge> : <Badge variant="neutral">{t("loyalty.labelRewardInactive")}</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setRewardModal({ open: true, target: r })} title={t("loyalty.btnEditReward")}>
              <Pencil className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setToggleTarget(r)} title={r.active ? t("loyalty.btnDeactivateReward") : t("loyalty.btnActivateReward")}>
              <Power className={r.active ? "size-4 text-red" : "size-4 text-emerald"} />
            </Button>
          </div>
        ) : null,
    },
  ];

  if (loading) {
    return <p className="py-16 text-center text-sm text-faint">{t("common.loading")}</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("loyalty.settingsTitle")} description={t("loyalty.descRewardEnabled")} />
        <div className="space-y-4 px-5 pb-5">
          {settings && (
            <Checkbox checked={settings.rewardEnabled} onCheckedChange={toggleRewardEnabled} disabled={submitting}>
              {t("loyalty.settingRewardEnabled")}
            </Checkbox>
          )}
          {settings && settings.storePointsPerEgp > 0 && (
            <p className="text-xs text-subtle">
              {t("loyalty.descStorePointsPerEgp", { points: String(settings.storePointsPerEgp) })}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("loyalty.earnRulesTitle")}
          description={t("loyalty.earnRulesDesc")}
          action={
            canManage ? (
              <Button onClick={() => setRuleModal({ open: true, target: null })}>
                <Plus className="size-4" />
                {t("loyalty.btnAddRule")}
              </Button>
            ) : null
          }
        />
        {rules.length === 0 ? (
          <EmptyState icon={<Gift />} title={t("loyalty.emptyRules")} />
        ) : (
          <DataTable columns={ruleCols} data={rules} rowKey={(r) => r.action} />
        )}
      </Card>

      <Card>
        <CardHeader
          title={t("loyalty.catalogTitle")}
          description={t("loyalty.catalogDesc")}
          action={
            canManage ? (
              <Button onClick={() => setRewardModal({ open: true, target: null })}>
                <Plus className="size-4" />
                {t("loyalty.btnAddReward")}
              </Button>
            ) : null
          }
        />
        {catalog.length === 0 ? (
          <EmptyState icon={<Gift />} title={t("loyalty.emptyCatalog")} />
        ) : (
          <DataTable columns={rewardCols} data={catalog} rowKey={(r) => r.id} />
        )}
      </Card>

      {ruleModal.open && (
        <EarnRuleModal
          open
          target={ruleModal.target}
          onClose={() => setRuleModal({ open: false, target: null })}
          onSubmit={saveRule}
          submitting={submitting}
        />
      )}
      {rewardModal.open && (
        <RewardModal
          open
          target={rewardModal.target}
          products={products}
          onClose={() => setRewardModal({ open: false, target: null })}
          onSubmit={saveReward}
          submitting={submitting}
        />
      )}

      <ConfirmDialog
        open={!!removeRuleTarget}
        onClose={() => setRemoveRuleTarget(null)}
        onConfirm={removeRule}
        loading={submitting}
        title={t("loyalty.btnRemoveRule")}
        message={t("loyalty.confirmRemoveRule")}
        confirmLabel={t("common.delete")}
      />
      <ConfirmDialog
        open={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={toggleRewardActive}
        loading={submitting}
        title={toggleTarget?.active ? t("loyalty.btnDeactivateReward") : t("loyalty.btnActivateReward")}
        message={t("loyalty.confirmDeactivateReward")}
        confirmLabel={toggleTarget?.active ? t("loyalty.btnDeactivateReward") : t("loyalty.btnActivateReward")}
      />
    </div>
  );
}

function EarnRuleModal({
  open,
  target,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  target: EarnRule | null;
  onClose: () => void;
  onSubmit: (input: EarnRuleInput) => void;
  submitting: boolean;
}) {
  const t = useT();
  const [action, setAction] = useState<string>("checkin");
  const [points, setPoints] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [pointsPerEgp, setPointsPerEgp] = useState("");
  const [minSpend, setMinSpend] = useState("");

  useEffect(() => {
    if (!open) return;
    setAction(target?.action ?? "checkin");
    setPoints(target ? String(target.points) : "10");
    setEnabled(target?.enabled ?? true);
    setPointsPerEgp(target?.pointsPerMinor != null ? String(target.pointsPerMinor) : "");
    setMinSpend(target?.minMinor != null ? String(Number(target.minMinor) / 100) : "");
  }, [open, target]);

  const handleSave = () => {
    const pts = Number(pointsPerEgp) > 0
      ? { pointsPerMinor: Number(pointsPerEgp), points: 0 }
      : { points: Number(points), pointsPerMinor: undefined as number | undefined };
    onSubmit({
      action: action as EarnAction,
      points: pts.points,
      enabled,
      pointsPerMinor: (pts as { pointsPerMinor?: number }).pointsPerMinor,
      minMinor: minSpend ? Math.round(Number(minSpend) * 100) : undefined,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={target ? t("common.edit") : t("loyalty.btnAddRule")} widthClass="max-w-md">
      <div className="space-y-3.5">
        <Select
          label={t("loyalty.earnRuleAction")}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          options={ACTIONS.map((a) => ({ value: a.value, label: t(a.labelKey) }))}
        />
        {Number(pointsPerEgp) > 0 ? (
          <>
            <Input
              label={t("loyalty.earnRulePointsPerEgp")}
              type="number"
              value={pointsPerEgp}
              onChange={(e) => setPointsPerEgp(e.target.value)}
              placeholder="1"
            />
            <Input
              label={t("loyalty.labelStorePurchaseMin")}
              type="number"
              value={minSpend}
              onChange={(e) => setMinSpend(e.target.value)}
              placeholder="100"
            />
          </>
        ) : (
          <Input
            label={t("loyalty.labelPoints")}
            type="number"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="10"
          />
        )}
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-neon)]"
          />
          <span className="text-sm text-subtle">{t("loyalty.earnRuleEnabled")}</span>
        </label>
      </div>
      <div className="mt-6 flex items-center gap-2.5">
        <Button onClick={handleSave} loading={submitting} disabled={submitting}>
          {t("common.save")}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          {t("common.cancel")}
        </Button>
      </div>
    </Modal>
  );
}

function RewardModal({
  open,
  target,
  products,
  onClose,
  onSubmit,
  submitting,
}: {
  open: boolean;
  target: RedemptionItem | null;
  products: ProductPublic[];
  onClose: () => void;
  onSubmit: (input: RedemptionInput) => void;
  submitting: boolean;
}) {
  const t = useT();
  const [type, setType] = useState<string>("discount");
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState("");
  const [value, setValue] = useState("");
  const [days, setDays] = useState("");
  const [sessions, setSessions] = useState("");
  const [productId, setProductId] = useState("");

  useEffect(() => {
    if (!open) return;
    setType(target?.rewardType ?? "discount");
    setTitle(target?.title ?? "");
    setCost(target ? String(target.pointsCost) : "");
    setValue(target?.valueMinor != null ? String(Number(target.valueMinor) / 100) : "");
    setDays(target?.days != null ? String(target.days) : "");
    setSessions(target?.sessions != null ? String(target.sessions) : "");
    setProductId(target?.productId ?? "");
  }, [open, target]);

  const handleSave = () => {
    const input: RedemptionInput = {
      rewardType: type === "free_days" ? "free_days" : (type as RewardType),
      title: title.trim(),
      pointsCost: Math.max(1, Math.round(Number(cost) || 0)),
    };
    if (type === "discount") input.valueMinor = value ? Math.round(Number(value) * 100) : undefined;
    if (type === "free_days") input.days = Math.max(1, Math.round(Number(days) || 0));
    if (type === "pt_session") input.sessions = Math.max(1, Math.round(Number(sessions) || 0));
    if (type === "product") input.productId = productId || undefined;
    onSubmit(input);
  };

  return (
    <Modal open={open} onClose={onClose} title={target ? t("loyalty.btnEditReward") : t("loyalty.btnAddReward")} widthClass="max-w-md">
      <div className="space-y-3.5">
        <Select
          label={t("loyalty.rewardTypeCustom")}
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={REWARD_TYPES.map((r) => ({ value: r.value, label: t(r.labelKey) }))}
        />
        <Input
          label={t("loyalty.labelRewardTitle")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("loyalty.labelRewardTitle")}
        />
        <Input
          label={t("loyalty.labelPointsCost")}
          type="number"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          placeholder="100"
        />
        {type === "discount" && (
          <Input
            label={t("loyalty.labelValue")}
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="100"
          />
        )}
        {type === "free_days" && (
          <Input
            label={t("loyalty.labelDays")}
            type="number"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="1"
          />
        )}
        {type === "pt_session" && (
          <Input
            label={t("loyalty.labelSessions")}
            type="number"
            value={sessions}
            onChange={(e) => setSessions(e.target.value)}
            placeholder="1"
          />
        )}
        {type === "product" && (
          <Select
            label={t("loyalty.labelProduct")}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            options={products.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}
      </div>
      <div className="mt-6 flex items-center gap-2.5">
        <Button onClick={handleSave} loading={submitting} disabled={submitting}>
          {t("common.save")}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          {t("common.cancel")}
        </Button>
      </div>
    </Modal>
  );
}