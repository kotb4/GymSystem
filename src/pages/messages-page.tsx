import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  History,
  MessageSquare,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import {
  api,
  type MessageRecipient,
  type MessageSegment,
  type PublicMessageRow,
} from "@/api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_BIRTHDAY_TEMPLATE,
  DEFAULT_ABSENT_TEMPLATE,
  DEFAULT_EXPIRY_TEMPLATE,
  DEFAULT_WELCOME_TEMPLATE,
  DEFAULT_PAYMENT_TEMPLATE,
} from "@/core/services/settings.service";
import { buildWhatsAppDirectUrl, fillMessagePlaceholders } from "@/core/whatsapp";

const BirthdayTemplateDefault = DEFAULT_BIRTHDAY_TEMPLATE;
const AbsentTemplateDefault = DEFAULT_ABSENT_TEMPLATE;
const ExpiryTemplateDefault = DEFAULT_EXPIRY_TEMPLATE;
const WelcomeTemplateDefault = DEFAULT_WELCOME_TEMPLATE;
const PaymentTemplateDefault = DEFAULT_PAYMENT_TEMPLATE;

const SEGMENTS: MessageSegment[] = ["absent", "birthday", "expiry"];

const TAB_KEY: Record<MessageSegment, string> = {
  absent: "messages.tabAbsent",
  birthday: "messages.tabBirthday",
  expiry: "messages.tabExpiry",
  welcome: "messages.tabWelcome",
  payment: "messages.tabPayment",
  custom: "messages.tabCustom",
};

const EMPTY_KEY: Record<MessageSegment, string> = {
  absent: "messages.emptyAbsent",
  birthday: "messages.emptyBirthday",
  expiry: "messages.emptyExpiry",
  welcome: "messages.emptyAbsent",
  payment: "messages.emptyAbsent",
  custom: "messages.emptyAbsent",
};

const PLACEHOLDERS = [
  { tag: "{اسم العميل}", desc: "اسم العضو بالكامل" },
  { tag: "{رقم العضوية}", desc: "كود العضوية" },
  { tag: "{اسم الجيم}", desc: "اسم الصالة" },
  { tag: "{اسم الخطة}", desc: "باقة الاشتراك" },
  { tag: "{تاريخ الانتهاء}", desc: "تاريخ نهاية الاشتراك" },
  { tag: "{الأيام المتبقية}", desc: "الأيام المتبقية للتجديد" },
  { tag: "{المبلغ}", desc: "المبلغ المدفوع" },
  { tag: "{المبلغ المتبقي}", desc: "المتبقي المالي إن وجد" },
  { tag: "{عدد أيام الغياب}", desc: "أيام الانقطاع" },
  { tag: "{الحصص المتبقية}", desc: "رصيد الحصص" },
  { tag: "{الخصم}", desc: "قيمة الخصم" },
];

function statusBadge(status: PublicMessageRow["status"]): BadgeVariant {
  switch (status) {
    case "sent":
      return "success";
    case "failed":
      return "danger";
    case "skipped_no_phone":
    case "not_configured":
      return "warning";
    default:
      return "neutral";
  }
}

function statusKey(status: PublicMessageRow["status"]): string {
  switch (status) {
    case "sent":
      return "messages.statusSent";
    case "failed":
      return "messages.statusFailed";
    case "skipped_no_phone":
      return "messages.statusSkippedNoPhone";
    case "not_configured":
      return "messages.statusNotConfigured";
    default:
      return "messages.statusPending";
  }
}

