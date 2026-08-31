import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Award, Plus, Trash2, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, type ReferralRow, type ReferralStats, type ReferralRewardRow } from "@/api";
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

function statusBadge(status: string): BadgeVariant {
  if (status === "joined") return "success";
  if (status === "pending") return "warning";
  return "neutral";
}

function RewardMini({ r }: { r: ReferralRewardRow }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className="grid size-9 place-items-center rounded-lg bg-neon/10 text-neon">
        <Award className="size-4" />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold">
          {r.rewardType === "free_days" ? t("referral.rewardTypeFreeDays") : t("referral.rewardTypeCredit")}
        </p>
        <p className="text-xs text-subtle">
          {r.rewardType === "free_days" ? `${r.rewardValue} ${t("common.days")}` : t("common.egp") + " " + formatMinor(r.rewardValue)}
        </p>
      </div>
      <Badge variant={statusBadge(r.status)}>{t(`referral.status${r.status.charAt(0).toUpperCase() + r.status.slice(1)}`)}</Badge>
    </div>
  );
}

export function ReferralsTab({ ctx }: TabProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const member = ctx.member;

  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [rewards, setRewards] = useState<ReferralRewardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [convertTarget, setConvertTarget] = useState<ReferralRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReferralRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // form state
  const [referredName, setReferredName] = useState("");
  const [referredPhone, setReferredPhone] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s, rew, code] = await Promise.all([
        api.referral.list({ referrerId: member.id }),
        api.referral.stats(member.id),
        api.referral.listRewards(member.id),
        api.referral.getMemberCode(member.id),
      ]);
      setReferrals(r.items);
      setStats(s);
      setRewards(rew);
      setReferralCode(code);
    } catch {
      // ignore; individual errors surface via toast on actions
    } finally {
      setLoading(false);
    }
  }, [member.id]);

  useEffect(() => { load(); }, [load]);

  if (!hasPermission("referrals.view")) {
    return permissionDeniedNode(t);
  }

  const handleCreate = async () => {
    setFormError(null);
    if (referredName.trim().length < 2) {
      setFormError(t("errors.fullNameRequired"));
      return;
    }
    setSubmitting(true);
    try {
      await api.referral.create({
        referrerMemberId: member.id,
        referredName: referredName.trim(),
        referredPhone: referredPhone.trim() || null,
        notes: notes.trim() || null,
      });
      toast("success", t("referral.msgReferralCreated"));
      setReferredName(""); setReferredPhone(""); setNotes("");
      setShowCreate(false);
      await load();
    } catch (e) {
      setFormError(describeError(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConvert = async () => {
    if (!convertTarget) return;
    setSubmitting(true);
    try {
      await api.referral.convert(convertTarget.id, member.id);
      toast("success", t("referral.msgReferralConverted"));
      setConvertTarget(null);
      await load();
      ctx.reload();
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

  const cols: Column<ReferralRow>[] = [
    { key: "referredName", header: t("referral.labelReferredName"), render: (r) => <span className="font-semibold">{r.referredName}</span> },
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
        r.status === "pending" ? (
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

  const statRow = (label: string, value: number) => (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[13px] font-semibold text-subtle">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink tabnum">{value}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t("referral.labelReferralCode")}
          description={t("referral.desc")}
          action={
            referralCode ? <code dir="ltr" className="select-all rounded-lg bg-panel px-3 py-1.5 font-mono text-sm text-neon">{referralCode}</code> : null
          }
        />
      </Card>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {statRow(t("referral.statsTotal"), stats.totalReferrals)}
          {statRow(t("referral.statsConverted"), stats.convertedReferrals)}
          {statRow(t("referral.statsPending"), stats.pendingReferrals)}
          {statRow(t("referral.statsRewardsGranted"), stats.totalRewardsGranted)}
        </div>
      )}

      <Card>
        <CardHeader
          title={t("referral.tabReferrals")}
          action={
            hasPermission("referrals.manage") ? (
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="size-4" />
                {t("referral.btnCreateReferral")}
              </Button>
            ) : null
          }
        />
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-subtle">{t("common.loading")}</div>
        ) : referrals.length === 0 ? (
          <EmptyState
            icon={<UserPlus />}
            title={t("referral.emptyTitle")}
            description={t("referral.emptyDescription")}
          />
        ) : (
          <DataTable columns={cols} data={referrals} rowKey={(r) => r.id} />
        )}
      </Card>

      {rewards.length > 0 && (
        <Card>
          <CardHeader title={t("referral.btnViewRewards")} />
          <div className="divide-y divide-line">
            {rewards.map((r) => <RewardMini key={r.id} r={r} />)}
          </div>
        </Card>
      )}

      <CreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        submitting={submitting}
        error={formError}
        referredName={referredName}
        setReferredName={setReferredName}
        referredPhone={referredPhone}
        setReferredPhone={setReferredPhone}
        notes={notes}
        setNotes={setNotes}
      />

      <ConfirmDialog
        open={!!convertTarget}
        onClose={() => setConvertTarget(null)}
        onConfirm={handleConvert}
        loading={submitting}
        title={t("referral.btnConvert")}
        message={t("referral.confirmConvert")}
        confirmLabel={t("referral.btnConvert")}
        tone="primary"
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
        loading={submitting}
        title={t("referral.btnCancel")}
        message={t("referral.confirmCancel")}
        confirmLabel={t("referral.btnCancel")}
      />
    </div>
  );
}

function CreateModal({
  open,
  onClose,
  onSubmit,
  submitting,
  error,
  referredName,
  setReferredName,
  referredPhone,
  setReferredPhone,
  notes,
  setNotes,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  referredName: string;
  setReferredName: (v: string) => void;
  referredPhone: string;
  setReferredPhone: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
}) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={t("referral.btnCreateReferral")} widthClass="max-w-lg">
      <div className="space-y-3.5">
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
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
      </div>
      <div className="mt-6 flex items-center gap-2.5">
        <Button onClick={onSubmit} loading={submitting} disabled={submitting}>
          {t("referral.btnCreateReferral")}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          {t("common.cancel")}
        </Button>
      </div>
    </Modal>
  );
}
