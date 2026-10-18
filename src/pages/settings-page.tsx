import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Building2,
  ScanLine,
  Receipt,
  MessageSquare,
  Network,
  ShieldCheck,
  Sparkles,
  Upload,
  Trash2,
  Clock,
  Lock,
  KeyRound,
  Volume2,
  VolumeX,
  AlertCircle,
  Save,
  RotateCcw,
  Settings,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { useLicense } from "@/contexts/license-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api, rpc } from "@/api";
import { SETTING_KEYS } from "@/core/services/settings.service";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { PasswordInput } from "@/components/ui/password-input";
import { HealthTab } from "@/components/settings/health-tab";
import { ScannerTab } from "@/components/settings/scanner-tab";
import { WhatsAppSettingsCard } from "@/components/settings/whatsapp-settings-card";
import { LicenseSettingsCard } from "@/components/settings/license-settings-card";
import { SimpleNetworkCard } from "@/components/settings/simple-network-card";
import { ReceiptTemplateTab } from "@/components/settings/receipt-template-tab";
import { cn } from "@/utils/cn";

export type SettingsTab =
  | "general"
  | "hardware"
  | "scanner"
  | "receipt"
  | "whatsapp"
  | "network"
  | "backups"
  | "license";

const DAY_KEYS = [
  "settings.day0",
  "settings.day1",
  "settings.day2",
  "settings.day3",
  "settings.day4",
  "settings.day5",
  "settings.day6",
];

const CURRENCY_OPTIONS: SelectOption[] = [
  { value: "ج.م", label: "ج.م — جنيه مصري" },
  { value: "ر.س", label: "ر.س — ريال سعودي" },
  { value: "د.إ", label: "د.إ — درهم إماراتي" },
  { value: "د.ك", label: "د.ك — دينار كويتي" },
  { value: "ر.ع", label: "ر.ع — ريال عماني" },
  { value: "د.ب", label: "د.ب — دينار بحريني" },
  { value: "ر.ق", label: "ر.ق — ريال قطري" },
  { value: "د.أ", label: "د.أ — دينار أردني" },
  { value: "د.ل", label: "د.ل — دينار ليبي" },
  { value: "د.ت", label: "د.ت — دينار تونسي" },
  { value: "د.ج", label: "د.ج — دينار جزائري" },
  { value: "د.م.", label: "د.م. — درهم مغربي" },
  { value: "$", label: "$ — دولار أمريكي (USD)" },
  { value: "€", label: "€ — يورو (EUR)" },
];