export function MessagesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canSend = hasPermission("messages.send");
  const canEditSettings = hasPermission("settings.edit");

  const [mainTab, setMainTab] = useState<"campaigns" | "templates" | "safety" | "history">("campaigns");
  const [segment, setSegment] = useState<MessageSegment>("absent");
  const [searchQuery, setSearchQuery] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  const [rows, setRows] = useState<MessageRecipient[]>([]);
  const [history, setHistory] = useState<PublicMessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [composeTarget, setComposeTarget] = useState<MessageRecipient | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmSendAll, setConfirmSendAll] = useState(false);
  const [batchSending, setBatchSending] = useState(false);

  const [absentDays, setAbsentDays] = useState("14");
  const [birthdayDays, setBirthdayDays] = useState("7");
  const [birthdayTemplate, setBirthdayTemplate] = useState(() => BirthdayTemplateDefault);
  const [absentTemplate, setAbsentTemplate] = useState(() => AbsentTemplateDefault);
  const [expiryTemplate, setExpiryTemplate] = useState(() => ExpiryTemplateDefault);
  const [expiryDays, setExpiryDays] = useState("7");
  const [welcomeTemplate, setWelcomeTemplate] = useState(() => WelcomeTemplateDefault);
  const [paymentTemplate, setPaymentTemplate] = useState(() => PaymentTemplateDefault);
  const [pacingMin, setPacingMin] = useState("8");
  const [pacingMax, setPacingMax] = useState("15");
  const [cooldownDays, setCooldownDays] = useState("7");
  const [composeDiscount, setComposeDiscount] = useState("");
  const [composeTemplate, setComposeTemplate] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const composeTextareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.messages.getConfig();
      setAbsentDays(String(cfg.absentDays));
      setBirthdayDays(String(cfg.birthdayDays));
      setBirthdayTemplate(cfg.birthdayTemplate ?? BirthdayTemplateDefault);
      setAbsentTemplate(cfg.absentTemplate ?? AbsentTemplateDefault);
      setExpiryTemplate(cfg.expiryTemplate ?? ExpiryTemplateDefault);
      setExpiryDays(String(cfg.expiryDays));
      setWelcomeTemplate(cfg.welcomeTemplate ?? WelcomeTemplateDefault);
      setPaymentTemplate(cfg.paymentTemplate ?? PaymentTemplateDefault);
      setPacingMin(String(cfg.pacingMinSeconds ?? 8));
      setPacingMax(String(cfg.pacingMaxSeconds ?? 15));
      setCooldownDays(String(cfg.cooldownDays ?? 7));
    } catch {
      // config is best-effort; defaults are shown regardless
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRows = useCallback(async (seg: MessageSegment) => {
    try {
      const items = await api.messages.listRecipients(seg);
      setRows(items);
    } catch (error) {
      toast("error", describeError(error, t));
    }
  }, [toast, t]);

  const loadHistory = useCallback(async () => {
    if (!canSend) return;
    try {
      setHistory(await api.messages.listHistory(100));
    } catch {
      // history is informational; silent failure
    }
  }, [canSend]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setRows([]);
    setLoading(true);
    void loadRows(segment).finally(() => setLoading(false));
  }, [segment, loadRows]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const visible = rows;

  const filteredRecipients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (r) =>
        r.memberName.toLowerCase().includes(q) ||
        r.memberCode.toLowerCase().includes(q) ||
        (r.phone && r.phone.includes(q))
    );
  }, [visible, searchQuery]);

  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        (h.member_name && h.member_name.toLowerCase().includes(q)) ||
        (h.member_code && h.member_code.toLowerCase().includes(q)) ||
        h.body.toLowerCase().includes(q)
    );
  }, [history, historySearch]);

  const fillComposeBody = (tmpl: string, target: MessageRecipient, discount: string) =>
    fillMessagePlaceholders(tmpl, {
      memberName: target.memberName,
      memberCode: target.memberCode,
      daysSinceLastVisit: target.daysSinceLastVisit,
      endDate: target.subscriptionEndKey,
      daysUntilExpiry: target.daysUntilExpiry,
      discount,
    });

  const onComposeDiscountChange = (value: string) => {
    setComposeDiscount(value);
    if (composeTemplate && composeTarget) {
      setBody(fillComposeBody(composeTemplate, composeTarget, value));
    }
  };

  const openCompose = (target: MessageRecipient) => {
    setComposeTarget(target);
    const tmpl =
      target.segment === "birthday"
        ? birthdayTemplate
        : target.segment === "absent"
          ? absentTemplate
          : expiryTemplate;

    setComposeTemplate(tmpl ?? null);
    if (tmpl) {
      setBody(fillComposeBody(tmpl, target, composeDiscount));
    } else {
      setBody("");
    }
  };

  const handleSend = async () => {
    if (!composeTarget) return;
    if (!body.trim()) {
      toast("error", t("errors.messageBodyRequired"));
      return;
    }
    setSending(true);
    try {
      const result = await api.messages.send({
        memberId: composeTarget.memberId,
        segment: composeTarget.segment,
        body,
      });
      if (result.status === "sent") {
        toast("success", t("messages.msgSent"));
      } else if (result.status === "skipped_no_phone") {
        toast("error", t("messages.msgNoPhone"));
      } else if (result.status === "not_configured") {
        toast("error", t("messages.msgNotConfigured"));
      } else {
        toast("error", t("messages.statusFailed"));
      }
      setComposeTarget(null);
      await loadRows(segment);
      await loadHistory();
    } catch (error) {
      toast("error", describeError(error, t));
    } finally {
      setSending(false);
    }
  };

  const handleSendAll = async () => {
    setBatchSending(true);
    try {
      const currentTemplate =
        body.trim() ||
        (segment === "birthday"
          ? birthdayTemplate
          : segment === "absent"
            ? absentTemplate
            : expiryTemplate);

      const res = await api.messages.sendSegment({
        segment,
        body: currentTemplate,
      });
      toast("success", t("messages.msgBatchSent", {
        sent: res.sent,
        failed: res.failed,
        noPhone: res.skippedNoPhone,
        cooldown: res.skippedCooldown,
        notConfig: res.notConfigured,
      }));
      setConfirmSendAll(false);
      setComposeTarget(null);
      await loadRows(segment);
      await loadHistory();
    } catch (error) {
      toast("error", describeError(error, t));
    } finally {
      setBatchSending(false);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      await Promise.all([
        api.settings.update("messages_absent_days", absentDays.trim()),
        api.settings.update("messages_absent_template", absentTemplate.trim()),
        api.settings.update("messages_birthday_days", birthdayDays.trim()),
        api.settings.update("messages_birthday_template", birthdayTemplate.trim()),
        api.settings.update("messages_expiry_days", expiryDays.trim()),
        api.settings.update("messages_expiry_template", expiryTemplate.trim()),
        api.settings.update("messages_welcome_template", welcomeTemplate.trim()),
        api.settings.update("messages_payment_template", paymentTemplate.trim()),
        api.settings.update("messages_pacing_min_seconds", pacingMin.trim()),
        api.settings.update("messages_pacing_max_seconds", pacingMax.trim()),
        api.settings.update("messages_cooldown_days", cooldownDays.trim()),
      ]);
      toast("success", t("messages.configSaved"));
      await loadRows(segment);
    } catch (error) {
      toast("error", describeError(error, t));
    } finally {
      setSavingConfig(false);
    }
  };

  const copyPlaceholder = (tag: string) => {
    void navigator.clipboard.writeText(tag);
    toast("success", `${t("messages.variableCopied")}: ${tag}`);
  };

  const insertPlaceholderInCompose = (tag: string) => {
    if (composeTextareaRef.current) {
      const el = composeTextareaRef.current;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = body.substring(0, start) + tag + body.substring(end);
      setBody(next);
      window.setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      }, 0);
    } else {
      setBody((prev) => prev + " " + tag);
    }
  };

  const detailText = (r: MessageRecipient): string => {
    if (r.segment === "absent") {
      return r.lastVisitAt && r.daysSinceLastVisit > 0
        ? t("messages.detailAbsent", { days: r.daysSinceLastVisit })
        : t("messages.detailAbsentNoVisit");
    }
    if (r.segment === "birthday") {
      return r.daysUntilBirthday === 0
        ? t("messages.detailBirthdayToday")
        : t("messages.detailBirthday", { days: r.daysUntilBirthday ?? 0 });
    }
    return t("messages.detailExpiry", { days: r.daysUntilExpiry ?? 0 });
  };

  const cols: Column<MessageRecipient>[] = [
    {
      key: "member",
      header: t("messages.labelMember"),
      render: (r) => (
        <div>
          <span className="font-semibold text-ink">{r.memberName}</span>
          <span dir="ltr" className="mt-0.5 block text-xs text-faint tabnum">{r.memberCode}</span>
        </div>
      ),
    },
    {
      key: "phone",
      header: t("messages.labelPhone"),
      render: (r) =>
        r.phone ? (
          <span dir="ltr" className="tabnum font-mono text-[13px] text-subtle">{r.phone}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      key: "detail",
      header: t("messages.labelDetail"),
      render: (r) => (
        <Badge variant={segment === "birthday" ? "warning" : segment === "absent" ? "danger" : "info"}>
          {detailText(r)}
        </Badge>
      ),
    },
    {
      key: "extra",
      header: segment === "absent" ? t("messages.lastNameColumn") : t("messages.labelEndDate"),
      render: (r) =>
        r.segment === "absent" ? (
          <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.lastVisitAt?.slice(0, 16) ?? "—"}</span>
        ) : (
          <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.subscriptionEndKey ?? "—"}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) =>
        canSend ? (
          <Button size="sm" variant="secondary" onClick={() => openCompose(r)}>
            <Send className="size-3.5" />
            {t("messages.btnSend")}
          </Button>
        ) : null,
    },
  ];

  const mainTabs = [
    { value: "campaigns", label: t("messages.mainTabCampaigns") },
    ...(canEditSettings ? [{ value: "templates", label: t("messages.mainTabTemplates") }] : []),
    ...(canEditSettings ? [{ value: "safety", label: t("messages.mainTabSafety") }] : []),
    ...(canSend ? [{ value: "history", label: t("messages.mainTabHistory") }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Top Header & Main Tabs */}
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2.5">
              <div className="grid size-9 place-items-center rounded-xl bg-neon/10 text-neon">
                <MessageSquare className="size-5" />
              </div>
              <div>
                <h1 className="text-lg font-extrabold text-ink">{t("messages.pageTitle")}</h1>
                <p className="text-xs text-subtle">{t("messages.emptyDescription")}</p>
              </div>
            </div>
          }
        />
        <div className="px-5 pb-1 pt-2">
          <Tabs items={mainTabs} value={mainTab} onChange={(v) => setMainTab(v as typeof mainTab)} />
        </div>
      </Card>

      {/* ────────────────── Tab 1: Campaigns & Recipients ────────────────── */}
      {mainTab === "campaigns" && (
        <Card>
          <CardBody className="space-y-4">
            {/* Segment Selector Pills */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
              <div className="flex flex-wrap gap-2">
                {SEGMENTS.map((s) => {
                  const active = segment === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSegment(s)}
                      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${
                        active
                          ? "border-neon bg-neon/10 text-neon"
                          : "border-line bg-panel text-subtle hover:border-line-strong hover:text-ink"
                      }`}
                    >
                      <span>{t(TAB_KEY[s])}</span>
                      {active && (
                        <Badge variant="neutral" className="tabnum font-mono text-xs">
                          {rows.length}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>

              {canSend && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setBody("");
                    setConfirmSendAll(true);
                  }}
                  disabled={visible.length === 0 || batchSending}
                  icon={<Send className="size-4" />}
                >
                  {t("messages.btnSendAll")} ({visible.length})
                </Button>
              )}
            </div>

            {/* Filter / Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="w-full sm:max-w-xs">
                <Input
                  placeholder={t("messages.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <span className="text-xs text-faint tabnum">
                {filteredRecipients.length} / {visible.length}
              </span>
            </div>

            {/* Recipients Table */}
            <div>
              {loading ? (
                <div className="grid min-h-48 place-items-center">
                  <span aria-hidden className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-neon" />
                </div>
              ) : filteredRecipients.length === 0 ? (
                <EmptyState
                  icon={<MessageSquare />}
                  title={t(EMPTY_KEY[segment])}
                  description={t("messages.emptyDescription")}
                />
              ) : (
                <DataTable
                  columns={cols}
                  data={filteredRecipients}
                  rowKey={(r) => r.memberId}
                  className="rounded-xl border border-line bg-surface"
                />
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ────────────────── Tab 2: Templates & Cheat Sheet ────────────────── */}
      {mainTab === "templates" && canEditSettings && (
        <div className="space-y-4">
          {/* Smart Placeholders Cheat Sheet */}
          <Card className="border-neon/25 bg-neon/[0.02]">
            <CardBody className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-neon" />
                <h3 className="text-sm font-bold text-ink">{t("messages.placeholdersTitle")}</h3>
              </div>
              <p className="text-xs text-subtle">{t("messages.placeholdersHelp")}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p.tag}
                    type="button"
                    onClick={() => copyPlaceholder(p.tag)}
                    title={p.desc}
                    className="group inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-mono font-semibold text-ink transition-colors hover:border-neon hover:text-neon"
                  >
                    <span>{p.tag}</span>
                    <span className="text-[10px] text-faint group-hover:text-neon/80 font-sans">
                      ({p.desc})
                    </span>
                    <Copy className="size-3 text-faint group-hover:text-neon" />
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Template Cards Grid */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Card 1: Absent Reminder */}
            <Card>
              <CardHeader
                title={
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-amber" />
                    <span>{t("messages.configAbsentTemplate")}</span>
                  </div>
                }
              />
              <CardBody className="space-y-3.5">
                <Input
                  label={t("messages.configAbsentDays")}
                  value={absentDays}
                  onChange={(e) => setAbsentDays(e.target.value)}
                  type="number"
                  min={1}
                  max={365}
                  dir="ltr"
                />
                <div>
                  <div className="flex items-center justify-between pb-1.5">
                    <label className="text-[13px] font-semibold text-subtle">
                      {t("messages.composeBodyLabel")}
                    </label>
                    <span className="text-[11px] text-faint tabnum">
                      {absentTemplate.length} {t("messages.charCount")}
                    </span>
                  </div>
                  <textarea
                    value={absentTemplate}
                    onChange={(e) => setAbsentTemplate(e.target.value)}
                    placeholder={t("messages.configAbsentTemplatePlaceholder")}
                    rows={4}
                    className="w-full rounded-xl border border-line bg-panel p-3.5 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
                  />
                </div>
              </CardBody>
            </Card>

            {/* Card 2: Birthday Greeting */}
            <Card>
              <CardHeader
                title={
                  <div className="flex items-center gap-2">
                    <Calendar className="size-4 text-cyan" />
                    <span>{t("messages.configBirthdayTemplate")}</span>
                  </div>
                }
              />
              <CardBody className="space-y-3.5">
                <Input
                  label={t("messages.configBirthdayDays")}
                  value={birthdayDays}
                  onChange={(e) => setBirthdayDays(e.target.value)}
                  type="number"
                  min={1}
                  max={365}
                  dir="ltr"
                />
                <div>
                  <div className="flex items-center justify-between pb-1.5">
                    <label className="text-[13px] font-semibold text-subtle">
                      {t("messages.composeBodyLabel")}
                    </label>
                    <span className="text-[11px] text-faint tabnum">
                      {birthdayTemplate.length} {t("messages.charCount")}
                    </span>
                  </div>
                  <textarea
                    value={birthdayTemplate}
                    onChange={(e) => setBirthdayTemplate(e.target.value)}
                    placeholder={t("messages.configBirthdayTemplatePlaceholder")}
                    rows={4}
                    className="w-full rounded-xl border border-line bg-panel p-3.5 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
                  />
                </div>
              </CardBody>
            </Card>

            {/* Card 3: Expiry Warning */}
            <Card>
              <CardHeader
                title={
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-red" />
                    <span>{t("messages.configExpiryTemplate")}</span>
                  </div>
                }
              />
              <CardBody className="space-y-3.5">
                <Input
                  label={t("messages.configExpiryDays")}
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  type="number"
                  min={1}
                  max={365}
                  dir="ltr"
                />
                <div>
                  <div className="flex items-center justify-between pb-1.5">
                    <label className="text-[13px] font-semibold text-subtle">
                      {t("messages.composeBodyLabel")}
                    </label>
                    <span className="text-[11px] text-faint tabnum">
                      {expiryTemplate.length} {t("messages.charCount")}
                    </span>
                  </div>
                  <textarea
                    value={expiryTemplate}
                    onChange={(e) => setExpiryTemplate(e.target.value)}
                    placeholder={t("messages.configExpiryTemplatePlaceholder")}
                    rows={4}
                    className="w-full rounded-xl border border-line bg-panel p-3.5 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
                  />
                </div>
              </CardBody>
            </Card>

            {/* Card 4: Welcome New Member */}
            <Card>
              <CardHeader
                title={
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-emerald-400" />
                    <span>{t("messages.configWelcomeTemplate")}</span>
                  </div>
                }
              />
              <CardBody className="space-y-3.5">
                <div>
                  <div className="flex items-center justify-between pb-1.5">
                    <label className="text-[13px] font-semibold text-subtle">
                      {t("messages.composeBodyLabel")}
                    </label>
                    <span className="text-[11px] text-faint tabnum">
                      {welcomeTemplate.length} {t("messages.charCount")}
                    </span>
                  </div>
                  <textarea
                    value={welcomeTemplate}
                    onChange={(e) => setWelcomeTemplate(e.target.value)}
                    placeholder={t("messages.configWelcomeTemplatePlaceholder")}
                    rows={5}
                    className="w-full rounded-xl border border-line bg-panel p-3.5 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
                  />
                </div>
              </CardBody>
            </Card>

            {/* Card 5: Payment Receipt */}
            <Card className="lg:col-span-2">
              <CardHeader
                title={
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-neon" />
                    <span>{t("messages.configPaymentTemplate")}</span>
                  </div>
                }
              />
              <CardBody className="space-y-3.5">
                <div>
                  <div className="flex items-center justify-between pb-1.5">
                    <label className="text-[13px] font-semibold text-subtle">
                      {t("messages.composeBodyLabel")}
                    </label>
                    <span className="text-[11px] text-faint tabnum">
                      {paymentTemplate.length} {t("messages.charCount")}
                    </span>
                  </div>
                  <textarea
                    value={paymentTemplate}
                    onChange={(e) => setPaymentTemplate(e.target.value)}
                    placeholder={t("messages.configPaymentTemplatePlaceholder")}
                    rows={4}
                    className="w-full rounded-xl border border-line bg-panel p-3.5 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
                  />
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Save Bar */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveConfig}
              loading={savingConfig}
              icon={<Settings2 className="size-4" />}
              size="lg"
            >
              {t("messages.configSave")}
            </Button>
          </div>
        </div>
      )}

      {/* ────────────────── Tab 3: Safety & Anti-Ban Engine ────────────────── */}
      {mainTab === "safety" && canEditSettings && (
        <Card>
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-400" />
                <span>{t("messages.safetyCardTitle")}</span>
              </div>
            }
            description={t("messages.safetyCardDesc")}
          />
          <CardBody className="space-y-6">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <Input
                label={t("messages.configPacingMin")}
                value={pacingMin}
                onChange={(e) => setPacingMin(e.target.value)}
                type="number"
                min={2}
                max={60}
                dir="ltr"
              />
              <Input
                label={t("messages.configPacingMax")}
                value={pacingMax}
                onChange={(e) => setPacingMax(e.target.value)}
                type="number"
                min={3}
                max={120}
                dir="ltr"
              />
              <Input
                label={t("messages.configCooldownDays")}
                value={cooldownDays}
                onChange={(e) => setCooldownDays(e.target.value)}
                type="number"
                min={0}
                max={90}
                dir="ltr"
              />
            </div>

            <div className="flex justify-end border-t border-line pt-4">
              <Button
                onClick={handleSaveConfig}
                loading={savingConfig}
                icon={<Settings2 className="size-4" />}
              >
                {t("messages.configSave")}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ────────────────── Tab 4: History Log ────────────────── */}
      {mainTab === "history" && canSend && (
        <Card>
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <History className="size-5 text-neon" />
                <span>{t("messages.historyTitle")}</span>
              </div>
            }
            action={
              <div className="w-56">
                <Input
                  placeholder={t("messages.searchPlaceholder")}
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                />
              </div>
            }
          />
          <CardBody>
            {filteredHistory.length === 0 ? (
              <p className="py-10 text-center text-sm text-subtle">{t("messages.historyEmpty")}</p>
            ) : (
              <DataTable
                columns={[
                  {
                    key: "member",
                    header: t("messages.labelMember"),
                    render: (r) => (
                      <div>
                        <span className="font-semibold text-ink">{r.member_name}</span>
                        <span dir="ltr" className="mt-0.5 block text-xs text-faint tabnum">{r.member_code}</span>
                      </div>
                    ),
                  },
                  {
                    key: "body",
                    header: t("messages.composeBodyLabel"),
                    render: (r) => <span className="line-clamp-2 max-w-sm text-[13px] text-subtle">{r.body}</span>,
                  },
                  {
                    key: "status",
                    header: t("messages.colStatus"),
                    render: (r) => <Badge variant={statusBadge(r.status)}>{t(statusKey(r.status))}</Badge>,
                  },
                  {
                    key: "date",
                    header: t("messages.colDate"),
                    render: (r) => <span dir="ltr" className="tabnum text-[13px] text-subtle">{r.created_at}</span>,
                  },
                ]}
                data={filteredHistory}
                rowKey={(r) => r.id}
                className="rounded-xl border border-line bg-surface"
              />
            )}
          </CardBody>
        </Card>
      )}

      {/* ────────────────── Compose Modal ────────────────── */}
      <Modal
        open={!!composeTarget}
        onClose={() => setComposeTarget(null)}
        title={t("messages.composeTitle")}
        widthClass="max-w-lg"
      >
        {composeTarget && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-line bg-panel p-3">
              <div>
                <p className="text-sm font-bold text-ink">{composeTarget.memberName}</p>
                <p dir="ltr" className="tabnum text-xs text-faint">{composeTarget.memberCode}</p>
              </div>
              <span dir="ltr" className="font-mono text-xs font-semibold text-subtle">
                {composeTarget.phone ?? "—"}
              </span>
            </div>

            <Input
              label={t("messages.composeDiscountLabel")}
              value={composeDiscount}
              onChange={(e) => onComposeDiscountChange(e.target.value)}
              placeholder={t("messages.composeDiscountPlaceholder")}
              dir="ltr"
            />

            <div>
              <div className="flex items-center justify-between pb-1.5">
                <label className="text-[13px] font-semibold text-subtle">
                  {t("messages.composeBodyLabel")}
                </label>
                <span className="text-[11px] text-faint tabnum">
                  {body.length} {t("messages.charCount")}
                </span>
              </div>

              {/* Clickable placeholder tags toolbar */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {PLACEHOLDERS.slice(0, 6).map((p) => (
                  <button
                    key={p.tag}
                    type="button"
                    onClick={() => insertPlaceholderInCompose(p.tag)}
                    className="rounded border border-line bg-panel px-2 py-0.5 text-[11px] font-mono text-subtle hover:border-neon hover:text-neon"
                    title={p.desc}
                  >
                    {p.tag}
                  </button>
                ))}
              </div>

              <textarea
                ref={composeTextareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("messages.composeBodyPlaceholder")}
                rows={5}
                className="w-full rounded-xl border border-line bg-panel p-3.5 text-sm text-ink placeholder:text-faint outline-none transition-colors duration-150 focus:border-neon/60 focus:ring-2 focus:ring-neon/15"
              />
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Button onClick={handleSend} loading={sending} disabled={sending}>
              <Send className="size-4" />
              {t("messages.btnSend")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (!composeTarget?.phone) return;
                const url = buildWhatsAppDirectUrl(composeTarget.phone, body);
                if (url) window.open(url, "_blank", "noopener,noreferrer");
              }}
              disabled={!composeTarget?.phone || sending}
              icon={<ExternalLink className="size-4" />}
            >
              {t("messages.btnOpenDirect")}
            </Button>
          </div>
          <Button variant="secondary" onClick={() => setComposeTarget(null)} disabled={sending}>
            {t("common.cancel")}
          </Button>
        </div>
      </Modal>

      {/* Confirm Send All Dialog */}
      <ConfirmDialog
        open={confirmSendAll}
        onClose={() => setConfirmSendAll(false)}
        onConfirm={handleSendAll}
        loading={batchSending}
        tone="primary"
        title={t("messages.btnSendAll")}
        message={t("messages.confirmSendAll", { count: visible.length })}
        confirmLabel={t("messages.btnSendAll")}
      />
    </div>
  );
}
