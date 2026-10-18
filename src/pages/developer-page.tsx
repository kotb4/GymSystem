import { useEffect, useState, useCallback } from "react";
import {
  KeyRound,
  RefreshCw,
  PowerOff,
  Unlock,
  Lock,
  Clock,
  HardDriveDownload,
  Copy,
  Check,
  AlertTriangle,
  RotateCcw,
  Trash2,
  Database,
  CalendarDays,
  X,
} from "lucide-react";
import { api } from "@/api";
import { todayKey, setDevOverrideDate } from "@/core/dates";
import type { DeveloperOverview, DeveloperOverviewUser } from "@/core/services/developer.service";
import type { LicenseStatus, DbIntegrityResult, FeatureFlags, SystemTelemetry } from "@/api";
import { useT } from "@/i18n";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { SimpleNetworkCard } from "@/components/settings/simple-network-card";

type DevTab = "overview" | "users" | "maintenance" | "flags" | "telemetry" | "network";


export function DeveloperPage() {
  const t = useT();
  const { toast } = useToast();

  const [tab, setTab] = useState<DevTab>("overview");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<DeveloperOverview | null>(null);
  const [licStatus, setLicStatus] = useState<LicenseStatus | null>(null);

  // New features state
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [integrityResult, setIntegrityResult] = useState<DbIntegrityResult | null>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);
  const [vacuumingDb, setVacuumingDb] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Modals state
  const [installLicOpen, setInstallLicOpen] = useState(false);
  const [licJson, setLicJson] = useState("");
  const [licSubmitting, setLicSubmitting] = useState(false);

  const [graceModalOpen, setGraceModalOpen] = useState(false);
  const [graceDaysChoice, setGraceDaysChoice] = useState<number>(7);

  const [emergencyOwnerResetOpen, setEmergencyOwnerResetOpen] = useState(false);
  const [emergencyOwnerPassword, setEmergencyOwnerPassword] = useState("");
  const [emergencyOwnerSubmitting, setEmergencyOwnerSubmitting] = useState(false);

  const [resetPassModalOpen, setResetPassModalOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [targetUserName, setTargetUserName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passSubmitting, setPassSubmitting] = useState(false);

  const [copiedHwid, setCopiedHwid] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Date override state
  const [devDate, setDevDate] = useState<string>(todayKey());
  const [devOverride, setDevOverride] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [ov, lic, flags, tel, currentOverride] = await Promise.all([
        api.dev.getOverview(),
        api.license.status(),
        api.dev.getFeatureFlags().catch(() => null),
        api.dev.getSystemTelemetry().catch(() => null),
        api.dev.getOverrideDate().catch(() => null),
      ]);
      setOverview(ov);
      setLicStatus(lic);
      if (flags) setFeatureFlags(flags);
      if (tel) setTelemetry(tel);
      setDevOverride(currentOverride);
      setDevDate(currentOverride ?? todayKey());
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCopyHwid = () => {
    if (!licStatus?.hwid) return;
    void navigator.clipboard.writeText(licStatus.hwid);
    setCopiedHwid(true);
    toast("success", t("license.copied"));
    setTimeout(() => setCopiedHwid(false), 2000);
  };

  const handleGrantGrace = async (days: number) => {
    try {
      setActionLoading(true);
      const updated = await api.dev.grantEmergencyGrace(days);
      setLicStatus(updated);
      setGraceModalOpen(false);
      toast("success", t("developer.graceSuccess"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunIntegrityCheck = async () => {
    try {
      setCheckingIntegrity(true);
      const res = await api.dev.runIntegrityCheck();
      setIntegrityResult(res);
      if (res.integrity.toLowerCase() === "ok" && res.foreignKeysOk) {
        toast("success", t("developer.integritySuccess"));
      } else {
        toast("warning", t("developer.integrityIssuesFound"));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setCheckingIntegrity(false);
    }
  };

  const handleVacuumDb = async () => {
    try {
      setVacuumingDb(true);
      const res = await api.dev.vacuumDatabase();
      toast("success", t("developer.vacuumSuccess"));
      setOverview((prev) => (prev ? { ...prev, stats: { ...prev.stats, dbSizeBytes: res.dbSizeBytes } } : prev));
      void loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setVacuumingDb(false);
    }
  };

  const handleClearServerLogs = async () => {
    if (!window.confirm(t("developer.logsCardDesc"))) return;
    try {
      setClearingLogs(true);
      await api.dev.clearServerLogs();
      toast("success", t("developer.clearLogsSuccess"));
      void loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setClearingLogs(false);
    }
  };

  const handleEmergencyOwnerReset = async () => {
    if (!emergencyOwnerPassword.trim()) return;
    try {
      setEmergencyOwnerSubmitting(true);
      const res = await api.dev.resetOwnerEmergency(emergencyOwnerPassword.trim());
      setEmergencyOwnerResetOpen(false);
      setEmergencyOwnerPassword("");
      toast("success", t("developer.emergencyResetOwnerSuccess", { username: res.username }));
      void loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setEmergencyOwnerSubmitting(false);
    }
  };

  const { refreshFeatureFlags } = useAuth();

  const handleToggleFeatureFlag = async (flag: keyof FeatureFlags, nextValue: boolean) => {
    try {
      setActionLoading(true);
      const updated = await api.dev.setFeatureFlag(flag, nextValue);
      setFeatureFlags(updated);
      await refreshFeatureFlags();
      toast("success", t("developer.flagsUpdatedSuccess"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetClock = async () => {
    try {
      setActionLoading(true);
      const updated = await api.dev.resetClockTamper();
      setLicStatus(updated);
      toast("success", t("developer.resetClockSuccess"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivateLicense = async () => {
    if (!window.confirm(t("developer.confirmDeactivate"))) return;
    try {
      setActionLoading(true);
      const updated = await api.dev.deactivateLicense();
      setLicStatus(updated);
      toast("success", t("developer.deactivateSuccess"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleInstallLicense = async () => {
    if (!licJson.trim()) return;
    try {
      setLicSubmitting(true);
      const updated = await api.dev.activateLicense(licJson.trim());
      setLicStatus(updated);
      setInstallLicOpen(false);
      setLicJson("");
      toast("success", t("developer.installLicSuccess"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLicSubmitting(false);
    }
  };

  const handleApplyDevDate = async (newVal: string | null) => {
    try {
      setActionLoading(true);
      const applied = await api.dev.setOverrideDate(newVal);
      setDevOverrideDate(applied);
      setDevOverride(applied);
      setDevDate(applied ?? todayKey());
      toast("success", applied ? `تم تغيير تاريخ النظام إلى: ${applied}` : "تمت استعادة التاريخ الحقيقي للجهاز");
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleReadOnly = async () => {
    if (!overview) return;
    const nextState = !overview.systemReadOnly;
    try {
      setActionLoading(true);
      const res = await api.dev.setSystemReadOnly(nextState);
      setOverview((prev) => (prev ? { ...prev, systemReadOnly: res.systemReadOnly } : prev));
      toast("success", t("developer.readOnlyUpdated"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleUserActive = async (user: DeveloperOverviewUser) => {
    try {
      setActionLoading(true);
      const updated = await api.dev.toggleUserActive(user.id, !user.isActive);
      setOverview((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) => (u.id === user.id ? { ...u, isActive: updated.isActive } : u)),
        };
      });
      toast("success", t("developer.userStatusUpdated"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async (u: DeveloperOverviewUser) => {
    if (!window.confirm(t("developer.confirmDeleteUser"))) return;
    try {
      setActionLoading(true);
      await api.dev.deleteUser(u.id);
      toast("success", t("developer.userDeletedSuccess"));
      await loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSuspendAll = async () => {
    if (!window.confirm(t("developer.suspendAllConfirm"))) return;
    try {
      setActionLoading(true);
      await api.dev.suspendAllNonDevUsers();
      toast("success", t("developer.suspendAllSuccess"));
      await loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivateAll = async () => {
    try {
      setActionLoading(true);
      await api.dev.activateAllUsers();
      toast("success", t("developer.activateAllSuccess"));
      await loadData();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenResetPass = (u: DeveloperOverviewUser) => {
    setTargetUserId(u.id);
    setTargetUserName(u.fullName || u.username);
    setNewPassword("");
    setResetPassModalOpen(true);
  };

  const handleExecuteResetPass = async () => {
    if (!targetUserId || !newPassword.trim()) return;
    try {
      setPassSubmitting(true);
      await api.dev.resetUserPassword(targetUserId, newPassword.trim());
      setResetPassModalOpen(false);
      setNewPassword("");
      toast("success", t("developer.resetPassSuccess"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPassSubmitting(false);
    }
  };

  const handleQuickBackup = async () => {
    try {
      setActionLoading(true);
      const backupResult = await api.backup.createSnapshot("manual");
      if (backupResult.fileName) {
        window.open(api.backup.downloadUrl(backupResult.fileName), "_blank");
        toast("success", t("developer.quickBackupSuccess"));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  const handlePurgeDataDirectory = async () => {
    if (!window.confirm(t("developer.confirmPurgeDataDir1"))) return;
    if (!window.confirm(t("developer.confirmPurgeDataDir2"))) return;
    try {
      setActionLoading(true);
      const result = await api.dev.purgeDataDirectory();
      if (result.success) {
        toast("success", t("developer.purgeDataDirSuccess"));
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      }
    } catch (err) {
      toast("error", describeError(err, t));
      setActionLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title with KOTB Identity */}
      <div className="relative overflow-hidden rounded-2xl border border-[#0055FF]/40 bg-gradient-to-r from-[#0055FF]/15 via-surface to-[#00D2FF]/10 p-6 shadow-glow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <img
              src="/branding/kotb-logo.png"
              alt="KOTB Digital Solutions"
              className="h-10 object-contain drop-shadow-sm select-none"
            />
            <div className="h-9 w-px bg-white/10 hidden sm:block" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight text-ink font-sans">
                  {t("developer.title")}
                </h1>
                <Badge variant="success">
                  {t("developer.badge")}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-[#00D2FF] font-semibold">
                GymGate — Powered by KOTB Digital Solutions  •  Enterprise Developer Console
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={loading || actionLoading}
              onClick={() => void loadData()}
            >
              <RefreshCw className="size-3.5" />
              <span>{t("common.reload")}</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={actionLoading}
              onClick={() => void handleQuickBackup()}
            >
              <HardDriveDownload className="size-3.5" />
              <span>{t("developer.btnQuickBackup")}</span>
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={actionLoading}
              onClick={() => void handlePurgeDataDirectory()}
            >
              <Trash2 className="size-3.5" />
              <span>{t("developer.btnPurgeDataDir")}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <Tabs
        items={[
          { value: "overview", label: t("developer.tabOverview") },
          { value: "users", label: t("developer.tabUsers") },
          { value: "maintenance", label: t("developer.tabMaintenance") },
          { value: "flags", label: t("developer.tabFeatureFlags") },
          { value: "telemetry", label: t("developer.tabTelemetry") },
          { value: "network", label: t("developer.tabNetwork") },
        ]}
        value={tab}
        onChange={(v) => setTab(v as DevTab)}
      />

      {/* Tab 1: Overview & License */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* Quick Stats Grid */}
          {overview && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-line bg-surface p-4">
                <span className="text-[11px] font-semibold text-faint">{t("developer.membersStat")}</span>
                <p className="mt-1 text-2xl font-black text-ink">{overview.stats.membersCount}</p>
              </div>
              <div className="rounded-xl border border-line bg-surface p-4">
                <span className="text-[11px] font-semibold text-faint">{t("developer.subscriptionsStat")}</span>
                <p className="mt-1 text-2xl font-black text-neon">{overview.stats.subscriptionsCount}</p>
              </div>
              <div className="rounded-xl border border-line bg-surface p-4">
                <span className="text-[11px] font-semibold text-faint">{t("developer.paymentsStat")}</span>
                <p className="mt-1 text-2xl font-black text-cyan">{overview.stats.paymentsCount}</p>
              </div>
              <div className="rounded-xl border border-line bg-surface p-4">
                <span className="text-[11px] font-semibold text-faint">{t("developer.dbSizeStat")}</span>
                <p className="mt-1 text-2xl font-black text-ink">{formatBytes(overview.stats.dbSizeBytes)}</p>
              </div>
            </div>
          )}

          {/* Main Controls Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Card 1: License Management */}
            <Card className="border-neon/20">
              <CardHeader
                title={t("developer.licenseCardTitle")}
                description={t("developer.licenseCardDesc")}
              />
              <div className="space-y-4 p-5">
                <div className="rounded-xl border border-line bg-base/60 p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-subtle">{t("developer.stateLabel")}:</span>
                    <Badge
                      variant={licStatus?.state === "active" ? "success" : "danger"}
                    >
                      {licStatus?.state ? t(`license.states.${licStatus.state}`) : "-"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-subtle">{t("developer.daysRemainingLabel")}:</span>
                    <span className="font-mono font-bold text-neon">
                      {licStatus?.daysRemaining ?? 0} {t("common.days")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-subtle">{t("developer.gymLabel")}:</span>
                    <span className="font-semibold text-ink">{licStatus?.gym || "-"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-subtle">{t("developer.hwidLabel")}:</span>
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-[11px] text-ink">{licStatus?.hwid || "-"}</span>
                      <button
                        type="button"
                        onClick={handleCopyHwid}
                        className="rounded p-1 text-faint hover:bg-white/10 hover:text-ink"
                      >
                        {copiedHwid ? <Check className="size-3.5 text-neon" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoading}
                    onClick={() => setGraceModalOpen(true)}
                    className="border-neon/30 text-neon hover:bg-neon/10"
                  >
                    <Clock className="size-3.5" />
                    <span>{t("developer.btnGrace")}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={actionLoading}
                    onClick={() => void handleResetClock()}
                  >
                    <RotateCcw className="size-3.5" />
                    <span>{t("developer.btnResetClock")}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setInstallLicOpen(true)}
                  >
                    <KeyRound className="size-3.5" />
                    <span>{t("developer.btnInstallLicense")}</span>
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={actionLoading}
                    onClick={() => void handleDeactivateLicense()}
                  >
                    <PowerOff className="size-3.5" />
                    <span>{t("developer.btnDeactivate")}</span>
                  </Button>
                </div>
              </div>
            </Card>

            {/* Card 2: Read-Only System Mode */}
            <Card className="border-amber/20">
              <CardHeader
                title={t("developer.readOnlyCardTitle")}
                description={t("developer.readOnlyDesc")}
              />
              <div className="space-y-4 p-5">
                <div className={`rounded-xl border p-4 transition-all ${overview?.systemReadOnly ? "border-amber/40 bg-amber/10" : "border-line bg-base/60"}`}>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-ink">
                        {overview?.systemReadOnly
                          ? t("developer.readOnlyActive")
                          : t("developer.readOnlyInactive")}
                      </p>
                      <p className="text-xs text-subtle">
                        {overview?.systemReadOnly
                          ? t("developer.bannerReadOnly")
                          : t("developer.readOnlyDesc")}
                      </p>
                    </div>
                    <Button
                      variant={overview?.systemReadOnly ? "danger" : "secondary"}
                      size="sm"
                      loading={actionLoading}
                      onClick={() => void handleToggleReadOnly()}
                    >
                      {overview?.systemReadOnly ? (
                        <>
                          <Unlock className="size-3.5" />
                          <span>إلغاء وضع القراءة فقط</span>
                        </>
                      ) : (
                        <>
                          <Lock className="size-3.5" />
                          <span>تفعيل وضع القراءة فقط</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-line bg-base/40 p-3.5">
                  <div className="flex items-start gap-2.5 text-xs text-subtle">
                    <AlertTriangle className="size-4 shrink-0 text-amber mt-0.5" />
                    <p className="leading-relaxed">
                      وضع القراءة فقط يمنع المالك وجميع الموظفين من إنشاء أي اشتراكات أو فواتير جديدة أو حضور مع بقاء إمكانية تصفح التقارير والأعضاء. حساب المطور يظل قادراً على الإضافة والتعديل دائماً.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Card 3: Date Override (Developer Simulation) */}
            <Card className="border-amber/20 lg:col-span-2">
              <CardHeader
                title="محاكاة وتغيير تاريخ النظام (للاختبار وتجارب المطور فقط)"
                description="تغيير التاريخ الافتراضي للنظام لاختبار انتهاء الاشتراكات، تنبيهات التجديد، أو احتساب الرواتب مقدماً دون التأثير على ساعة الويندوز الأصلية."
              />
              <div className="space-y-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-base/60 p-4">
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-xl border border-amber/30 bg-amber/10 text-amber">
                      <CalendarDays className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink">
                        التاريخ الفعال للنظام حالياً:{" "}
                        <span className="font-mono font-extrabold text-amber">
                          {devOverride ? `${devOverride} (تاريخ مؤقت يدوي)` : `${todayKey()} (تاريخ الجهاز الحقيقي)`}
                        </span>
                      </p>
                      <p className="text-xs text-subtle">
                        {devOverride
                          ? "النظام يعمل حالياً بالتاريخ المؤقت أعلاه لكافة العمليات والاشتراكات."
                          : "النظام يعمل بالتاريخ الحقيقي للكمبيوتر."}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={devDate}
                      max="2099-12-31"
                      onChange={(e) => setDevDate(e.target.value)}
                      className="h-9 rounded-lg border border-line bg-panel px-3 text-xs font-bold text-amber outline-none [color-scheme:dark]"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={actionLoading}
                      onClick={() => void handleApplyDevDate(devDate)}
                      className="border-amber/40 text-amber hover:bg-amber/10 font-bold"
                    >
                      <span>تطبيق التاريخ</span>
                    </Button>
                    {devOverride && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={actionLoading}
                        onClick={() => void handleApplyDevDate(null)}
                        className="text-faint hover:text-red hover:bg-red/10"
                      >
                        <X className="size-3.5" />
                        <span>إلغاء والعودة لليوم الحقيقي</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Tab 2: Users & Lockdown */}
      {tab === "users" && (
        <Card>
          <div className="border-b border-line p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-ink">{t("developer.usersCardTitle")}</h2>
                <p className="text-xs text-subtle">{t("developer.usersCardDesc")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  loading={actionLoading}
                  onClick={() => void handleSuspendAll()}
                >
                  <PowerOff className="size-3.5" />
                  <span>{t("developer.suspendAllBtn")}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={actionLoading}
                  onClick={() => void handleActivateAll()}
                >
                  <Unlock className="size-3.5" />
                  <span>{t("developer.activateAllBtn")}</span>
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-line bg-base/40 text-faint">
                  <th className="px-4 py-3 text-start font-bold">المستخدم</th>
                  <th className="px-4 py-3 text-start font-bold">اسم الدخول</th>
                  <th className="px-4 py-3 text-start font-bold">الدور</th>
                  <th className="px-4 py-3 text-start font-bold">الحالة</th>
                  <th className="px-4 py-3 text-end font-bold">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {overview?.users && overview.users.length > 0 ? (
                  overview.users.map((u) => (
                    <tr key={u.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ink">{u.fullName || u.username}</span>
                          {u.isDeveloper && (
                            <Badge variant="success">
                              مطور
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-subtle" dir="ltr">
                        {u.username}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={u.roleId === "owner" ? "success" : "neutral"}>
                          {u.roleId}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={u.isActive ? "success" : "danger"}>
                          {u.isActive ? t("developer.userActive") : t("developer.userSuspended")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenResetPass(u)}
                          >
                            <KeyRound className="size-3" />
                            <span>{t("developer.btnResetPass")}</span>
                          </Button>
                          {!u.isDeveloper && (
                            <>
                              <Button
                                variant={u.isActive ? "danger" : "secondary"}
                                size="sm"
                                loading={actionLoading}
                                onClick={() => void handleToggleUserActive(u)}
                              >
                                {u.isActive ? (
                                  <>
                                    <PowerOff className="size-3" />
                                    <span>{t("developer.btnSuspendUser")}</span>
                                  </>
                                ) : (
                                  <>
                                    <Unlock className="size-3" />
                                    <span>{t("developer.btnActivateUser")}</span>
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                loading={actionLoading}
                                onClick={() => void handleDeleteUser(u)}
                                title={t("developer.btnDeleteUser")}
                              >
                                <Trash2 className="size-3" />
                                <span>{t("developer.btnDeleteUser")}</span>
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-faint">
                      {t("developer.noUsers")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tab: Maintenance & Diagnostics */}
      {tab === "maintenance" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Card 1: DB Integrity & Vacuum */}
            <Card className="border-cyan/20">
              <CardHeader
                title={t("developer.maintenanceCardTitle")}
                description={t("developer.maintenanceCardDesc")}
              />
              <div className="space-y-4 p-5">
                <div className="rounded-xl border border-line bg-base/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-subtle">حالة فحص PRAGMA integrity_check:</span>
                    <Badge variant={integrityResult?.integrity === "ok" ? "success" : integrityResult ? "warning" : "neutral"}>
                      {integrityResult ? integrityResult.integrity : "لم يتم الفحص بعد"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-subtle">سلامة العلاقات الأجنبية (FK Check):</span>
                    <Badge variant={integrityResult?.foreignKeysOk ? "success" : integrityResult ? "danger" : "neutral"}>
                      {integrityResult ? (integrityResult.foreignKeysOk ? "سليمة تماماً" : `${integrityResult.fkViolations.length} مخالفة`) : "لم يتم الفحص بعد"}
                    </Badge>
                  </div>
                  {integrityResult && integrityResult.fkViolations.length > 0 && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                      <p className="font-bold mb-1">تفاصيل أخطاء العلاقات:</p>
                      <ul className="list-disc list-inside space-y-0.5 font-mono text-[11px]">
                        {integrityResult.fkViolations.map((v, idx) => (
                          <li key={idx}>جدول {v.table} (الصف {v.rowid}) -&gt; {v.parent}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={checkingIntegrity}
                    onClick={() => void handleRunIntegrityCheck()}
                    className="border-cyan/30 text-cyan hover:bg-cyan/10"
                  >
                    <Database className="size-3.5" />
                    <span>{t("developer.btnIntegrityCheck")}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={vacuumingDb}
                    onClick={() => void handleVacuumDb()}
                  >
                    <RotateCcw className="size-3.5" />
                    <span>{t("developer.btnVacuumDb")}</span>
                  </Button>
                </div>
              </div>
            </Card>

            {/* Card 2: Emergency Owner Reset & Clear Logs */}
            <div className="space-y-6">
              <Card className="border-amber/20">
                <CardHeader
                  title={t("developer.emergencyOwnerResetTitle")}
                  description={t("developer.emergencyOwnerResetDesc")}
                />
                <div className="space-y-4 p-5">
                  <p className="text-xs text-subtle leading-relaxed">
                    يستخدم هذا الإجراء في الحالات الطارئة عندما ينسى المالك كلمة المرور أو يتم إقفال حسابه، مما يتيح لك إعادة ضبط كلمة المرور فورياً دون المساس بأي بيانات.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEmergencyOwnerPassword("");
                      setEmergencyOwnerResetOpen(true);
                    }}
                    className="w-full border-amber/30 text-amber hover:bg-amber/10"
                  >
                    <KeyRound className="size-3.5" />
                    <span>{t("developer.btnEmergencyResetOwner")}</span>
                  </Button>
                </div>
              </Card>

              <Card className="border-line">
                <CardHeader
                  title={t("developer.logsCardTitle")}
                  description={t("developer.logsCardDesc")}
                />
                <div className="space-y-4 p-5">
                  <div className="flex items-center justify-between text-xs rounded-xl border border-line bg-base/60 p-3.5">
                    <span className="text-subtle">{t("developer.logFileSize")}</span>
                    <span className="font-mono font-bold text-ink">
                      {telemetry ? formatBytes(telemetry.database.logSizeBytes) : "-"}
                    </span>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={clearingLogs}
                    onClick={() => void handleClearServerLogs()}
                    className="w-full"
                  >
                    <Trash2 className="size-3.5" />
                    <span>{t("developer.btnClearLogs")}</span>
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Feature Flags & Module Toggles */}
      {tab === "flags" && (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title={t("developer.flagsCardTitle")}
              description={t("developer.flagsCardDesc")}
            />
            <div className="divide-y divide-line p-5">
              {/* Operations & Front-Desk */}
              <div className="space-y-4 pb-6">
                <p className="text-xs font-bold uppercase tracking-wider text-neon">العمليات والاستقبال والأعضاء</p>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagAttendanceTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagAttendanceDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureAttendanceEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureAttendanceEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagMembersTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagMembersDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureMembersEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureMembersEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagSubscriptionsTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagSubscriptionsDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureSubscriptionsEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureSubscriptionsEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagCardsTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagCardsDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureCardsEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureCardsEnabled", val)}
                  />
                </div>
              </div>

              {/* Finance & Sales */}
              <div className="space-y-4 py-6">
                <p className="text-xs font-bold uppercase tracking-wider text-cyan">المالية والمبيعات</p>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagTreasuryTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagTreasuryDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureTreasuryEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureTreasuryEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagExpensesTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagExpensesDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureExpensesEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureExpensesEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagPosTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagPosDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featurePosEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featurePosEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagReportsTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagReportsDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureReportsEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureReportsEnabled", val)}
                  />
                </div>
              </div>

              {/* Fitness & Training */}
              <div className="space-y-4 py-6">
                <p className="text-xs font-bold uppercase tracking-wider text-amber">اللياقة البدنية والأنشطة</p>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagClassesTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagClassesDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureClassesEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureClassesEnabled", val)}
                  />
                </div>
              </div>

              {/* Marketing & CRM */}
              <div className="space-y-4 py-6">
                <p className="text-xs font-bold uppercase tracking-wider text-purple-400">التسويق وعلاقات العملاء</p>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagWhatsappTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagWhatsappDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureWhatsappEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureWhatsappEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagCrmTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagCrmDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureCrmEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureCrmEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagLoyaltyTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagLoyaltyDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureLoyaltyEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureLoyaltyEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagReferralsTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagReferralsDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureReferralsEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureReferralsEnabled", val)}
                  />
                </div>
              </div>

              {/* HR & Branches */}
              <div className="space-y-4 pt-6">
                <p className="text-xs font-bold uppercase tracking-wider text-blue-400">الموارد البشرية والمزامنة</p>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagEmployeesTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagEmployeesDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureEmployeesEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureEmployeesEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagHrCheckinTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagHrCheckinDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureHrCheckinEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureHrCheckinEnabled", val)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-bold text-ink">{t("developer.flagMultibranchTitle")}</p>
                    <p className="text-xs text-subtle">{t("developer.flagMultibranchDesc")}</p>
                  </div>
                  <Checkbox
                    checked={featureFlags?.featureMultibranchEnabled ?? true}
                    onCheckedChange={(val) => void handleToggleFeatureFlag("featureMultibranchEnabled", val)}
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Tab: System Telemetry */}
      {tab === "telemetry" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* System Specs */}
            <Card className="border-neon/20">
              <CardHeader
                title={t("developer.telemetryOs")}
                description="مواصفات نظام التشغيل والمعالج"
              />
              <div className="p-5 space-y-3 text-xs">
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-subtle">نظام التشغيل:</span>
                  <span className="font-semibold text-ink">{telemetry?.os.platform} ({telemetry?.os.release}) - {telemetry?.os.arch}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-subtle">اسم الجهاز (Hostname):</span>
                  <span className="font-mono text-ink">{telemetry?.os.hostname}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-subtle">المعالج:</span>
                  <span className="font-semibold text-ink">{telemetry?.cpu.model}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-subtle">{t("developer.cpuCores")}</span>
                  <span className="font-mono text-ink">{telemetry?.cpu.cores} cores</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-subtle">{t("developer.uptimeSystem")}</span>
                  <span className="font-mono text-neon">
                    {telemetry ? `${Math.floor(telemetry.os.uptimeSeconds / 3600)} ساعة و ${Math.floor((telemetry.os.uptimeSeconds % 3600) / 60)} دقيقة` : "-"}
                  </span>
                </div>
              </div>
            </Card>

            {/* Memory & Process Specs */}
            <Card className="border-cyan/20">
              <CardHeader
                title={t("developer.telemetryMemory")}
                description="استهلاك الذاكرة العشوائية وبيئة Node.js"
              />
              <div className="p-5 space-y-3 text-xs">
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-subtle">{t("developer.ramUsageProcess")}</span>
                  <span className="font-mono font-bold text-cyan">{telemetry ? formatBytes(telemetry.memory.processRssBytes) : "-"}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-subtle">Heap الذاكرة المستخدم:</span>
                  <span className="font-mono text-ink">{telemetry ? `${formatBytes(telemetry.memory.processHeapUsedBytes)} / ${formatBytes(telemetry.memory.processHeapTotalBytes)}` : "-"}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-subtle">{t("developer.ramUsageSystem")}</span>
                  <span className="font-mono text-ink">{telemetry ? `${formatBytes(telemetry.memory.systemTotalBytes - telemetry.memory.systemFreeBytes)} / ${formatBytes(telemetry.memory.systemTotalBytes)}` : "-"}</span>
                </div>
                <div className="flex justify-between border-b border-line pb-2">
                  <span className="text-subtle">إصدار Node.js:</span>
                  <span className="font-mono text-ink">{telemetry?.process.nodeVersion} (PID: {telemetry?.process.pid})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-subtle">{t("developer.uptimeProcess")}</span>
                  <span className="font-mono text-neon">
                    {telemetry ? `${Math.floor(telemetry.process.uptimeSeconds / 3600)} ساعة و ${Math.floor((telemetry.process.uptimeSeconds % 3600) / 60)} دقيقة` : "-"}
                  </span>
                </div>
              </div>
            </Card>
          </div>

          {/* Database & Storage Paths */}
          <Card>
            <CardHeader
              title={t("developer.telemetryDatabase")}
              description="إصدار SQLite والمسارات النشطة على القرص الصلب"
            />
            <div className="p-5 space-y-3 text-xs">
              <div className="flex justify-between border-b border-line pb-2">
                <span className="text-subtle">إصدار محرك SQLite:</span>
                <span className="font-mono font-bold text-neon">{telemetry?.database.sqliteVersion}</span>
              </div>
              <div className="flex justify-between border-b border-line pb-2">
                <span className="text-subtle">{t("developer.pathDb")}</span>
                <span className="font-mono text-ink text-[11px]" dir="ltr">{telemetry?.database.dbPath}</span>
              </div>
              <div className="flex justify-between border-b border-line pb-2">
                <span className="text-subtle">{t("developer.pathBackups")}</span>
                <span className="font-mono text-ink text-[11px]" dir="ltr">{telemetry?.database.backupsDir}</span>
              </div>
              <div className="flex justify-between border-b border-line pb-2">
                <span className="text-subtle">{t("developer.pathFiles")}</span>
                <span className="font-mono text-ink text-[11px]" dir="ltr">{telemetry?.database.filesDir}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-subtle">{t("developer.pathLogs")}</span>
                <span className="font-mono text-ink text-[11px]" dir="ltr">{telemetry?.database.logsDir}</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Tab: Network, Mesh VPN & Cloudflare Tunnels */}
      {tab === "network" && (
        <div className="space-y-6">
          <SimpleNetworkCard />
        </div>
      )}

      {/* Install License Modal */}
      <Modal
        open={installLicOpen}
        onClose={() => setInstallLicOpen(false)}
        title={t("developer.installLicTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setInstallLicOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={licSubmitting}
              onClick={() => void handleInstallLicense()}
            >
              {t("developer.installLicBtn")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 p-2">
          <p className="text-xs text-subtle">{t("developer.installLicDesc")}</p>
          <textarea
            dir="ltr"
            rows={5}
            value={licJson}
            onChange={(e) => setLicJson(e.target.value)}
            placeholder={t("developer.installLicPlaceholder")}
            className="w-full rounded-xl border border-line bg-base px-3.5 py-2.5 font-mono text-xs text-ink placeholder:text-faint outline-none transition-colors focus:border-neon focus:ring-1 focus:ring-neon"
          />
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        open={resetPassModalOpen}
        onClose={() => setResetPassModalOpen(false)}
        title={`${t("developer.resetPassTitle")} — ${targetUserName}`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setResetPassModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={passSubmitting}
              onClick={() => void handleExecuteResetPass()}
            >
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 p-2">
          <Input
            type="password"
            dir="ltr"
            label="كلمة المرور الجديدة"
            placeholder={t("developer.resetPassPlaceholder")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
      </Modal>

      {/* Emergency Grace Period Modal */}
      <Modal
        open={graceModalOpen}
        onClose={() => setGraceModalOpen(false)}
        title={t("developer.graceSelectTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setGraceModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={actionLoading}
              onClick={() => void handleGrantGrace(graceDaysChoice)}
            >
              تأكيد ومنح السماح
            </Button>
          </div>
        }
      >
        <div className="space-y-4 p-2 text-xs">
          <p className="text-subtle leading-relaxed">
            اختر عدد أيام فترة السماح المؤقتة لتمكين النظام من الاستمرار في العمل في حالات الطوارئ أو انقطاع الاتصال:
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[3, 7, 14].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setGraceDaysChoice(d)}
                className={`rounded-xl border p-3 text-center transition-all ${
                  graceDaysChoice === d
                    ? "border-neon bg-neon/15 font-bold text-neon shadow-glow-sm"
                    : "border-line bg-base hover:bg-white/5 text-ink"
                }`}
              >
                +{d} {t("common.days")}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* Emergency Owner Password Reset Modal */}
      <Modal
        open={emergencyOwnerResetOpen}
        onClose={() => setEmergencyOwnerResetOpen(false)}
        title={t("developer.emergencyOwnerResetTitle")}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEmergencyOwnerResetOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={emergencyOwnerSubmitting}
              onClick={() => void handleEmergencyOwnerReset()}
            >
              تصفير كلمة المرور وتفعيل الحساب
            </Button>
          </div>
        }
      >
        <div className="space-y-3 p-2">
          <p className="text-xs text-subtle leading-relaxed">
            أدخل كلمة المرور الجديدة لحساب المالك الرئيسي. سيتم إلغاء أي قفل محاولات وتنشيط الحساب فورياً.
          </p>
          <Input
            type="password"
            dir="ltr"
            label="كلمة المرور المؤقتة الجديدة"
            placeholder={t("developer.resetPassPlaceholder")}
            value={emergencyOwnerPassword}
            onChange={(e) => setEmergencyOwnerPassword(e.target.value)}
          />
        </div>
      </Modal>
      {/* Executive Attribution Footer */}
      <div className="mt-8 rounded-2xl border border-[#0055FF]/25 bg-[#06080D] p-4 text-center shadow-card space-y-1">
        <div className="flex items-center justify-center gap-2">
          <img src="/branding/kotb-k-icon.png" alt="K" className="size-4 object-contain" />
          <span className="text-xs font-black tracking-wider text-white uppercase font-sans">
            KOTB Digital Solutions
          </span>
        </div>
        <p className="text-xs text-[#94A3B8]">
          GymGate — Powered by KOTB Digital Solutions
        </p>
        <p className="text-xs text-[#64748B] font-sans">
          قُطب للحلول الرقمية • Enterprise System Architecture © 2026
        </p>
      </div>
    </div>
  );
}