export function SettingsPage() {
  const t = useT();
  const { status: licStatus } = useLicense();
  const [tab, setTab] = useState<SettingsTab>("general");
  const [whatsappOnline, setWhatsappOnline] = useState<boolean | null>(null);

  // Poll lightweight status on mount for tab badges
  useEffect(() => {
    let alive = true;
    api.gateway
      .health("http://127.0.0.1:8891")
      .then((h) => {
        if (alive) setWhatsappOnline(Boolean(h && h.ok));
      })
      .catch(() => {
        if (alive) setWhatsappOnline(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const licenseActive = Boolean(licStatus && !licStatus.readOnly && !licStatus.needsActivation);

  const tabItems = [
    {
      id: "general" as SettingsTab,
      label: t("settings.generalTab"),
      icon: Building2,
      subtitle: "الشعار والبيانات الأساسية",
    },
    {
      id: "hardware" as SettingsTab,
      label: t("settings.hardwareTab"),
      icon: ScanLine,
      subtitle: "القارئ، التواجد، والأصوات",
    },
    {
      id: "receipt" as SettingsTab,
      label: t("settings.receiptTemplateTab"),
      icon: Receipt,
      subtitle: "الفواتير والمطبوعات",
    },
    {
      id: "whatsapp" as SettingsTab,
      label: t("settings.whatsappTab"),
      icon: MessageSquare,
      subtitle: "البوابة والإرسال التلقائي",
      statusDot:
        whatsappOnline === true
          ? "bg-emerald-400"
          : whatsappOnline === false
          ? "bg-faint"
          : undefined,
    },
    {
      id: "network" as SettingsTab,
      label: t("settings.networkTab"),
      icon: Network,
      subtitle: "المزامنة والوصول السحابي",
    },
    {
      id: "backups" as SettingsTab,
      label: t("settings.securityAndBackupsTab"),
      icon: ShieldCheck,
      subtitle: "النسخ، الأمان، وصحة النظام",
    },
    {
      id: "license" as SettingsTab,
      label: t("settings.licenseTab"),
      icon: Sparkles,
      subtitle: "الترخيص ومعلومات النظام",
      badge: licenseActive ? "نشط" : undefined,
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. UNIFIED PAGE HEADER */}
      <PageHeader
        icon={Settings}
        title={t("nav.settings")}
        subtitle="تهيئة الإعدادات العامة للنظام، تخصيص القارئ، قوالب الإيصالات، واتساب، المزامنة، والنسخ الاحتياطي"
        badge={
          <Badge variant="neutral" className="font-mono text-xs">
            {tabItems.length} أقسام تكوين
          </Badge>
        }
      />

      {/* Modern Horizontal Capsule Tabs Strip */}
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex items-center gap-2 rounded-2xl border border-line/80 bg-panel/80 p-1.5 backdrop-blur-md shadow-sm min-w-max">
          {tabItems.map((item) => {
            const Icon = item.icon;
            const isActive = tab === item.id || (item.id === "hardware" && tab === "scanner");
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-xs font-bold transition-all select-none",
                  isActive
                    ? "bg-primary text-white shadow-glow-sm ring-1 ring-primary/50"
                    : "text-subtle hover:text-ink hover:bg-surface/80"
                )}
              >
                <Icon className={cn("size-4 shrink-0", isActive ? "text-white" : "text-subtle")} />
                <span className="tracking-wide">{item.label}</span>

                {item.statusDot && (
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      item.statusDot,
                      item.statusDot.includes("emerald") && "animate-pulse"
                    )}
                  />
                )}

                {item.badge && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-black",
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-primary/10 text-primary border border-primary/20"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Panels */}
      {tab === "general" && <GeneralTabContent />}

      {(tab === "hardware" || tab === "scanner") && <HardwareTabContent />}

      {tab === "receipt" && <ReceiptTemplateTab />}

      {tab === "whatsapp" && (
        <div className="max-w-5xl">
          <WhatsAppSettingsCard />
        </div>
      )}

      {tab === "network" && (
        <div className="max-w-5xl space-y-4">
          <SimpleNetworkCard />
        </div>
      )}

      {tab === "backups" && <BackupsAndSecurityTabContent />}

      {tab === "license" && (
        <div className="max-w-5xl">
          <LicenseSettingsCard />
        </div>
      )}
    </div>
  );
}

function ReadOnlyNotice() {
  const t = useT();
  const { hasPermission } = useAuth();
  if (hasPermission("settings.edit")) return null;
  return (
    <div className="rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-xs font-semibold text-amber flex items-center gap-2">
      <AlertCircle className="size-4 shrink-0" />
      <span>{t("settings.readOnlyNotice")}</span>
    </div>
  );
}

// =========================================================================
// TAB 1: General (هوية الصالة وشعار النادي + ساعات العمل والتنبيهات)
// =========================================================================
function GeneralTabContent() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const canEdit = hasPermission("settings.edit");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [values, setValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [logoData, setLogoData] = useState<string>("");
  const [initialLogoData, setInitialLogoData] = useState<string>("");
  const [workingDays, setWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [initialWorkingDays, setInitialWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);

  const [ownerUser, setOwnerUser] = useState<{ id: string; fullName: string; phone: string | null } | null>(null);
  const [ownerPhone, setOwnerPhone] = useState<string>("");
  const [initialOwnerPhone, setInitialOwnerPhone] = useState<string>("");

  useEffect(() => {
    let alive = true;
    Promise.all([api.settings.readAll(), api.users.list()])
      .then(([all, users]) => {
        if (!alive) return;
        const loaded: Record<string, string> = {
          [SETTING_KEYS.gymName]: all[SETTING_KEYS.gymName] ?? "",
          [SETTING_KEYS.gymPhone]: all[SETTING_KEYS.gymPhone] ?? "",
          [SETTING_KEYS.currencySymbol]: all[SETTING_KEYS.currencySymbol] || "ج.م",
          [SETTING_KEYS.gymAddress]: all[SETTING_KEYS.gymAddress] ?? "",
          [SETTING_KEYS.workingHours]: all[SETTING_KEYS.workingHours] ?? "",
          [SETTING_KEYS.notifyExpiryDays]: all[SETTING_KEYS.notifyExpiryDays] ?? "1,3,7",
          [SETTING_KEYS.freezeExtendsExpiry]: all[SETTING_KEYS.freezeExtendsExpiry] ?? "1",
        };
        setValues(loaded);
        setInitialValues(loaded);

        const currentLogo = all[SETTING_KEYS.receiptLogoData] ?? "";
        setLogoData(currentLogo);
        setInitialLogoData(currentLogo);

        const rawDays = all[SETTING_KEYS.workingDays];
        const days = rawDays
          ? rawDays.split(",").map(Number).filter((n) => !Number.isNaN(n))
          : [0, 1, 2, 3, 4];
        setWorkingDays(days);
        setInitialWorkingDays(days);

        const owner = users.find((u) => u.roleId === "owner");
        if (owner) {
          const ph = owner.phone ?? "";
          setOwnerUser({ id: owner.id, fullName: owner.fullName, phone: owner.phone });
          setOwnerPhone(ph);
          setInitialOwnerPhone(ph);
          // Auto fallback if gymPhone empty
          if (!loaded[SETTING_KEYS.gymPhone] && ph) {
            setValues((prev) => ({ ...prev, [SETTING_KEYS.gymPhone]: ph }));
          }
        }
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const toggleDay = (day: number) => {
    if (!canEdit) return;
    setWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("error", "يرجى اختيار ملف صورة صالح (PNG, JPG, WEBP)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("error", "حجم الصورة كبير — الحد الأقصى 2 ميجابايت");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoData(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoData("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Expiry notification capsules
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
    if (!canEdit) return;
    let next: string[];
    if (currentExpiryDays.includes(val)) {
      next = currentExpiryDays.filter((d) => d !== val);
    } else {
      next = [...currentExpiryDays, val].sort((a, b) => Number(a) - Number(b));
    }
    if (next.length === 0) next = ["1"];
    setValue(SETTING_KEYS.notifyExpiryDays, next.join(","));
  };

  // Check dirty state
  const isDirty = useMemo(() => {
    if (logoData !== initialLogoData) return true;
    if (ownerPhone !== initialOwnerPhone) return true;
    if (workingDays.join(",") !== initialWorkingDays.join(",")) return true;
    for (const key of Object.keys(values)) {
      if ((values[key] ?? "") !== (initialValues[key] ?? "")) return true;
    }
    return false;
  }, [values, initialValues, logoData, initialLogoData, ownerPhone, initialOwnerPhone, workingDays, initialWorkingDays]);

  const handleDiscard = () => {
    setValues({ ...initialValues });
    setLogoData(initialLogoData);
    setOwnerPhone(initialOwnerPhone);
    setWorkingDays([...initialWorkingDays]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canEdit || submitting) return;

    setSubmitting(true);
    try {
      // 1. Save modified general settings
      const toSave: Array<{ key: string; value: string }> = [];

      for (const [key, val] of Object.entries(values)) {
        if (val !== initialValues[key]) {
          toSave.push({ key, value: val });
        }
      }

      // Working days
      const daysStr = workingDays.join(",");
      if (daysStr !== initialWorkingDays.join(",")) {
        toSave.push({ key: SETTING_KEYS.workingDays, value: daysStr });
      }

      // Logo
      if (logoData !== initialLogoData) {
        toSave.push({ key: SETTING_KEYS.receiptLogoData, value: logoData });
        if (logoData && !initialLogoData) {
          toSave.push({ key: SETTING_KEYS.receiptShowLogo, value: "1" });
        }
      }

      for (const item of toSave) {
        await api.settings.update(item.key, item.value);
      }

      // 2. Update owner phone if changed
      if (ownerUser && ownerPhone !== initialOwnerPhone && (hasPermission("users.manage") || actor?.roleId === "owner")) {
        await api.users.update(ownerUser.id, { phone: ownerPhone });
        setInitialOwnerPhone(ownerPhone);
      }

      setInitialValues({ ...values });
      setInitialLogoData(logoData);
      setInitialWorkingDays([...workingDays]);

      toast("success", t("settings.savedToast"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const currVal = values[SETTING_KEYS.currencySymbol] || "ج.م";
  const currencyOptions = useMemo(() => {
    const list = [...CURRENCY_OPTIONS];
    if (currVal && !list.some((o) => o.value === currVal)) {
      list.unshift({ value: currVal, label: `${currVal} (مخصص)` });
    }
    return list;
  }, [currVal]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-subtle">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} noValidate className="space-y-6">
      <ReadOnlyNotice />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* CARD 1: هوية الصالة وشعار النادي */}
        <Card className="flex flex-col justify-between">
          <div>
            <CardHeader
              title={
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-ink">{t("settings.clubIdentitySection")}</h3>
                    <p className="text-[11px] text-subtle mt-0.5">{t("settings.clubIdentityDesc")}</p>
                  </div>
                </div>
              }
            />

            <div className="p-5 space-y-4">
              {/* Logo Uploader / Preview Box */}
              <div className="rounded-2xl border border-line bg-surface/60 p-4">
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="relative group shrink-0">
                    {logoData ? (
                      <div className="size-20 rounded-2xl border border-line bg-panel p-2 flex items-center justify-center shadow-sm overflow-hidden">
                        <img
                          src={logoData}
                          alt="شعار الصالة"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="size-20 rounded-2xl border border-dashed border-line bg-panel flex flex-col items-center justify-center text-faint">
                        <Building2 className="size-8" />
                        <span className="text-[10px] font-bold mt-1">بدون شعار</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 text-center sm:text-right space-y-2">
                    <div>
                      <p className="text-xs font-bold text-ink">{t("settings.receiptLogoLabel")}</p>
                      <p className="text-[11px] text-subtle mt-0.5">{t("settings.logoPreviewHint")}</p>
                    </div>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={!canEdit}
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!canEdit}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 text-xs font-semibold"
                      >
                        <Upload className="size-3.5" />
                        <span>{t("settings.uploadLogoBtn")}</span>
                      </Button>

                      {logoData && canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleRemoveLogo}
                          className="flex items-center gap-1.5 text-xs font-semibold text-red hover:bg-red/10"
                        >
                          <Trash2 className="size-3.5" />
                          <span>{t("settings.removeLogoBtn")}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Gym Name & Official Phone */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={t("settings.gymName")}
                  value={values[SETTING_KEYS.gymName] ?? ""}
                  onChange={(e) => setValue(SETTING_KEYS.gymName, e.target.value)}
                  disabled={!canEdit || submitting}
                  placeholder="مثال: جيم جيت فيتنس"
                />
                <Input
                  label={t("settings.phone")}
                  dir="ltr"
                  value={values[SETTING_KEYS.gymPhone] ?? ""}
                  onChange={(e) => setValue(SETTING_KEYS.gymPhone, e.target.value)}
                  disabled={!canEdit || submitting}
                  placeholder="01xxxxxxxxx"
                />
              </div>

              {/* Owner Phone & Currency */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Input
                    label={t("settings.ownerPhone")}
                    dir="ltr"
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    disabled={!canEdit || submitting}
                    placeholder="01xxxxxxxxx"
                  />
                  {ownerUser && (
                    <p className="mt-1 text-[11px] text-faint">
                      المالك المعتمد: <span className="font-bold text-subtle">{ownerUser.fullName}</span>
                    </p>
                  )}
                </div>

                <Select
                  label={t("settings.currencySymbol")}
                  value={values[SETTING_KEYS.currencySymbol] ?? "ج.م"}
                  onChange={(e) => setValue(SETTING_KEYS.currencySymbol, e.target.value)}
                  options={currencyOptions}
                  disabled={!canEdit || submitting}
                />
              </div>

              {/* Address */}
              <Input
                label={t("settings.address")}
                value={values[SETTING_KEYS.gymAddress] ?? ""}
                onChange={(e) => setValue(SETTING_KEYS.gymAddress, e.target.value)}
                disabled={!canEdit || submitting}
                placeholder="العنوان الرسمي للصالة"
              />
            </div>
          </div>
        </Card>

        {/* CARD 2: ساعات العمل والتنبيهات التشغيلية */}
        <Card className="flex flex-col justify-between">
          <div>
            <CardHeader
              title={
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-neon/10 text-neon border border-neon/20">
                    <Clock className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-ink">{t("settings.operationsSection")}</h3>
                    <p className="text-[11px] text-subtle mt-0.5">{t("settings.operationsDesc")}</p>
                  </div>
                </div>
              }
            />

            <div className="p-5 space-y-4">
              {/* Working Hours text */}
              <div>
                <Input
                  label={t("settings.workingHours")}
                  value={values[SETTING_KEYS.workingHours] ?? ""}
                  onChange={(e) => setValue(SETTING_KEYS.workingHours, e.target.value)}
                  disabled={!canEdit || submitting}
                  placeholder="مثال: من 8 صباحاً حتى 12 منتصف الليل"
                />
                <p className="mt-1 text-[11px] text-faint">{t("settings.workingHoursHint")}</p>
              </div>

              {/* Working Days Chips */}
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
                        disabled={!canEdit || submitting}
                        onClick={() => toggleDay(day)}
                        className={cn(
                          "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                          active
                            ? "bg-primary text-white ring-primary shadow-glow-sm"
                            : "bg-surface text-faint ring-line hover:text-subtle"
                        )}
                      >
                        {t(label)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Subscription Expiry Alert Days */}
              <div className="space-y-1.5 pt-2 border-t border-line/60">
                <label className="block text-[13px] font-semibold text-subtle">
                  {t("settings.expiryDays")}
                </label>
                <p className="text-[11px] text-faint -mt-1">{t("settings.expiryDaysHint")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_PRESETS.map((preset) => {
                    const active = currentExpiryDays.includes(preset.val);
                    return (
                      <button
                        key={preset.val}
                        type="button"
                        disabled={!canEdit || submitting}
                        onClick={() => toggleExpiryPreset(preset.val)}
                        className={cn(
                          "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                          active
                            ? "bg-neon/15 text-neon ring-neon/40 shadow-glow-sm"
                            : "bg-surface text-faint ring-line hover:text-subtle"
                        )}
                      >
                        {t(preset.label)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Automatic Freeze Extends Expiry */}
              <div className="space-y-1.5 rounded-2xl border border-line bg-surface/50 p-4">
                <div className="flex items-center justify-between">
                  <label className="block text-[13px] font-semibold text-subtle">
                    {t("settings.freezeExtendsExpiry")}
                  </label>
                  <span
                    className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded",
                      (values[SETTING_KEYS.freezeExtendsExpiry] ?? "1") === "1"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-red/10 text-red"
                    )}
                  >
                    {(values[SETTING_KEYS.freezeExtendsExpiry] ?? "1") === "1" ? "مفعّل" : "معطّل"}
                  </span>
                </div>
                <p className="text-[11px] text-faint">{t("settings.freezeExtendsExpiryHint")}</p>
                <div className="grid grid-cols-2 gap-2 pt-1.5">
                  <button
                    type="button"
                    disabled={!canEdit || submitting}
                    onClick={() => setValue(SETTING_KEYS.freezeExtendsExpiry, "1")}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-xs font-bold transition-all border",
                      (values[SETTING_KEYS.freezeExtendsExpiry] ?? "1") === "1"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-glow-sm"
                        : "bg-surface border-line text-faint hover:text-subtle"
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        (values[SETTING_KEYS.freezeExtendsExpiry] ?? "1") === "1"
                          ? "bg-emerald-400 animate-pulse"
                          : "bg-faint"
                      )}
                    />
                    {t("settings.freezeExtendsActive")}
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit || submitting}
                    onClick={() => setValue(SETTING_KEYS.freezeExtendsExpiry, "0")}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-xs font-bold transition-all border",
                      (values[SETTING_KEYS.freezeExtendsExpiry] ?? "1") === "0"
                        ? "bg-red/15 border-red/40 text-red shadow-glow-sm"
                        : "bg-surface border-line text-faint hover:text-subtle"
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        (values[SETTING_KEYS.freezeExtendsExpiry] ?? "1") === "0" ? "bg-red" : "bg-faint"
                      )}
                    />
                    {t("settings.freezeExtendsDisabled")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Floating Save Bar when dirty */}
      {isDirty && (
        <div className="sticky bottom-4 z-30 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-panel/95 backdrop-blur-md p-4 shadow-glow-md">
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full bg-amber animate-pulse shrink-0" />
            <div>
              <p className="text-xs font-bold text-ink">{t("settings.unsavedChanges")}</p>
              <p className="text-[11px] text-faint">{t("settings.unsavedChangesDesc")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={submitting}
              onClick={handleDiscard}
              className="flex items-center gap-1.5 text-xs font-semibold"
            >
              <RotateCcw className="size-3.5" />
              <span>{t("settings.discardChanges")}</span>
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={submitting}
              disabled={submitting}
              className="flex items-center gap-1.5 text-xs font-bold shadow-glow-sm"
            >
              <Save className="size-3.5" />
              <span>{t("settings.saveAllChanges")}</span>
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

// =========================================================================
// TAB 2: Hardware & Reception (أجهزة الاستقبال، قارئ الباركود، ومحاكي المسح)
// =========================================================================
function HardwareTabContent() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canEdit = hasPermission("settings.edit");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api.settings
      .readAll()
      .then((all) => {
        if (!alive) return;
        const loaded: Record<string, string> = {
          [SETTING_KEYS.scannerEnabled]: all[SETTING_KEYS.scannerEnabled] ?? "1",
          [SETTING_KEYS.scannerPrefix]: all[SETTING_KEYS.scannerPrefix] ?? "",
          [SETTING_KEYS.scannerSuffix]: all[SETTING_KEYS.scannerSuffix] ?? "",
          [SETTING_KEYS.scannerMinLength]: all[SETTING_KEYS.scannerMinLength] ?? "4",
          [SETTING_KEYS.scannerTimeoutMs]: all[SETTING_KEYS.scannerTimeoutMs] ?? "5000",
          [SETTING_KEYS.duplicateWindowSeconds]: all[SETTING_KEYS.duplicateWindowSeconds] ?? "45",
          [SETTING_KEYS.occupancyDurationMinutes]: all[SETTING_KEYS.occupancyDurationMinutes] ?? "120",
          [SETTING_KEYS.soundEnabled]: all[SETTING_KEYS.soundEnabled] ?? "1",
        };
        setValues(loaded);
        setInitialValues(loaded);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const isScannerOn = (values[SETTING_KEYS.scannerEnabled] ?? "1") === "1";
  const soundOn = (values[SETTING_KEYS.soundEnabled] ?? "1") === "1";

  const DUP_OPTIONS = [
    { label: "settings.dupWindow15s", val: "15" },
    { label: "settings.dupWindow30s", val: "30" },
    { label: "settings.dupWindow45s", val: "45" },
    { label: "settings.dupWindow60s", val: "60" },
    { label: "settings.dupWindow120s", val: "120" },
  ];

  const OCCUPANCY_OPTIONS = [
    { label: "settings.occupancy45m", val: "45" },
    { label: "settings.occupancy60m", val: "60" },
    { label: "settings.occupancy90m", val: "90" },
    { label: "settings.occupancy120m", val: "120" },
    { label: "settings.occupancy180m", val: "180" },
    { label: "settings.occupancy240m", val: "240" },
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

  const isDirty = useMemo(() => {
    for (const key of Object.keys(values)) {
      if ((values[key] ?? "") !== (initialValues[key] ?? "")) return true;
    }
    return false;
  }, [values, initialValues]);

  const handleDiscard = () => {
    setValues({ ...initialValues });
  };

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canEdit || submitting) return;
    setSubmitting(true);
    try {
      for (const [key, val] of Object.entries(values)) {
        if (val !== initialValues[key]) {
          await api.settings.update(key, val);
        }
      }
      setInitialValues({ ...values });
      toast("success", t("settings.savedToast"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-subtle">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const currentDup = values[SETTING_KEYS.duplicateWindowSeconds] ?? "45";
  const currentOccupancy = values[SETTING_KEYS.occupancyDurationMinutes] ?? "120";
  const currentLength = values[SETTING_KEYS.scannerMinLength] ?? "4";
  const currentTimeout = values[SETTING_KEYS.scannerTimeoutMs] ?? "5000";

  return (
    <form onSubmit={(e) => void handleSave(e)} noValidate className="space-y-6">
      <ReadOnlyNotice />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Hardware Settings Card */}
        <Card className="flex flex-col justify-between">
          <div>
            <CardHeader
              title={
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                    <ScanLine className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-ink">إعدادات أجهزة الاستقبال وقارئ الباركود</h3>
                    <p className="text-[11px] text-subtle mt-0.5">ضبط قارئ الباركود، نافذة التكرار، والمدة التقديرية للصالة</p>
                  </div>
                </div>
              }
            />

            <div className="p-5 space-y-4">
              {/* Scanner On / Off */}
              <div className="space-y-1.5">
                <span className="block text-[13px] font-semibold text-subtle">{t("settings.scannerStatusLabel")}</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!canEdit || submitting}
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
                    disabled={!canEdit || submitting}
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

              {/* Duplicate scan window */}
              <div className="space-y-1.5 pt-2 border-t border-line/60">
                <div className="flex items-center justify-between">
                  <label className="block text-[13px] font-semibold text-subtle">
                    {t("settings.duplicateWindow")}
                  </label>
                  <span className="text-xs font-bold text-primary font-mono">{currentDup} ثانية</span>
                </div>
                <p className="-mt-1 text-[11px] text-faint">{t("settings.duplicateWindowHint")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {DUP_OPTIONS.map((opt) => {
                    const active = currentDup === opt.val;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        disabled={!canEdit || submitting}
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

              {/* Floor Occupancy Duration */}
              <div className="space-y-2 rounded-2xl border border-line bg-surface/50 p-4">
                <div className="flex items-center justify-between">
                  <label className="block text-[13px] font-semibold text-subtle">
                    {t("settings.occupancyDuration")}
                  </label>
                  <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-lg border border-emerald-500/20">
                    {currentOccupancy} دقيقة
                  </span>
                </div>
                <p className="-mt-1 text-[11px] text-faint">{t("settings.occupancyDurationHint")}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {OCCUPANCY_OPTIONS.map((opt) => {
                    const active = currentOccupancy === opt.val;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        disabled={!canEdit || submitting}
                        onClick={() => setValue(SETTING_KEYS.occupancyDurationMinutes, opt.val)}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                          active
                            ? "bg-emerald-500 text-white ring-emerald-500 shadow-glow-sm"
                            : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                        )}
                      >
                        {t(opt.label)}
                      </button>
                    );
                  })}
                </div>
                <div className="pt-2 flex items-center gap-2">
                  <span className="text-[11px] text-faint">أو تخصيص مدة بالدقائق:</span>
                  <input
                    type="number"
                    min={15}
                    max={720}
                    disabled={!canEdit || submitting}
                    value={currentOccupancy}
                    onChange={(e) => setValue(SETTING_KEYS.occupancyDurationMinutes, e.target.value)}
                    className="w-24 rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-bold font-mono text-ink focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-[11px] text-faint">دقيقة</span>
                </div>
              </div>

              {/* Sound alert switch */}
              <div className="pt-2 border-t border-line/60">
                <button
                  type="button"
                  role="switch"
                  aria-checked={soundOn}
                  disabled={!canEdit || submitting}
                  onClick={() => setValue(SETTING_KEYS.soundEnabled, soundOn ? "0" : "1")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border border-line bg-surface/60 px-4 py-3 text-[13px] font-semibold transition-all",
                    canEdit && "hover:border-line-strong"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    {soundOn ? (
                      <Volume2 className="size-4 text-emerald-400" />
                    ) : (
                      <VolumeX className="size-4 text-faint" />
                    )}
                    <span>{t("settings.sound")}</span>
                  </div>
                  <span
                    aria-hidden
                    className={cn(
                      "relative h-6 w-11 rounded-full transition-colors",
                      soundOn ? "bg-neon/70" : "bg-white/10"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                        soundOn ? "start-0.5" : "start-[22px]"
                      )}
                    />
                  </span>
                </button>
              </div>

              {/* Barcode Scanner Advanced Tuning (Prefix / Suffix / Length / Timeout) */}
              <div className="space-y-3 pt-2 border-t border-line/60">
                <p className="text-xs font-bold text-ink">معايرة الرموز والمهلة</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label={t("settings.scannerPrefix")}
                    dir="ltr"
                    value={values[SETTING_KEYS.scannerPrefix] ?? ""}
                    onChange={(e) => setValue(SETTING_KEYS.scannerPrefix, e.target.value)}
                    disabled={!canEdit || submitting}
                  />
                  <Input
                    label={t("settings.scannerSuffix")}
                    dir="ltr"
                    value={values[SETTING_KEYS.scannerSuffix] ?? ""}
                    onChange={(e) => setValue(SETTING_KEYS.scannerSuffix, e.target.value)}
                    disabled={!canEdit || submitting}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-subtle">{t("settings.scannerMinLength")}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {LENGTH_OPTIONS.map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          disabled={!canEdit || submitting}
                          onClick={() => setValue(SETTING_KEYS.scannerMinLength, opt.val)}
                          className={cn(
                            "rounded-lg px-2.5 py-1 text-xs font-bold ring-1 ring-inset transition-all",
                            currentLength === opt.val
                              ? "bg-primary text-white ring-primary shadow-glow-sm"
                              : "bg-surface text-faint ring-line hover:text-subtle"
                          )}
                        >
                          {t(opt.label)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-subtle">{t("settings.scannerTimeout")}</label>
                    <div className="flex flex-wrap gap-1.5">
                      {TIMEOUT_OPTIONS.map((opt) => (
                        <button
                          key={opt.val}
                          type="button"
                          disabled={!canEdit || submitting}
                          onClick={() => setValue(SETTING_KEYS.scannerTimeoutMs, opt.val)}
                          className={cn(
                            "rounded-lg px-2.5 py-1 text-xs font-bold ring-1 ring-inset transition-all",
                            currentTimeout === opt.val
                              ? "bg-primary text-white ring-primary shadow-glow-sm"
                              : "bg-surface text-faint ring-line hover:text-subtle"
                          )}
                        >
                          {t(opt.label)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Live Scanner Sandbox Testing Card */}
        <div className="space-y-4">
          <ScannerTab />
        </div>
      </div>

      {/* Floating Save Bar when dirty */}
      {isDirty && (
        <div className="sticky bottom-4 z-30 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-panel/95 backdrop-blur-md p-4 shadow-glow-md">
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full bg-amber animate-pulse shrink-0" />
            <div>
              <p className="text-xs font-bold text-ink">{t("settings.unsavedChanges")}</p>
              <p className="text-[11px] text-faint">{t("settings.unsavedChangesDesc")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={submitting}
              onClick={handleDiscard}
              className="flex items-center gap-1.5 text-xs font-semibold"
            >
              <RotateCcw className="size-3.5" />
              <span>{t("settings.discardChanges")}</span>
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={submitting}
              disabled={submitting}
              className="flex items-center gap-1.5 text-xs font-bold shadow-glow-sm"
            >
              <Save className="size-3.5" />
              <span>{t("settings.saveAllChanges")}</span>
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

// =========================================================================
// TAB 6: Backups, Security & System Health (النسخ الاحتياطي، الأمان، وصحة النظام)
// =========================================================================
function BackupsAndSecurityTabContent() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <BackupSettingsCard />
        <ChangePasswordCard />
      </div>
      <HealthTab />
    </div>
  );
}

function BackupSettingsCard() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canEdit = hasPermission("settings.edit");

  const [values, setValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
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
  const [saving, setSaving] = useState(false);

  const refreshEncryption = () => {
    api.backup
      .securityStatus()
      .then((s) =>
        setEncryption({
          encryptEnabled: s.encryptEnabled,
          passwordSet: s.passwordSet,
          keyExists: s.keyExists,
          source: s.source,
        })
      )
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    let alive = true;
    Promise.all([api.settings.readAll(), api.backup.securityStatus()])
      .then(([all, status]) => {
        if (!alive) return;
        const loaded: Record<string, string> = {
          [SETTING_KEYS.backupAutoIntervalHours]: all[SETTING_KEYS.backupAutoIntervalHours] ?? "24",
          [SETTING_KEYS.backupRetentionCount]: all[SETTING_KEYS.backupRetentionCount] ?? "10",
          [SETTING_KEYS.backupLocation]: all[SETTING_KEYS.backupLocation] ?? "",
        };
        setValues(loaded);
        setInitialValues(loaded);
        setAutoEnabled((all[SETTING_KEYS.backupAutoEnabled] ?? "1") === "1");
        setEncryption({
          encryptEnabled: status.encryptEnabled,
          passwordSet: status.passwordSet,
          keyExists: status.keyExists,
          source: status.source,
        });
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

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
    if (!canEdit) return;
    setAutoEnabled(enabled);
    try {
      await api.settings.update(SETTING_KEYS.backupAutoEnabled, enabled ? "1" : "0");
      toast("success", t("settings.savedToast"));
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      for (const [key, val] of Object.entries(values)) {
        if (val !== initialValues[key]) {
          await api.settings.update(key, val);
        }
      }
      setInitialValues({ ...values });
      toast("success", t("settings.savedToast"));
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSaving(false);
    }
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
    <Card>
      <CardHeader
        title={
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">{t("settings.backupTab")}</h3>
              <p className="text-[11px] text-subtle mt-0.5">الجدولة التلقائية، سياسة الاحتفاظ، وتشفير البيانات</p>
            </div>
          </div>
        }
      />

      <form onSubmit={handleSave} noValidate className="p-5 space-y-4">
        {/* Auto backup switch */}
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface/50 p-3.5">
          <div>
            <span className="text-[13px] font-semibold text-ink">{t("settings.autoEnabled")}</span>
            <p className="text-[11px] text-faint mt-0.5">{t("settings.autoEnabledHint")}</p>
          </div>
          <button
            type="button"
            aria-pressed={autoEnabled}
            disabled={!canEdit}
            onClick={() => void toggleAuto(!autoEnabled)}
            className="relative h-6 w-11 rounded-full transition-colors bg-white/10 aria-pressed:bg-primary/80"
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                autoEnabled ? "start-0.5" : "start-[22px]"
              )}
            />
          </button>
        </div>

        {/* Auto interval */}
        <div className="space-y-1.5">
          <label className="block text-[13px] font-semibold text-subtle">{t("settings.autoInterval")}</label>
          <div className="flex flex-wrap gap-1.5">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.val}
                type="button"
                disabled={!canEdit || saving}
                onClick={() => setValue(SETTING_KEYS.backupAutoIntervalHours, opt.val)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                  currentInterval === opt.val
                    ? "bg-primary text-white ring-primary shadow-glow-sm"
                    : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                )}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Retention count */}
        <div className="space-y-1.5">
          <label className="block text-[13px] font-semibold text-subtle">{t("settings.retention")}</label>
          <div className="flex flex-wrap gap-1.5">
            {RETENTION_OPTIONS.map((opt) => (
              <button
                key={opt.val}
                type="button"
                disabled={!canEdit || saving}
                onClick={() => setValue(SETTING_KEYS.backupRetentionCount, opt.val)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition-all active:scale-[0.98]",
                  currentRetention === opt.val
                    ? "bg-primary text-white ring-primary shadow-glow-sm"
                    : "bg-surface text-faint ring-line hover:text-subtle hover:bg-raised"
                )}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Backup Location */}
        <div>
          <Input
            label={t("settings.backupLocationLabel")}
            dir="ltr"
            value={values[SETTING_KEYS.backupLocation] ?? ""}
            onChange={(e) => setValue(SETTING_KEYS.backupLocation, e.target.value)}
            disabled={!canEdit || saving}
            placeholder="اتركه فارغاً لاستخدام المجلد الافتراضي %LOCALAPPDATA%\GymGate\Backups"
          />
          <p className="mt-1 text-[11px] text-faint">{t("settings.backupLocationHint")}</p>
        </div>

        {canEdit && (
          <div className="pt-1">
            <Button type="submit" size="sm" loading={saving} disabled={saving}>
              <Save className="size-3.5" />
              <span>{t("common.save")}</span>
            </Button>
          </div>
        )}

        {/* Encryption Section */}
        <div className="rounded-2xl border border-line bg-surface/60 p-4 mt-4 space-y-2">
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-primary" aria-hidden />
            <p className="text-[13px] font-bold text-ink">{t("settings.encryptionTitle")}</p>
          </div>
          <p className="text-[11px] text-faint">{t("settings.encryptionEnabledHint")}</p>
          {encryption?.encryptEnabled ? (
            <p className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded inline-block">
              {t("settings.encryptionEnabledNote")}
            </p>
          ) : (
            <p className="text-xs text-faint bg-surface px-2 py-1 rounded inline-block border border-line">
              {t("settings.encryptionDisabledNote")}
            </p>
          )}

          {canEdit && (
            <div className="pt-2 space-y-2">
              {!encryption?.encryptEnabled ? (
                <>
                  <Input
                    type="password"
                    dir="ltr"
                    placeholder={t("settings.encryptionPasswordPlaceholder")}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <Button
                    size="sm"
                    onClick={() => void enableEncryption()}
                    loading={busy}
                    disabled={busy || newPassword.length < 8}
                    className="text-xs"
                  >
                    <Lock className="size-3.5" />
                    <span>{t("settings.encryptionSetBtn")}</span>
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
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void disableEncryption()}
                      loading={busy}
                      disabled={busy}
                      className="text-xs"
                    >
                      {t("settings.encryptionClearBtn")}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </form>
    </Card>
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
      <CardHeader
        title={
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-neon/10 text-neon border border-neon/20">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">{t("settings.securityTab")}</h3>
              <p className="text-[11px] text-subtle mt-0.5">{t("settings.changePassword")}</p>
            </div>
          </div>
        }
      />
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
        <Button type="submit" loading={submitting} disabled={submitting} size="sm">
          <KeyRound className="size-3.5" />
          <span>{t("settings.changePassword")}</span>
        </Button>
      </form>
    </Card>
  );
}