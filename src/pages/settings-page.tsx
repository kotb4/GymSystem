import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Lock, Save } from "lucide-react";
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

type SettingsTab = "general" | "backups" | "scanner";

export function SettingsPage() {
  const t = useT();
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <div className="space-y-4">
      <Tabs
        items={[
          { value: "general", label: t("settings.generalTab") },
          { value: "backups", label: t("settings.backupsTab") },
          { value: "scanner", label: t("settings.scannerDiagTab") },
        ]}
        value={tab}
        onChange={(v) => setTab(v as SettingsTab)}
      />
      {tab === "general" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <GeneralSettingsCard />
          <ScannerSettingsCard />
          <NotificationSettingsCard />
          <ChangePasswordCard />
          <BackupSettingsCard />
        </div>
      )}
      {tab === "backups" && <HealthTab />}
      {tab === "scanner" && <ScannerTab />}
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
        action={
          canEdit ? (
            <Button size="sm" variant="secondary" onClick={() => void save(drafts.map((d) => ({ key: d.key, value: values[d.key] ?? "" })))} loading={submitting} disabled={submitting}>
              <Save className="size-4" />
              {t("common.save")}
            </Button>
          ) : undefined
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
          <Button type="submit" loading={submitting} disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </Button>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Card>
  );
}

function GeneralSettingsCard() {
  const t = useT();
  const {} = useAuth();
  const [values, setValues] = useState<Record<string, string>>({});
  const [workingDays, setWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);
  useEffect(() => {
    let alive = true;
    api.settings
      .readAll()
      .then((all) => {
        if (!alive) return;
        setValues({
          [SETTING_KEYS.gymName]: all[SETTING_KEYS.gymName] ?? "",
        [SETTING_KEYS.currencySymbol]: all[SETTING_KEYS.currencySymbol] ?? "",
        [SETTING_KEYS.gymPhone]: all[SETTING_KEYS.gymPhone] ?? "",
        [SETTING_KEYS.gymAddress]: all[SETTING_KEYS.gymAddress] ?? "",
        [SETTING_KEYS.workingHours]: all[SETTING_KEYS.workingHours] ?? "",
          [SETTING_KEYS.duplicateWindowSeconds]: all[SETTING_KEYS.duplicateWindowSeconds] ?? "45",
        });
        const rawDays = all[SETTING_KEYS.workingDays];
        if (rawDays)
          setWorkingDays(
            rawDays.split(",").map((d) => Number(d)).filter((n) => !Number.isNaN(n)),
          );
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));
  const toggleDay = (day: number) =>
    setWorkingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));

  const drafts: SettingDraft[] = [
    { key: SETTING_KEYS.gymName, label: "settings.gymName" },
    { key: SETTING_KEYS.currencySymbol, label: "settings.currencySymbol" },
    { key: SETTING_KEYS.gymPhone, label: "settings.phone", dir: "ltr" },
    { key: SETTING_KEYS.gymAddress, label: "settings.address" },
    { key: SETTING_KEYS.workingHours, label: "settings.workingHours", hint: "settings.workingHoursHint" },
    { key: SETTING_KEYS.duplicateWindowSeconds, label: "settings.duplicateWindow", hint: "settings.duplicateWindowHint", type: "number", dir: "ltr" },
  ];

  return (
    <SettingsForm
      title={t("settings.generalTab")}
      drafts={drafts}
      values={values}
      setValue={setValue}
      extra={
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
                  onClick={() => toggleDay(day)}
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
          <DaySaver workingDays={workingDays} />
        </div>
      }
    />
  );
}

function DaySaver({ workingDays }: { workingDays: number[] }) {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { submitting, save } = useSettingsSaver();
  if (!hasPermission("settings.edit")) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() =>
        void save([{ key: SETTING_KEYS.workingDays, value: workingDays.join(",") }])
      }
      loading={submitting}
      disabled={submitting || !actor}
    >
      {t("settings.saveDays")}
    </Button>
  );
}

function ScannerSettingsCard() {
  const t = useT();
  const {} = useAuth();
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
    { key: SETTING_KEYS.scannerEnabled, label: "settings.scannerEnabled", hint: "settings.boolHint" },
    { key: SETTING_KEYS.scannerPrefix, label: "settings.scannerPrefix", hint: "settings.prefixHint", dir: "ltr" },
    { key: SETTING_KEYS.scannerSuffix, label: "settings.scannerSuffix", hint: "settings.suffixHint", dir: "ltr" },
    { key: SETTING_KEYS.scannerMinLength, label: "settings.scannerMinLength", type: "number", dir: "ltr" },
    { key: SETTING_KEYS.scannerTimeoutMs, label: "settings.scannerTimeout", type: "number", dir: "ltr" },
  ];

  return (
    <SettingsForm title={t("settings.scannerTab")} drafts={drafts} values={values} setValue={setValue} />
  );
}

function NotificationSettingsCard() {
  const t = useT();
  const {} = useAuth();
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

  const drafts: SettingDraft[] = [
    { key: SETTING_KEYS.notifyExpiryDays, label: "settings.expiryDays", hint: "settings.expiryDaysHint", dir: "ltr" },
    { key: SETTING_KEYS.dateFormat, label: "settings.dateFormat", hint: "settings.dateFormatHint", dir: "ltr" },
    { key: SETTING_KEYS.timeFormat, label: "settings.timeFormat", hint: "settings.timeFormatHint", dir: "ltr" },
  ];

  return (
    <SettingsForm
      title={t("settings.notificationsTab")}
      drafts={drafts}
      values={values}
      setValue={setValue}
      extra={<SoundToggle value={soundOn} onChange={setSoundOn} />}
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
    { key: SETTING_KEYS.backupAutoIntervalHours, label: "settings.autoInterval", hint: "settings.autoIntervalHint", type: "number", dir: "ltr" },
    { key: SETTING_KEYS.backupRetentionCount, label: "settings.retention", hint: "settings.retentionHint", type: "number", dir: "ltr" },
    { key: SETTING_KEYS.backupLocation, label: "settings.backupLocationLabel", hint: "settings.backupLocationHint", dir: "ltr" },
    { key: SETTING_KEYS.backupRetentionPolicy, label: "settings.retentionPolicyLabel", hint: "settings.retentionPolicyHint", dir: "ltr" },
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

  return (
    <SettingsForm
      title={t("settings.backupTab")}
      drafts={drafts}
      values={values}
      setValue={setValue}
      extra={
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-subtle">{t("settings.autoEnabled")}</span>
            <button
              type="button"
              aria-pressed={autoEnabled}
              onClick={() => void toggleAuto(!autoEnabled)}
              className="relative h-6 w-11 rounded-full transition-colors bg-white/10 aria-pressed:bg-neon/70"
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
