import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Lock } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, rpc } from "@/api";
import { SETTING_KEYS } from "@/core/services/settings.service";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Tabs } from "@/components/ui/tabs";
import { HealthTab } from "@/components/settings/health-tab";
import { ScannerTab } from "@/components/settings/scanner-tab";
import { WhatsAppSettingsCard } from "@/components/settings/whatsapp-settings-card";
import { LicenseSettingsCard } from "@/components/settings/license-settings-card";
import { SimpleNetworkCard } from "@/components/settings/simple-network-card";
import { cn } from "@/utils/cn";




const DAY_KEYS = [
  "settings.day0",
  "settings.day1",
  "settings.day2",
  "settings.day3",
  "settings.day4",
  "settings.day5",
  "settings.day6",
];

type SettingsTab = "general" | "scanner" | "whatsapp" | "network" | "backups" | "license";

export function SettingsPage() {
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { value: "general", label: t("settings.generalTab") },
          { value: "scanner", label: t("settings.scannerTab") },
          { value: "whatsapp", label: t("settings.whatsappTab") },
          { value: "network", label: t("settings.networkTab") },
          { value: "backups", label: t("settings.backupsTab") },
          { value: "license", label: t("settings.licenseTab") },
        ]}
        value={tab}
        onChange={(v) => setTab(v as SettingsTab)}
      />
      {tab === "general" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <GeneralSettingsCard />
          <div className="space-y-4">
            <NotificationSettingsCard />
            <ChangePasswordCard />
          </div>
        </div>
      )}
      {tab === "scanner" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <ScannerSettingsCard />
          <ScannerTab />
        </div>
      )}
      {tab === "whatsapp" && (
        <div className="max-w-4xl">
          <WhatsAppSettingsCard />
        </div>
      )}
      {tab === "network" && (
        <div className="max-w-4xl space-y-4">
          <SimpleNetworkCard />
        </div>
      )}
      {tab === "backups" && (
        <div className="space-y-5">
          <BackupSettingsCard />
          <HealthTab />
        </div>
      )}
      {tab === "license" && (
        <div className="max-w-4xl">
          <LicenseSettingsCard />
        </div>
      )}
    </div>
  );
}

interface SettingDraft {
  key: string;
  label: string;
  hint?: string;
  type?: "text" | "number";
  dir?: "ltr" | "rtl";
}

function useSettingsSaver() {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const save = async (entries: Array<{ key: string; value: string }>, onDone?: () => void) => {
    if (!actor) return;
    setSubmitting(true);
    try {
      for (const entry of entries) {
        await api.settings.update(entry.key, entry.value);
      }
      toast("success", t("settings.savedToast"));
      onDone?.();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return { submitting, save };
}

function ReadOnlyNotice() {
  const t = useT();
  const { hasPermission } = useAuth();
  if (hasPermission("settings.edit")) return null;
  return (
    <p className="rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-[13px] font-semibold text-amber">
      {t("settings.readOnlyNotice")}
    </p>
  );
}

function SettingsForm({
  title,
  drafts,
  values,
  setValue,
  extra,
}: {
  title: string;
  drafts: SettingDraft[];
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  extra?: React.ReactNode;
}) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { submitting, save } = useSettingsSaver();
  const canEdit = hasPermission("settings.edit");

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {title}
          </span>
        }
      />
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save(drafts.map((d) => ({ key: d.key, value: values[d.key] ?? "" })));
        }}
        noValidate
        className="space-y-3.5 p-5"
      >
        <ReadOnlyNotice />
        {drafts.map((draft) => (
          <div key={draft.key}>
            <Input
              label={t(draft.label)}
              type={draft.type ?? "text"}
              min={draft.type === "number" ? 0 : undefined}
              dir={draft.dir}
              value={values[draft.key] ?? ""}
              onChange={(e) => setValue(draft.key, e.target.value)}
              disabled={!canEdit || submitting}
            />
            {draft.hint && <p className="-mt-1 text-[11px] text-faint">{t(draft.hint)}</p>}
          </div>
        ))}
        {extra}
        {canEdit && (
          <div className="pt-2">
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Card>
  );
}

