import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Award, Plus, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type PublicMember,
  type ReferralRewardRow,
  type ReferralRow,
  type ReferralSettings,
  type ReferralStats,
  type TopReferrerRow,
} from "@/api";
import { formatMinor } from "@/core/money";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MemberPickerModal } from "@/components/members/member-picker-modal";

function statusBadge(status: string): BadgeVariant {
  if (status === "joined") return "success";
  if (status === "pending") return "warning";
  return "neutral";
}

function rewardValueLabel(t: (k: string) => string, r: ReferralRewardRow): string {
  return r.rewardType === "free_days"
    ? `${r.rewardValue} ${t("common.days")}`
    : t("common.egp") + " " + formatMinor(r.rewardValue);
}

export function ReferralsPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canManage = hasPermission("referrals.manage");

  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [top, setTop] = useState<TopReferrerRow[]>([]);
  const [rewards, setRewards] = useState<ReferralRewardRow[]>([]);
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [pickerFor, setPickerFor] = useState<null | "referrer" | "convert">(null);
  const [convertTarget, setConvertTarget] = useState<ReferralRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReferralRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // create-referral form
  const [referrer, setReferrer] = useState<PublicMember | null>(null);
  const [referredName, setReferredName] = useState("");
  const [referredPhone, setReferredPhone] = useState("");
  const [notes, setNotes] = useState("");

  // settings form
  const [rewardType, setRewardType] = useState<"free_days" | "credit">("free_days");
  const [rewardValue, setRewardValue] = useState("7");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, s, topRows, rew, cfg] = await Promise.all([
        api.referral.list({}),
        api.referral.stats(),
        api.referral.topReferrers(10),
        api.referral.listRewards(),
        api.referral.getSettings(),
      ]);
      setRows(list.items);
      setStats(s);
      setTop(topRows);
      setRewards(rew);
      setSettings(cfg);
      setRewardType(cfg.rewardType);
      setRewardValue(String(cfg.rewardValue));
    } catch {
      // individual errors surface via toast on actions
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setFormError(null);
    setReferredName("");
    setReferredPhone("");
    setNotes("");
    setReferrer(null);
    setShowCreate(true);
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!referrer) {
      setFormError(t("referral.chooseReferrer"));
      return;
    }
    if (referredName.trim().length < 2) {
      setFormError(t("errors.fullNameRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await api.referral.create({
        referrerMemberId: referrer.id,
        referredName: referredName.trim(),
        referredPhone: referredPhone.trim() || null,
        notes: notes.trim() || null,
      });
      toast("success", t("referral.msgReferralCreated"));
      setShowCreate(false);
      await load();
    } catch (e) {
      setFormError(describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConvertSelect = async (member: PublicMember) => {
    if (!convertTarget) return;
    setSubmitting(true);
    try {
      await api.referral.convert(convertTarget.id, member.id);
      toast("success", t("referral.msgReferralConverted"));
      setConvertTarget(null);
      await load();
    } catch (e) {
      toast("error", describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setSubmitting(true);
    try {
      await api.referral.cancel(cancelTarget.id);
      toast("success", t("referral.msgReferralCancelled"));
      setCancelTarget(null);
      await load();
    } catch (e) {
      toast("error", describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const saveSettings = async () => {
    const valueNum = Number(rewardValue);
    if (!Number.isFinite(valueNum) || valueNum < 0) {
      toast("error", t("errors.finance.invalidAmount"));
      return;
    }
    setSubmitting(true);
    try {
      await api.referral.updateSettings({ rewardType, rewardValue: valueNum });
      toast("success", t("referral.msgSettingsSaved"));
      await load();
    } catch (e) {
      toast("error", describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const cols: Column<ReferralRow>[] = [
    {
      key: "referrerName",
      header: t("referral.labelReferrer"),
      render: (r) => <span className="font-semibold">{r.referrerName}</span>,
    },
    { key: "referredName", header: t("referral.labelReferredName"), render: (r) => <span>{r.referredName}</span> },
    {
      key: "referredPhone",
      header: t("referral.labelReferredPhone"),
      render: (r) => (r.referredPhone ? <span dir="ltr" className="tabnum text-[13px]">{r.referredPhone}</span> : <span className="text-faint">—</span>),
    },
    {
      key: "status",
      header: t("referral.labelStatus"),
      render: (r) => <Badge variant={statusBadge(r.status)}>{t(`referral.status${r.status.charAt(0).toUpperCase() + r.status.slice(1)}`)}</Badge>,
    },
    { key: "createdAt", header: t("referral.labelCreatedAt"), render: (r) => <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.createdAt}</span> },
    {
      key: "convertedAt",
      header: t("referral.labelConvertedAt"),
      render: (r) => (r.convertedAt ? <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.convertedAt}</span> : <span className="text-faint">—</span>),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) =>
        r.status === "pending" && canManage ? (
          <div className="flex items-center justify-end gap-1">
            <Button size="sm" variant="secondary" onClick={() => setConvertTarget(r)} title={t("referral.btnConvert")}>
              <ArrowRight className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCancelTarget(r)} title={t("referral.btnCancel")} className="text-red">
              <Trash2 className="size-4" />
            </Button>
          </div>
        ) : null,
    },
  ];

  const statRow = (label: string, value: number | string) => (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[13px] font-semibold text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink tabnum">{value}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          {statRow(t("referral.statsTotal"), stats.totalReferrals)}
          {statRow(t("referral.statsConverted"), stats.convertedReferrals)}
          {statRow(t("referral.statsPending"), stats.pendingReferrals)}
          {statRow(t("referral.statsConversionRate"), `${stats.conversionRate}%`)}
          {statRow(t("referral.statsRewardsGranted"), stats.totalRewardsGranted)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader
              title={t("referral.tabReferrals")}
              action={canManage ? (
                <Button onClick={openCreate}>
                  <Plus className="size-4" />
                  {t("referral.btnCreateReferral")}
                </Button>
              ) : null}
            />
            {loading ? (
              <div className="px-5 py-10 text-center text-sm text-subtle">{t("common.loading")}</div>
            ) : rows.length === 0 ? (
              <EmptyState icon={<UserPlus />} title={t("referral.emptyTitle")} description={t("referral.emptyDescription")} />
            ) : (
              <DataTable columns={cols} data={rows} rowKey={(r) => r.id} />
            )}
          </Card>

          {rewards.length > 0 && (
            <Card>
              <CardHeader title={t("referral.btnViewRewards")} />
              <div className="divide-y divide-line">
                {rewards.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="grid size-9 place-items-center rounded-lg bg-neon/10 text-neon">
                      <Award className="size-4" />
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">
                        {r.rewardType === "free_days" ? t("referral.rewardTypeFreeDays") : t("referral.rewardTypeCredit")}
                      </p>
                      <p className="text-xs text-subtle">
                        {r.referrerName} · {rewardValueLabel(t, r)}
                      </p>
                    </div>
                    <Badge variant={statusBadge(r.status)}>{t(`referral.status${r.status.charAt(0).toUpperCase() + r.status.slice(1)}`)}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t("referral.topReferrersTitle")} />
            {top.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-subtle">{t("referral.emptyTopReferrers")}</div>
            ) : (
              <ul className="divide-y divide-line">
                {top.map((row) => (
                  <li key={row.referrerId} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{row.referrerName}</p>
                      <p className="text-xs text-subtle">
                        {row.convertedReferrals} {t("referral.statsConverted")}
                      </p>
                    </div>
                    <Badge variant="neutral">{row.totalReferrals}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {settings && canManage && (
            <Card>
              <CardHeader title={t("referral.settingsTitle")} />
              <div className="space-y-3.5 px-5 pb-5">
                <Select
                  label={t("referral.settingRewardType")}
                  value={rewardType}
                  onChange={(e) => setRewardType(e.target.value as "free_days" | "credit")}
                  options={[
                    { value: "free_days", label: t("referral.rewardTypeFreeDays") },
                    { value: "credit", label: t("referral.rewardTypeCredit") },
                  ]}
                />
                <Input
                  label={t("referral.settingRewardValue")}
                  type="number"
                  min={0}
                  dir="ltr"
                  value={rewardValue}
                  onChange={(e) => setRewardValue(e.target.value)}
                />
                <Button onClick={saveSettings} loading={submitting} disabled={submitting} className="w-full">
                  {t("common.save")}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      {showCreate && (
        <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("referral.btnCreateReferral")} widthClass="max-w-lg">
          <div className="space-y-3.5">
            <div>
              <span className="mb-1.5 block text-[13px] font-semibold text-subtle">{t("referral.labelReferrer")}</span>
              {referrer ? (
                <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{referrer.fullName}</span>
                    <span dir="ltr" className="block text-[11px] text-faint tabnum">
                      {referrer.memberCode}{referrer.phone ? ` · ${referrer.phone}` : ""}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setPickerFor("referrer")}>
                    {t("referral.btnChangeReferrer")}
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setPickerFor("referrer")} className="w-full justify-center">
                  <UserPlus className="size-4" />
                  {t("referral.chooseReferrer")}
                </Button>
              )}
            </div>
            <Input
              label={t("referral.labelReferredName")}
              value={referredName}
              onChange={(e) => setReferredName(e.target.value)}
              placeholder={t("referral.labelReferredName")}
              required
            />
            <Input
              label={t("referral.labelReferredPhone")}
              value={referredPhone}
              onChange={(e) => setReferredPhone(e.target.value)}
              placeholder={t("referral.labelReferredPhone")}
              type="tel"
              dir="ltr"
            />
            <Input
              label={t("referral.labelNotes")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("referral.labelNotes")}
            />
            {formError && (
              <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
                {formError}
              </p>
            )}
          </div>
          <div className="mt-6 flex items-center gap-2.5">
            <Button onClick={handleCreate} loading={submitting} disabled={submitting}>
              {t("referral.btnCreateReferral")}
            </Button>
            <Button variant="secondary" onClick={() => setShowCreate(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
          </div>
        </Modal>
      )}

      {pickerFor === "referrer" && (
        <MemberPickerModal
          open
          onClose={() => setPickerFor(null)}
          onSelect={(m) => { setReferrer(m); setPickerFor(null); }}
        />
      )}
      {pickerFor === "convert" && (
        <MemberPickerModal
          open
          onClose={() => setPickerFor(null)}
          onSelect={(m) => { void handleConvertSelect(m); }}
        />
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
        loading={submitting}
        title={t("referral.btnCancel")}
        message={t("referral.confirmCancel")}
        confirmLabel={t("referral.btnCancel")}
      />

      <ConfirmDialog
        open={!!convertTarget}
        onClose={() => { setConvertTarget(null); }}
        onConfirm={() => { setPickerFor("convert"); }}
        loading={false}
        title={t("referral.btnConvert")}
        message={t("referral.confirmConvert")}
        confirmLabel={t("referral.btnConvert")}
      />
    </div>
  );
}