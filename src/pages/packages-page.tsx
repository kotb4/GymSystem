import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Power, Plus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type AccessArea, type Package, type PackageModel, type PackageStats } from "@/api";
import { formatMinor } from "@/core/money";
import { formatNumber } from "@/services/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PackageFormModal } from "@/components/subscriptions/package-form-modal";

type StatusFilter = "all" | "active" | "inactive";
type ModelFilter = "all" | PackageModel;

const MODEL_LABEL: Record<PackageModel, string> = {
  time: "modelTime",
  visit: "modelVisit",
  hybrid: "modelHybrid",
};

const AREA_LABEL: Record<AccessArea, string> = {
  general: "areaGeneral",
  men: "areaMen",
  women: "areaWomen",
};

export function PackagesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const [tab, setTab] = useState("packages");
  const [packages, setPackages] = useState<Package[]>([]);
  const [stats, setStats] = useState<PackageStats | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modelFilter, setModelFilter] = useState<ModelFilter>("all");
  const [formModal, setFormModal] = useState<{ open: boolean; target: Package | null }>({ open: false, target: null });
  const [deactivateTarget, setDeactivateTarget] = useState<Package | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareSelect, setCompareSelect] = useState("");

  const canManage = hasPermission("packages.edit");
  const canCreate = hasPermission("packages.create");

  const reload = useCallback(() => {
    api.packages.list(true).then(setPackages).catch(console.error);
    api.packages.stats().then(setStats).catch(console.error);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(
    () =>
      packages.filter(
        (p) =>
          (statusFilter === "all" || (statusFilter === "active" ? p.isActive : !p.isActive)) &&
          (modelFilter === "all" || p.model === modelFilter)
      ),
    [packages, statusFilter, modelFilter]
  );

  const bundledModelCount = useMemo(() => {
    const map: Record<PackageModel, number> = { time: 0, visit: 0, hybrid: 0 };
    for (const p of packages) map[p.model] += 1;
    return map;
  }, [packages]);

  const doToggle = async (p: Package, active: boolean) => {
    try {
      await api.packages.toggle(p.id, active);
      toast("success", active ? t("packages.toggledActiveToast") : t("packages.toggledInactiveToast"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const doDuplicate = async (p: Package) => {
    try {
      await api.packages.duplicate(p.id);
      toast("success", t("packages.duplicateToast"));
      reload();
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const addToCompare = () => {
    if (!compareSelect) return;
    setCompareIds((prev) => (prev.includes(compareSelect) ? prev : [...prev, compareSelect]));
    setCompareSelect("");
  };

  const comparePackages = useMemo(
    () => packages.filter((p) => compareIds.includes(p.id)),
    [packages, compareIds]
  );

  const renderFeature = (p: Package | null, feature: (p: Package) => string) =>
    p ? feature(p) : <span className="text-faint">—</span>;

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "packages", label: t("packages.tabPackages") },
          { value: "compare", label: t("packages.tabCompare") },
        ]}
      />

      {tab === "packages" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label={t("packages.statsTitle")} value={t("packages.statsTotalPackages")} count={formatNumber(stats?.totalPackages ?? 0)} />
            <StatTile label={t("packages.statPackages")} value={t("packages.statsActivePackages")} count={formatNumber(stats?.activePackages ?? 0)} tone="neon" />
            <StatTile label={t("packages.statSubscriptions")} value={t("packages.statsTotalSubs")} count={formatNumber(stats?.totalSubscriptions ?? 0)} />
            <StatTile label={t("packages.statsRevenue")} value={t("packages.statRevenue")} count={formatMinor(stats?.perPackage.reduce((s, x) => s + x.revenueMinor, 0) ?? 0)} tone="neon" />
            <StatTile
              label={t("packages.filterModel")}
              value={`${t("packages.modelTime")} ${bundledModelCount.time} · ${t("packages.modelVisit")} ${bundledModelCount.visit} · ${t("packages.modelHybrid")} ${bundledModelCount.hybrid}`}
              count=""
            />
          </div>

          <Card>
            <CardHeader
              title={t("packages.title")}
              action={
                canCreate ? (
                  <Button onClick={() => setFormModal({ open: true, target: null })}>
                    <Plus className="size-4" />
                    {t("packages.addPackage")}
                  </Button>
                ) : undefined
              }
            />
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                options={[
                  { value: "all", label: t("packages.filterAll") },
                  { value: "active", label: t("packages.filterActive") },
                  { value: "inactive", label: t("packages.filterInactive") },
                ]}
              />
              <Select
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value as ModelFilter)}
                options={[
                  { value: "all", label: t("packages.filterAll") },
                  { value: "time", label: t("packages.modelTime") },
                  { value: "visit", label: t("packages.modelVisit") },
                  { value: "hybrid", label: t("packages.modelHybrid") },
                ]}
              />
            </div>
            {filtered.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={<Plus />} title={t("packages.emptyFiltered")} />
              </div>
            ) : (
              <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => (
                  <div key={p.id} className={`rounded-xl border p-4 ${p.isActive ? "border-line bg-panel" : "border-line bg-panel/50 opacity-80"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-extrabold">{p.name}</p>
                      <Badge variant={p.isActive ? "success" : "neutral"} dot>{p.isActive ? t("packages.active") : t("packages.inactive")}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant="info">{t(MODEL_LABEL[p.model])}</Badge>
                      <span className="tabnum text-sm font-bold text-neon">{formatMinor(p.price)}</span>
                    </div>
                    <ul className="mt-3 space-y-1 text-[12px] text-subtle">
                      <li>{t("packages.durationDays")}: <span className="tabnum">{formatNumber(p.durationDays)} {t("packages.dayUnit")}</span></li>
                      {p.model !== "time" && (
                        <li>{t("packages.visitLimit")} ({t(MODEL_LABEL[p.model])}): <span className="tabnum">{p.unlimitedVisits ? t("packages.unlimited") : formatNumber(p.visitLimit ?? 0)} {t("packages.visitsUnit")}</span></li>
                      )}
                      <li>{t("packages.freezeAllowanceDays")}: <span className="tabnum">{formatNumber(p.freezeAllowanceDays)} {t("packages.dayUnit")}</span> / {t("packages.allowedFreezes")}: <span className="tabnum">{formatNumber(p.allowedFreezes)}</span></li>
                      {p.ptSessions > 0 && <li>{t("packages.ptSessions")}: <span className="tabnum">{formatNumber(p.ptSessions)} {t("packages.ptUnit")}</span></li>}
                      {p.allowedAreas.length > 0 && (
                        <li>{t("packages.allowedAreas")}: <span className="flex flex-wrap gap-1 pt-0.5">{p.allowedAreas.map((a) => <Badge key={a} variant="neutral">{t(AREA_LABEL[a])}</Badge>)}</span></li>
                      )}
                      {p.description && <li className="text-faint">{p.description}</li>}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {canManage && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setFormModal({ open: true, target: p })}>
                            <Pencil className="size-3.5" />
                            {t("common.edit")}
                          </Button>
                          {p.isActive ? (
                            <Button size="sm" variant="ghost" onClick={() => setDeactivateTarget(p)}>
                              <Power className="size-3.5" />
                              {t("packages.deactivateToggle")}
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => void doToggle(p, true)}>
                              <Power className="size-3.5" />
                              {t("packages.activeToggle")}
                            </Button>
                          )}
                        </>
                      )}
                      {canCreate && (
                        <Button size="sm" variant="ghost" onClick={() => void doDuplicate(p)}>
                          <Copy className="size-3.5" />
                          {t("packages.duplicate")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "compare" && (
        <Card>
          <CardHeader title={t("packages.compareTitle")} />
          <div className="p-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1">
                <Select
                  value={compareSelect}
                  onChange={(e) => setCompareSelect(e.target.value)}
                  options={[
                    { value: "", label: t("packages.compareSelect") },
                    ...packages.filter((p) => !compareIds.includes(p.id)).map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </div>
              <Button variant="secondary" onClick={addToCompare} disabled={!compareSelect}>
                {t("packages.addSelected")}
              </Button>
            </div>

            {comparePackages.length === 0 ? (
              <div className="mt-5">
                <EmptyState icon={<Plus />} title={t("packages.compareSelect")} />
              </div>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="px-3 py-2.5 text-start text-[13px] font-semibold text-faint">{t("packages.compareFeature")}</th>
                      {comparePackages.map((p) => (
                        <th key={p.id} className="px-3 py-2.5 text-start">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold">{p.name}</span>
                            {canManage && (
                              <button type="button" className="text-[11px] font-semibold text-faint hover:text-red" onClick={() => setCompareIds((prev) => prev.filter((id) => id !== p.id))}>
                                {t("packages.removeSelected")}
                              </button>
                            )}
                          </div>
                          <Badge variant={p.isActive ? "success" : "neutral"} dot>{p.isActive ? t("packages.active") : t("packages.inactive")}</Badge>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-subtle">
                    {[
                      { label: t("packages.compareModel"), fn: (p: Package) => t(MODEL_LABEL[p.model]) },
                      { label: t("packages.compareDuration"), fn: (p: Package) => `${formatNumber(p.durationDays)} ${t("packages.dayUnit")}` },
                      { label: t("packages.comparePrice"), fn: (p: Package) => formatMinor(p.price) },
                      { label: t("packages.compareVisits"), fn: (p: Package) => p.model === "time" ? t("packages.none") : p.unlimitedVisits ? t("packages.unlimited") : `${formatNumber(p.visitLimit ?? 0)} ${t("packages.visitsUnit")}` },
                      { label: t("packages.compareFreeze"), fn: (p: Package) => `${formatNumber(p.freezeAllowanceDays)} ${t("packages.dayUnit")} / ${formatNumber(p.allowedFreezes)}` },
                      { label: t("packages.comparePt"), fn: (p: Package) => p.ptSessions > 0 ? `${formatNumber(p.ptSessions)} ${t("packages.ptUnit")}` : t("packages.none") },
                      { label: t("packages.compareAreas"), fn: (p: Package) => p.allowedAreas.length ? p.allowedAreas.map((a) => t(AREA_LABEL[a])).join(" · ") : t("packages.none") },
                    ].map((row) => (
                      <tr key={row.label} className="border-b border-line/60">
                        <td className="px-3 py-2.5 font-semibold text-faint">{row.label}</td>
                        {comparePackages.map((p) => (
                          <td key={p.id} className="px-3 py-2.5 tabnum">{renderFeature(p, row.fn)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      <PackageFormModal
        open={formModal.open}
        onClose={() => setFormModal({ open: false, target: null })}
        onSaved={reload}
        pkg={formModal.target}
      />
      <ConfirmDialog
        open={deactivateTarget !== null}
        title={t("packages.deactivateToggle")}
        message={deactivateTarget ? `«${deactivateTarget.name}» — ${t("common.confirm")}?` : ""}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => {
          if (deactivateTarget) void doToggle(deactivateTarget, false);
          setDeactivateTarget(null);
        }}
      />
    </div>
  );
}

function StatTile({ label, value, count, tone }: { label: string; value: string; count: string; tone?: "neon" }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-[11px] font-semibold text-faint">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tabnum ${tone === "neon" ? "text-neon" : "text-ink"}`}>{count}</p>
      <p className="mt-0.5 text-[11px] text-subtle">{value}</p>
    </div>
  );
}