function GeneralSettingsCard() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [workingDays, setWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [ownerUser, setOwnerUser] = useState<{ id: string; fullName: string; phone: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    api.settings
      .readAll()
      .then((all) => {
        if (!alive) return;
        setValues({
          [SETTING_KEYS.gymName]: all[SETTING_KEYS.gymName] ?? "",
          [SETTING_KEYS.receiptTitle]: all[SETTING_KEYS.receiptTitle] ?? "",
          [SETTING_KEYS.currencySymbol]: all[SETTING_KEYS.currencySymbol] ?? "",
          [SETTING_KEYS.gymAddress]: all[SETTING_KEYS.gymAddress] ?? "",
          [SETTING_KEYS.workingHours]: all[SETTING_KEYS.workingHours] ?? "",
          [SETTING_KEYS.duplicateWindowSeconds]: all[SETTING_KEYS.duplicateWindowSeconds] ?? "45",
          [SETTING_KEYS.workingDays]: all[SETTING_KEYS.workingDays] ?? "0,1,2,3,4",
        });
        const rawDays = all[SETTING_KEYS.workingDays];
        if (rawDays)
          setWorkingDays(
            rawDays.split(",").map((d) => Number(d)).filter((n) => !Number.isNaN(n)),
          );
      })
      .catch((err) => console.error(err));

    api.users
      .list()
      .then((list) => {
        if (!alive) return;
        const owner = list.find((u) => u.roleId === "owner");
        if (owner) {
          setOwnerUser({ id: owner.id, fullName: owner.fullName, phone: owner.phone ?? null });
        }
      })
      .catch((err) => console.error(err));

    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));
  const toggleDay = (day: number) =>
    setWorkingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));

  const handleUpdateOwnerPhone = async (newPhone: string) => {
    if (!ownerUser) return;
    setOwnerUser((prev) => (prev ? { ...prev, phone: newPhone } : null));
    if (hasPermission("users.manage") || actor?.roleId === "owner") {
      try {
        await api.users.update(ownerUser.id, { phone: newPhone });
      } catch (err) {
        toast("error", describeError(err, t));
      }
    }
  };

  const drafts: SettingDraft[] = [
    { key: SETTING_KEYS.gymName, label: "settings.gymName" },
    { key: SETTING_KEYS.receiptTitle, label: "settings.receiptTitle", hint: "settings.receiptTitleHint" },
    { key: SETTING_KEYS.currencySymbol, label: "settings.currencySymbol" },
    { key: SETTING_KEYS.gymAddress, label: "settings.address" },
    { key: SETTING_KEYS.workingHours, label: "settings.workingHours", hint: "settings.workingHoursHint" },
  ];

  const DUP_OPTIONS = [
    { label: "settings.dupWindow15s", val: "15" },
    { label: "settings.dupWindow30s", val: "30" },
    { label: "settings.dupWindow45s", val: "45" },
    { label: "settings.dupWindow60s", val: "60" },
    { label: "settings.dupWindow120s", val: "120" },
  ];

  const currentDup = values[SETTING_KEYS.duplicateWindowSeconds] ?? "45";

  return (
    <SettingsForm
      title={t("settings.generalTab")}
      drafts={drafts}
      values={values}
      setValue={setValue}
      extra={
        <div className="space-y-4 pt-2">
          {/* Quick buttons for duplicate scan window */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-[13px] font-semibold text-subtle">
                {t("settings.duplicateWindow")}
              </label>
              <span className="text-xs font-bold text-primary">{currentDup} {t("common.seconds") || "ثانية"}</span>
            </div>
            <p className="-mt-1 text-[11px] text-faint">{t("settings.duplicateWindowHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {DUP_OPTIONS.map((opt) => {
                const active = currentDup === opt.val;
                return (
                  <button
                    key={opt.val}
                    type="button"
                    disabled={!hasPermission("settings.edit")}
                    onClick={() => setValue(SETTING_KEYS.duplicateWindowSeconds, opt.val)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                      active
                        ? "bg-primary text-white ring-primary shadow-glow-sm"
                        : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                    )}
                  >
                    {t(opt.label)}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Owner details configured at setup */}
          <div className="rounded-xl border border-line bg-surface/50 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-ink">{t("settings.owner")}</p>
                <p className="text-sm font-semibold text-neon mt-0.5">{ownerUser?.fullName || "—"}</p>
              </div>
            </div>
            <div>
              <Input
                label={t("settings.ownerPhone")}
                dir="ltr"
                value={ownerUser?.phone ?? ""}
                onChange={(e) => void handleUpdateOwnerPhone(e.target.value)}
                placeholder="01xxxxxxxxx"
                disabled={!hasPermission("settings.edit")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="block text-[13px] font-semibold text-subtle">{t("settings.workingDays")}</p>
            <div className="flex flex-wrap gap-1.5">
              {DAY_KEYS.map((label, day) => {
                const active = workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = active ? workingDays.filter((d) => d !== day) : [...workingDays, day].sort();
                      toggleDay(day);
                      setValue(SETTING_KEYS.workingDays, next.join(","));
                    }}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-colors",
                      active
                        ? "bg-neon/10 text-neon ring-neon/30"
                        : "bg-surface text-faint ring-line hover:text-subtle"
                    )}
                  >
                    {t(label)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      }
    />
  );
}

function ScannerSettingsCard() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api.settings
      .readAll()
      .then((all) => {
        if (!alive) return;
        setValues({
          [SETTING_KEYS.scannerEnabled]: all[SETTING_KEYS.scannerEnabled] ?? "1",
          [SETTING_KEYS.scannerPrefix]: all[SETTING_KEYS.scannerPrefix] ?? "",
          [SETTING_KEYS.scannerSuffix]: all[SETTING_KEYS.scannerSuffix] ?? "",
          [SETTING_KEYS.scannerMinLength]: all[SETTING_KEYS.scannerMinLength] ?? "4",
          [SETTING_KEYS.scannerTimeoutMs]: all[SETTING_KEYS.scannerTimeoutMs] ?? "5000",
        });
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const drafts: SettingDraft[] = [
    { key: SETTING_KEYS.scannerPrefix, label: "settings.scannerPrefix", hint: "settings.prefixHint", dir: "ltr" },
    { key: SETTING_KEYS.scannerSuffix, label: "settings.scannerSuffix", hint: "settings.suffixHint", dir: "ltr" },
  ];

  const LENGTH_OPTIONS = [
    { label: "settings.scannerLength4", val: "4" },
    { label: "settings.scannerLength6", val: "6" },
    { label: "settings.scannerLength8", val: "8" },
  ];

  const TIMEOUT_OPTIONS = [
    { label: "settings.scannerTimeout1s", val: "1000" },
    { label: "settings.scannerTimeout3s", val: "3000" },
    { label: "settings.scannerTimeout5s", val: "5000" },
  ];

  const isScannerOn = (values[SETTING_KEYS.scannerEnabled] ?? "1") === "1";
  const currentLength = values[SETTING_KEYS.scannerMinLength] ?? "4";
  const currentTimeout = values[SETTING_KEYS.scannerTimeoutMs] ?? "5000";

  return (
    <SettingsForm
      title={t("settings.scannerTab")}
      drafts={drafts}
      values={values}
      setValue={setValue}
      extra={
        <div className="space-y-4 pt-1">
          {/* Scanner enabled / disabled button toggle */}
          <div className="space-y-1.5">
            <span className="block text-[13px] font-semibold text-subtle">{t("settings.scannerStatusLabel")}</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!hasPermission("settings.edit")}
                onClick={() => setValue(SETTING_KEYS.scannerEnabled, "1")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-bold transition-all border",
                  isScannerOn
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-glow-sm"
                    : "bg-surface border-line text-faint hover:text-subtle"
                )}
              >
                <span className={cn("size-2 rounded-full", isScannerOn ? "bg-emerald-400 animate-pulse" : "bg-faint")} />
                {t("settings.scannerActive")}
              </button>
              <button
                type="button"
                disabled={!hasPermission("settings.edit")}
                onClick={() => setValue(SETTING_KEYS.scannerEnabled, "0")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-xs font-bold transition-all border",
                  !isScannerOn
                    ? "bg-red/15 border-red/40 text-red shadow-glow-sm"
                    : "bg-surface border-line text-faint hover:text-subtle"
                )}
              >
                <span className={cn("size-2 rounded-full", !isScannerOn ? "bg-red" : "bg-faint")} />
                {t("settings.scannerDisabled")}
              </button>
            </div>
          </div>

          {/* Min Length options */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-subtle">{t("settings.scannerMinLength")}</label>
            <div className="flex flex-wrap gap-1.5">
              {LENGTH_OPTIONS.map((opt) => {
                const active = currentLength === opt.val;
                return (
                  <button
                    key={opt.val}
                    type="button"
                    disabled={!hasPermission("settings.edit")}
                    onClick={() => setValue(SETTING_KEYS.scannerMinLength, opt.val)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                      active
                        ? "bg-primary text-white ring-primary shadow-glow-sm"
                        : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                    )}
                  >
                    {t(opt.label)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timeout options */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-subtle">{t("settings.scannerTimeout")}</label>
            <div className="flex flex-wrap gap-1.5">
              {TIMEOUT_OPTIONS.map((opt) => {
                const active = currentTimeout === opt.val;
                return (
                  <button
                    key={opt.val}
                    type="button"
                    disabled={!hasPermission("settings.edit")}
                    onClick={() => setValue(SETTING_KEYS.scannerTimeoutMs, opt.val)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                      active
                        ? "bg-primary text-white ring-primary shadow-glow-sm"
                        : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                    )}
                  >
                    {t(opt.label)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      }
    />
  );
}

function NotificationSettingsCard() {
  const t = useT();
  const { hasPermission } = useAuth();
  const [values, setValues] = useState<Record<string, string>>({});
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    let alive = true;
    api.settings
      .readAll()
      .then((all) => {
        if (!alive) return;
        setValues({
          [SETTING_KEYS.notifyExpiryDays]: all[SETTING_KEYS.notifyExpiryDays] ?? "1,3,7",
          [SETTING_KEYS.dateFormat]: all[SETTING_KEYS.dateFormat] ?? "dmy",
          [SETTING_KEYS.timeFormat]: all[SETTING_KEYS.timeFormat] ?? "24h",
        });
        setSoundOn(all[SETTING_KEYS.soundEnabled] === "1");
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const EXPIRY_PRESETS = [
    { val: "1", label: "settings.expiryDaysPreset1" },
    { val: "3", label: "settings.expiryDaysPreset3" },
    { val: "5", label: "settings.expiryDaysPreset5" },
    { val: "7", label: "settings.expiryDaysPreset7" },
    { val: "14", label: "settings.expiryDaysPreset14" },
  ];

  const currentExpiryDays = (values[SETTING_KEYS.notifyExpiryDays] ?? "1,3,7")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const toggleExpiryPreset = (val: string) => {
    if (!hasPermission("settings.edit")) return;
    let next: string[];
    if (currentExpiryDays.includes(val)) {
      next = currentExpiryDays.filter((d) => d !== val);
    } else {
      next = [...currentExpiryDays, val].sort((a, b) => Number(a) - Number(b));
    }
    if (next.length === 0) next = ["1"];
    setValue(SETTING_KEYS.notifyExpiryDays, next.join(","));
  };

  const currentTimeFormat = values[SETTING_KEYS.timeFormat] ?? "24h";
  const currentDateFormat = values[SETTING_KEYS.dateFormat] ?? "dmy";

  return (
    <SettingsForm
      title={t("settings.notificationsTab")}
      drafts={[]}
      values={values}
      setValue={setValue}
      extra={
        <div className="space-y-4">
          {/* Expiry alerts multi-toggle capsules */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-subtle">
              {t("settings.expiryDays")}
            </label>
            <p className="-mt-1 text-[11px] text-faint">{t("settings.expiryDaysHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {EXPIRY_PRESETS.map((preset) => {
                const active = currentExpiryDays.includes(preset.val);
                return (
                  <button
                    key={preset.val}
                    type="button"
                    disabled={!hasPermission("settings.edit")}
                    onClick={() => toggleExpiryPreset(preset.val)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                      active
                        ? "bg-primary text-white ring-primary shadow-glow-sm"
                        : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                    )}
                  >
                    {t(preset.label)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time format buttons */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-subtle">{t("settings.timeFormat")}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!hasPermission("settings.edit")}
                onClick={() => setValue(SETTING_KEYS.timeFormat, "12h")}
                className={cn(
                  "rounded-xl py-2 px-3 text-xs font-bold transition-all border text-center",
                  currentTimeFormat === "12h"
                    ? "bg-primary/15 border-primary text-primary shadow-glow-sm"
                    : "bg-surface border-line text-faint hover:text-subtle"
                )}
              >
                {t("settings.format12h")}
              </button>
              <button
                type="button"
                disabled={!hasPermission("settings.edit")}
                onClick={() => setValue(SETTING_KEYS.timeFormat, "24h")}
                className={cn(
                  "rounded-xl py-2 px-3 text-xs font-bold transition-all border text-center",
                  currentTimeFormat === "24h"
                    ? "bg-primary/15 border-primary text-primary shadow-glow-sm"
                    : "bg-surface border-line text-faint hover:text-subtle"
                )}
              >
                {t("settings.format24h")}
              </button>
            </div>
          </div>

          {/* Date format buttons */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-subtle">{t("settings.dateFormat")}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!hasPermission("settings.edit")}
                onClick={() => setValue(SETTING_KEYS.dateFormat, "dmy")}
                className={cn(
                  "rounded-xl py-2 px-3 text-xs font-bold transition-all border text-center",
                  currentDateFormat === "dmy"
                    ? "bg-primary/15 border-primary text-primary shadow-glow-sm"
                    : "bg-surface border-line text-faint hover:text-subtle"
                )}
              >
                {t("settings.formatDmy")}
              </button>
              <button
                type="button"
                disabled={!hasPermission("settings.edit")}
                onClick={() => setValue(SETTING_KEYS.dateFormat, "ymd")}
                className={cn(
                  "rounded-xl py-2 px-3 text-xs font-bold transition-all border text-center",
                  currentDateFormat === "ymd"
                    ? "bg-primary/15 border-primary text-primary shadow-glow-sm"
                    : "bg-surface border-line text-faint hover:text-subtle"
                )}
              >
                {t("settings.formatYmd")}
              </button>
            </div>
          </div>

          <SoundToggle value={soundOn} onChange={setSoundOn} />
        </div>
      }
    />
  );
}

function SoundToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const { save } = useSettingsSaver();
  const canEdit = hasPermission("settings.edit");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={!canEdit}
      onClick={() => {
        const next = value ? "0" : "1";
        onChange(!value);
        void save([{ key: SETTING_KEYS.soundEnabled, value: next }], () => {
          toast("success", next === "1" ? t("settings.soundOn") : t("settings.soundOff"));
        });
      }}
      className={cn(
        "flex w-full items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] font-semibold transition-colors",
        canEdit && "hover:border-line-strong"
      )}
    >
      <span>{t("settings.sound")}</span>
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors",
          value ? "bg-neon/70" : "bg-white/10"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
            value ? "start-0.5" : "start-[22px]"
          )}
        />
      </span>
    </button>
  );
}

function BackupSettingsCard() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [encryption, setEncryption] = useState<{
    encryptEnabled: boolean;
    passwordSet: boolean;
    keyExists: boolean;
    source: "password" | "key" | null;
  } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { save } = useSettingsSaver();
  const canEdit = hasPermission("settings.edit");

  const refreshEncryption = () => {
    api.backup
      .securityStatus()
      .then((s) => setEncryption({ encryptEnabled: s.encryptEnabled, passwordSet: s.passwordSet, keyExists: s.keyExists, source: s.source }))
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    let alive = true;
    Promise.all([api.settings.readAll(), api.backup.securityStatus()])
      .then(([all, status]) => {
        if (!alive) return;
        setValues({
          [SETTING_KEYS.backupAutoIntervalHours]: all[SETTING_KEYS.backupAutoIntervalHours] ?? "24",
          [SETTING_KEYS.backupRetentionCount]: all[SETTING_KEYS.backupRetentionCount] ?? "10",
          [SETTING_KEYS.backupLocation]: all[SETTING_KEYS.backupLocation] ?? "",
          [SETTING_KEYS.backupRetentionPolicy]: all[SETTING_KEYS.backupRetentionPolicy] ?? JSON.stringify({ daily: 7, weekly: 8, monthly: 24 }),
        });
        setAutoEnabled((all[SETTING_KEYS.backupAutoEnabled] ?? "1") === "1");
        setEncryption({ encryptEnabled: status.encryptEnabled, passwordSet: status.passwordSet, keyExists: status.keyExists, source: status.source });
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const drafts: SettingDraft[] = [
    { key: SETTING_KEYS.backupLocation, label: "settings.backupLocationLabel", hint: "settings.backupLocationHint", dir: "ltr" },
  ];

  const INTERVAL_OPTIONS = [
    { label: "settings.backupInterval6h", val: "6" },
    { label: "settings.backupInterval12h", val: "12" },
    { label: "settings.backupInterval24h", val: "24" },
    { label: "settings.backupInterval168h", val: "168" },
  ];

  const RETENTION_OPTIONS = [
    { label: "settings.backupRetention5", val: "5" },
    { label: "settings.backupRetention10", val: "10" },
    { label: "settings.backupRetention20", val: "20" },
    { label: "settings.backupRetention30", val: "30" },
  ];

  const toggleAuto = async (enabled: boolean) => {
    setAutoEnabled(enabled);
    await save([{ key: SETTING_KEYS.backupAutoEnabled, value: enabled ? "1" : "0" }]);
  };

  const enableEncryption = async () => {
    if (!canEdit || !newPassword) return;
    setBusy(true);
    try {
      await api.backup.setPassword(newPassword, currentPassword || undefined);
      toast("success", t("settings.encryptionSavedToast"));
      setNewPassword("");
      setCurrentPassword("");
      refreshEncryption();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const disableEncryption = async () => {
    if (!canEdit) return;
    setBusy(true);
    try {
      await api.backup.clearEncryption(currentPassword || undefined);
      toast("success", t("settings.encryptionSavedToast"));
      setCurrentPassword("");
      refreshEncryption();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const currentInterval = values[SETTING_KEYS.backupAutoIntervalHours] ?? "24";
  const currentRetention = values[SETTING_KEYS.backupRetentionCount] ?? "10";

  return (
    <SettingsForm
      title={t("settings.backupTab")}
      drafts={drafts}
      values={values}
      setValue={setValue}
      extra={
        <div className="space-y-4 pt-1">
          {/* Quick buttons for backup auto interval */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-subtle">{t("settings.autoInterval")}</label>
            <p className="-mt-1 text-[11px] text-faint">{t("settings.autoIntervalHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {INTERVAL_OPTIONS.map((opt) => {
                const active = currentInterval === opt.val;
                return (
                  <button
                    key={opt.val}
                    type="button"
                    disabled={!hasPermission("settings.edit")}
                    onClick={() => setValue(SETTING_KEYS.backupAutoIntervalHours, opt.val)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                      active
                        ? "bg-primary text-white ring-primary shadow-glow-sm"
                        : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                    )}
                  >
                    {t(opt.label)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick buttons for backup retention count */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-subtle">{t("settings.retention")}</label>
            <p className="-mt-1 text-[11px] text-faint">{t("settings.retentionHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {RETENTION_OPTIONS.map((opt) => {
                const active = currentRetention === opt.val;
                return (
                  <button
                    key={opt.val}
                    type="button"
                    disabled={!hasPermission("settings.edit")}
                    onClick={() => setValue(SETTING_KEYS.backupRetentionCount, opt.val)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                      active
                        ? "bg-primary text-white ring-primary shadow-glow-sm"
                        : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                    )}
                  >
                    {t(opt.label)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[13px] font-semibold text-subtle">{t("settings.autoEnabled")}</span>
            <button
              type="button"
              aria-pressed={autoEnabled}
              onClick={() => void toggleAuto(!autoEnabled)}
              className="relative h-6 w-11 rounded-full transition-colors bg-white/10 aria-pressed:bg-primary/80"
            >
              <span className={cn(
                "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                autoEnabled ? "start-0.5" : "start-[22px]",
              )} />
            </button>
          </div>
          <p className="-mt-3 text-[11px] text-faint">{t("settings.autoEnabledHint")}</p>

          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <Lock className="size-4 text-subtle" aria-hidden />
              <p className="text-[13px] font-bold text-subtle">{t("settings.encryptionTitle")}</p>
            </div>
            <p className="mt-1 text-[11px] text-faint">{t("settings.encryptionEnabledHint")}</p>
            {encryption?.encryptEnabled ? (
              <p className="mt-3 text-[12px] font-semibold text-neon">{t("settings.encryptionEnabledNote")}</p>
            ) : (
              <p className="mt-3 text-[12px] text-faint">{t("settings.encryptionDisabledNote")}</p>
            )}
            {canEdit && (
              <div className="mt-3 space-y-2">
                {!encryption?.encryptEnabled ? (
                  <>
                    <Input
                      type="password"
                      dir="ltr"
                      placeholder={t("settings.encryptionPasswordPlaceholder")}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <Button size="sm" onClick={() => void enableEncryption()} loading={busy} disabled={busy || newPassword.length < 8}>
                      <Lock className="size-4" />
                      {t("settings.encryptionSetBtn")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Input
                      type="password"
                      dir="ltr"
                      placeholder={t("settings.encryptionCurrentPasswordPlaceholder")}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="danger" onClick={() => void disableEncryption()} loading={busy} disabled={busy}>
                        {t("settings.encryptionClearBtn")}
                      </Button>
                      {encryption.passwordSet && encryption.keyExists && (
                        <Button size="sm" variant="secondary" onClick={() => void enableEncryption()} loading={busy} disabled={busy || newPassword.length < 8}>
                          <KeyRound className="size-4" />
                          {t("settings.encryptionSetBtn")}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      }
    />
  );
}

function ChangePasswordCard() {
  const t = useT();
  const { actor } = useAuth();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    setError(null);
    if (!currentPassword) {
      setError(t("settings.errCurrentRequired"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.errPasswordMismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await rpc("auth", "changeOwnPassword", [currentPassword, newPassword]);
      toast("success", t("settings.changedToast"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t("settings.securityTab")} />
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-3.5 p-5">
        <div className="space-y-1.5">
          <label htmlFor="cur-pass" className="block text-[13px] font-semibold text-subtle">
            {t("settings.currentPassword")}
          </label>
          <PasswordInput
            id="cur-pass"
            autoComplete="current-password"
            placeholder="••••••••"
            dir="ltr"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="new-pass" className="block text-[13px] font-semibold text-subtle">
            {t("settings.newPassword")}
          </label>
          <PasswordInput
            id="new-pass"
            autoComplete="new-password"
            placeholder="••••••••"
            dir="ltr"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="conf-pass" className="block text-[13px] font-semibold text-subtle">
            {t("settings.confirmPassword")}
          </label>
          <PasswordInput
            id="conf-pass"
            autoComplete="new-password"
            placeholder="••••••••"
            dir="ltr"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={submitting}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-[13px] font-semibold text-red">
            {error}
          </p>
        )}
        <Button type="submit" loading={submitting} disabled={submitting}>
          <KeyRound className="size-4" />
          {t("settings.changePassword")}
        </Button>
      </form>
    </Card>
  );
}