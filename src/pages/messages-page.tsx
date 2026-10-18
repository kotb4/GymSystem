import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Calendar,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  History,
  MessageSquare,
  QrCode,
  RotateCw,
  Send,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Check,
  Bot,
  LogOut,
} from "lucide-react";
import { downloadCsvWithBom } from "@/utils/csv-helper";
import { todayKey, parseDateKey } from "@/core/dates";
import { useAuth } from "@/contexts/auth-context";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { cn } from "@/utils/cn";
import {
  api,
  type MessageRecipient,
  type MessageSegment,
  type PublicMessageRow,
  type Lead,
  type PublicMember,
} from "@/api";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { formatTime, formatDateShort } from "@/services/format";
import {
  DEFAULT_BIRTHDAY_TEMPLATE,
  DEFAULT_ABSENT_TEMPLATE,
  DEFAULT_EXPIRY_TEMPLATE,
  DEFAULT_WELCOME_TEMPLATE,
  DEFAULT_PAYMENT_TEMPLATE,
} from "@/core/services/settings.service";
import { buildWhatsAppDirectUrl, fillMessagePlaceholders } from "@/core/whatsapp";
import { WhatsAppPairModal } from "@/components/settings/whatsapp-pair-modal";
import { WhatsAppBotManagerTab } from "@/components/messages/whatsapp-bot-manager-tab";

const DEFAULT_LEADS_TEMPLATE =
  "أهلاً بك يا كابتن {اسم العميل} في {اسم الجيم}! 🏋️‍♂️✨\nيسعدنا دعوتك لتجربة تدريب مجانية والتعرف على باقاتنا وعروضنا الخاصة هذا الأسبوع. يشرفنا زيارتك في أي وقت!";

const PLACEHOLDERS = [
  { tag: "{اسم العميل}", desc: "اسم العضو أو العميل" },
  { tag: "{رقم العضوية}", desc: "كود العضوية" },
  { tag: "{اسم الجيم}", desc: "اسم الصالة الرياضية" },
  { tag: "{اسم الخطة}", desc: "باقة الاشتراك" },
  { tag: "{تاريخ الانتهاء}", desc: "تاريخ نهاية الاشتراك" },
  { tag: "{الأيام المتبقية}", desc: "الأيام المتبقية في الاشتراك" },
  { tag: "{المبلغ}", desc: "المبلغ المدفوع" },
  { tag: "{المبلغ المتبقي}", desc: "المبلغ المتبقي" },
  { tag: "{عدد أيام الغياب}", desc: "أيام الانقطاع عن التمرين" },
  { tag: "{الخصم}", desc: "قيمة أو نسبة الخصم" },
  { tag: "{رابط البوابة}", desc: "رابط الحساب والكارنيه الرقمي" },
];

export type OperationsTab =
  | "leads"
  | "absent"
  | "expired"
  | "birthday"
  | "templates"
  | "bot"
  | "history"
  | "safety";

export function MessagesPage() {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const canSend = hasPermission("messages.send");
  const canEditSettings = hasPermission("settings.edit");

  const tabParam = searchParams.get("tab") as OperationsTab | null;
  const initialTab =
    tabParam &&
    ["leads", "absent", "expired", "birthday", "templates", "bot", "history", "safety"].includes(tabParam)
      ? tabParam
      : "leads";
  const [activeTab, setActiveTab] = useState<OperationsTab>(initialTab);

  useEffect(() => {
    const tab = searchParams.get("tab") as OperationsTab | null;
    if (
      tab &&
      ["leads", "absent", "expired", "birthday", "templates", "bot", "history", "safety"].includes(tab)
    ) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Gateway & Connection States
  const [gatewayRunning, setGatewayRunning] = useState<boolean>(false);
  const [gatewayPaired, setGatewayPaired] = useState<boolean>(false);
  const [checkingGateway, setCheckingGateway] = useState<boolean>(false);
  const [pairModalOpen, setPairModalOpen] = useState<boolean>(false);

  // Targeted Recipient Data
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsSearch, setLeadsSearch] = useState("");

  const [absentRecipients, setAbsentRecipients] = useState<MessageRecipient[]>([]);
  const [absentSearch, setAbsentSearch] = useState("");

  const [expiryRecipients, setExpiryRecipients] = useState<MessageRecipient[]>([]);
  const [expiredMembers, setExpiredMembers] = useState<PublicMember[]>([]);
  const [expiredFilter, setExpiredFilter] = useState<"expiring_soon" | "already_expired">("expiring_soon");
  const [expiredSearch, setExpiredSearch] = useState("");

  const [birthdayRecipients, setBirthdayRecipients] = useState<MessageRecipient[]>([]);
  const [birthdaySearch, setBirthdaySearch] = useState("");

  const [history, setHistory] = useState<PublicMessageRow[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "failed" | "card" | "campaign" | "bot">("all");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Default Templates
  const [leadsTemplate, setLeadsTemplate] = useState(DEFAULT_LEADS_TEMPLATE);
  const [absentTemplate, setAbsentTemplate] = useState(DEFAULT_ABSENT_TEMPLATE);
  const [expiryTemplate, setExpiryTemplate] = useState(DEFAULT_EXPIRY_TEMPLATE);
  const [birthdayTemplate, setBirthdayTemplate] = useState(DEFAULT_BIRTHDAY_TEMPLATE);
  const [welcomeTemplate, setWelcomeTemplate] = useState(DEFAULT_WELCOME_TEMPLATE);
  const [paymentTemplate, setPaymentTemplate] = useState(DEFAULT_PAYMENT_TEMPLATE);

  // Config parameters
  const [absentDays, setAbsentDays] = useState("14");
  const [birthdayDays, setBirthdayDays] = useState("7");
  const [expiryDays, setExpiryDays] = useState("7");
  const [pacingMin, setPacingMin] = useState("15");
  const [pacingMax, setPacingMax] = useState("35");
  const [cooldownDays, setCooldownDays] = useState("7");
  const [savingConfig, setSavingConfig] = useState(false);
  const [gymName, setGymName] = useState("GymGate");

  // Compose Modal State (Single Outreach)
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeRecipient, setComposeRecipient] = useState<{
    id?: string;
    name: string;
    phone: string | null;
    code?: string;
    segment: MessageSegment;
    details?: string;
  } | null>(null);
  const [composeBody, setComposeBody] = useState("");
  const [sendingSingle, setSendingSingle] = useState(false);

  // Batch Send State
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchSegment, setBatchSegment] = useState<MessageSegment | "leads">("leads");
  const [batchSending, setBatchSending] = useState(false);

  // Check Gateway Health
  const checkGateway = useCallback(async () => {
    setCheckingGateway(true);
    try {
      const h = await api.gateway.health("http://127.0.0.1:8891");
      setGatewayRunning(Boolean(h && h.ok));
      setGatewayPaired(Boolean(h && h.paired));
    } catch {
      setGatewayRunning(false);
      setGatewayPaired(false);
    } finally {
      setCheckingGateway(false);
    }
  }, []);

  const [disconnectingGateway, setDisconnectingGateway] = useState<boolean>(false);

  const handleDisconnectGateway = async () => {
    if (!window.confirm(t("settings.whatsappDisconnectConfirm"))) return;
    setDisconnectingGateway(true);
    try {
      await api.gateway.disconnect("http://127.0.0.1:8891");
      toast("success", t("settings.whatsappDisconnectedToast"));
      await checkGateway();
    } catch {
      try {
        await api.system.disconnectWhatsApp();
        toast("success", t("settings.whatsappDisconnectedToast"));
        await checkGateway();
      } catch (err) {
        toast("error", describeError(err, t));
      }
    } finally {
      setDisconnectingGateway(false);
    }
  };

  // Load Templates & Config
  const loadConfig = useCallback(async () => {
    try {
      const [cfg, settings] = await Promise.all([
        api.messages.getConfig(),
        api.settings.readAll().catch(() => ({} as Record<string, string>)),
      ]);
      if (settings?.gym_name) {
        setGymName(settings.gym_name);
      }
      setAbsentDays(String(cfg.absentDays));
      setBirthdayDays(String(cfg.birthdayDays));
      setExpiryDays(String(cfg.expiryDays));
      setAbsentTemplate(cfg.absentTemplate || DEFAULT_ABSENT_TEMPLATE);
      setExpiryTemplate(cfg.expiryTemplate || DEFAULT_EXPIRY_TEMPLATE);
      setBirthdayTemplate(cfg.birthdayTemplate || DEFAULT_BIRTHDAY_TEMPLATE);
      setWelcomeTemplate(cfg.welcomeTemplate || DEFAULT_WELCOME_TEMPLATE);
      setPaymentTemplate(cfg.paymentTemplate || DEFAULT_PAYMENT_TEMPLATE);
      setPacingMin(String(cfg.pacingMinSeconds ?? 15));
      setPacingMax(String(cfg.pacingMaxSeconds ?? 35));
      setCooldownDays(String(cfg.cooldownDays ?? 7));
    } catch {
      // defaults stay
    }
  }, []);

  // Load Leads
  const loadLeads = useCallback(async () => {
    try {
      const res = await api.lead.list({ pageSize: 150 });
      setLeads(res.items || []);
    } catch {
      setLeads([]);
    }
  }, []);

  // Load Absent Members
  const loadAbsent = useCallback(async () => {
    try {
      const res = await api.messages.listRecipients("absent");
      setAbsentRecipients(res);
    } catch {
      setAbsentRecipients([]);
    }
  }, []);

  // Load Expired / Expiring Members
  const loadExpired = useCallback(async () => {
    try {
      const [expiring, expired] = await Promise.all([
        api.messages.listRecipients("expiry"),
        api.members.list({ smart: "expired", pageSize: 150 }),
      ]);
      setExpiryRecipients(expiring);
      setExpiredMembers(expired.items || []);
    } catch {
      setExpiryRecipients([]);
      setExpiredMembers([]);
    }
  }, []);

  // Load Birthdays
  const loadBirthdays = useCallback(async () => {
    try {
      const res = await api.messages.listRecipients("birthday");
      setBirthdayRecipients(res);
    } catch {
      setBirthdayRecipients([]);
    }
  }, []);

  // Load History
  const loadHistory = useCallback(async () => {
    if (!canSend) return;
    try {
      const list = await api.messages.listHistory(150);
      setHistory(list);
    } catch {
      setHistory([]);
    }
  }, [canSend]);

  useEffect(() => {
    void checkGateway();
    void loadConfig();
    void loadLeads();
    void loadAbsent();
    void loadExpired();
    void loadBirthdays();
    void loadHistory();
  }, [checkGateway, loadConfig, loadLeads, loadAbsent, loadExpired, loadBirthdays, loadHistory]);

  // Open Single Compose Modal
  const openSingleCompose = (
    item: {
      id?: string;
      name: string;
      phone: string | null;
      code?: string;
      daysSinceLastVisit?: number;
      endDate?: string | null;
      daysUntilExpiry?: number | null;
    },
    segment: MessageSegment | "leads"
  ) => {
    let rawTmpl = leadsTemplate;
    if (segment === "absent") rawTmpl = absentTemplate;
    else if (segment === "expiry") rawTmpl = expiryTemplate;
    else if (segment === "birthday") rawTmpl = birthdayTemplate;

    const populated = fillMessagePlaceholders(rawTmpl, {
      memberName: item.name,
      memberCode: item.code ?? "",
      gymName: gymName || "GymGate",
      daysSinceLastVisit: item.daysSinceLastVisit,
      endDate: item.endDate ?? "",
      daysUntilExpiry: item.daysUntilExpiry ?? undefined,
      discount: "15%",
    });

    setComposeRecipient({
      id: item.id,
      name: item.name,
      phone: item.phone,
      code: item.code,
      segment: segment === "leads" ? "custom" : segment,
    });
    setComposeBody(populated);
    setComposeOpen(true);
  };

  // Send Single Message
  const handleSendSingle = async () => {
    if (!composeRecipient?.phone) {
      toast("error", "لا يوجد رقم هاتف مسجل لهذا المستلم");
      return;
    }
    if (!composeBody.trim()) {
      toast("error", "يرجى كتابة نص الرسالة");
      return;
    }

    setSendingSingle(true);
    try {
      // 1. Try sending via local gateway if member ID is available
      if (composeRecipient.id && composeRecipient.segment !== "custom") {
        const res = await api.messages.send({
          memberId: composeRecipient.id,
          segment: composeRecipient.segment,
          body: composeBody,
        });
        if (res.status === "sent") {
          toast("success", "تم إرسال الرسالة بنجاح عبر الواتساب! ✅");
        } else {
          toast("error", `تعذر الإرسال: ${res.error || res.status}`);
        }
      } else {
        // Direct Send via Gateway endpoint
        const rawRes = await fetch("http://127.0.0.1:8891/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: composeRecipient.phone,
            message: composeBody,
          }),
        }).catch(() => null);

        if (rawRes && rawRes.ok) {
          toast("success", "تم إرسال الرسالة إلى العميل بنجاح عبر الواتساب! ✅");
        } else {
          // Fallback to wa.me direct URL
          const directUrl = buildWhatsAppDirectUrl(composeRecipient.phone, composeBody);
          if (directUrl) window.open(directUrl, "_blank");
          toast("info", "تم فتح محادثة الواتساب للمتابعة المباشرة");
        }
      }
      setComposeOpen(false);
      void loadHistory();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSendingSingle(false);
    }
  };

  // Batch Send
  const handleBatchSend = async () => {
    setBatchSending(true);
    try {
      if (batchSegment === "leads") {
        let sentCount = 0;
        let failCount = 0;
        const validLeads = leads.filter((l) => Boolean(l.phone));
        for (const lead of validLeads) {
          const body = fillMessagePlaceholders(leadsTemplate, {
            memberName: lead.fullName,
            gymName: gymName || "GymGate",
            discount: "20%",
          });
          const res = await fetch("http://127.0.0.1:8891/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: lead.phone, message: body }),
          }).catch(() => null);
          if (res && res.ok) sentCount++;
          else failCount++;
          // Safe delay between batch messages
          await new Promise((r) => setTimeout(r, 2000));
        }
        toast("success", `تم إرسال العرض إلى ${sentCount} عميل محتمل بنجاح!`);
      } else {
        let tpl = absentTemplate;
        if (batchSegment === "expiry") tpl = expiryTemplate;
        else if (batchSegment === "birthday") tpl = birthdayTemplate;

        const res = await api.messages.sendSegment({
          segment: batchSegment,
          body: tpl,
        });
        toast(
          "success",
          `تم الإرسال: ${res.sent} ناجح، ${res.failed} فشل، ${res.skippedCooldown} حماية تكرار`
        );
      }
      setBatchModalOpen(false);
      void loadHistory();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setBatchSending(false);
    }
  };

  // Retry Failed Message in History
  const handleRetry = useCallback(
    async (r: PublicMessageRow) => {
      setRetryingId(r.id);
      try {
        const res = await api.messages.retry({ id: r.id, messageType: r.message_type ?? undefined });
        if (res.ok) {
          toast("success", "تمت إعادة إرسال الرسالة بنجاح عبر الواتساب! ✅");
          void loadHistory();
        } else {
          toast("error", res.error || "تعذر إعادة الإرسال — يرجى التأكد من تشغيل الواتساب");
        }
      } catch (err) {
        toast("error", describeError(err, t));
      } finally {
        setRetryingId(null);
      }
    },
    [toast, t, loadHistory]
  );

  // Save All Templates & Safety Config
  const handleSaveAllConfig = async () => {
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
      toast("success", "تم حفظ كافة القوالب وإعدادات الأمان بنجاح ✓");
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSavingConfig(false);
    }
  };

  // Open WhatsApp Web in popup window
  const openWhatsAppWeb = () => {
    window.open("https://web.whatsapp.com", "_blank", "width=1150,height=820,menubar=no,toolbar=no,location=no");
  };

  // Export History CSV
  const onExportHistory = () => {
    if (history.length === 0) {
      toast("info", "لا توجد رسائل لتصديرها");
      return;
    }
    const headers = ["التاريخ والوقت", "النوع", "المستلم", "رقم الهاتف", "الحالة", "الرسالة", "الخطأ"];
    const dataRows = history.map((r) => [
      String(r.sent_at || r.created_at || "—"),
      String(r.message_type || "campaign"),
      String(r.member_name || "—"),
      String(r.phone || "—"),
      r.status === "sent" ? "تم الإرسال" : r.status === "failed" ? "فشل" : String(r.status),
      String(r.body || ""),
      String(r.error || ""),
    ]);
    downloadCsvWithBom(`سجل_رسائل_واتساب_${todayKey()}`, headers, dataRows);
    toast("success", "تم تصدير سجل الرسائل بنجاح");
  };

  // Filtered views
  const filteredLeads = useMemo(() => {
    const q = leadsSearch.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => l.fullName.toLowerCase().includes(q) || (l.phone && l.phone.includes(q)));
  }, [leads, leadsSearch]);

  const filteredAbsent = useMemo(() => {
    const q = absentSearch.trim().toLowerCase();
    if (!q) return absentRecipients;
    return absentRecipients.filter(
      (r) => r.memberName.toLowerCase().includes(q) || r.memberCode.toLowerCase().includes(q) || (r.phone && r.phone.includes(q))
    );
  }, [absentRecipients, absentSearch]);

  const filteredExpiry = useMemo(() => {
    const q = expiredSearch.trim().toLowerCase();
    if (!q) return expiryRecipients;
    return expiryRecipients.filter(
      (r) => r.memberName.toLowerCase().includes(q) || r.memberCode.toLowerCase().includes(q) || (r.phone && r.phone.includes(q))
    );
  }, [expiryRecipients, expiredSearch]);

  const filteredExpiredMembers = useMemo(() => {
    const q = expiredSearch.trim().toLowerCase();
    if (!q) return expiredMembers;
    return expiredMembers.filter(
      (m) =>
        m.fullName.toLowerCase().includes(q) ||
        m.memberCode.toLowerCase().includes(q) ||
        (m.phone && m.phone.includes(q))
    );
  }, [expiredMembers, expiredSearch]);

  const filteredBirthdays = useMemo(() => {
    const q = birthdaySearch.trim().toLowerCase();
    if (!q) return birthdayRecipients;
    return birthdayRecipients.filter(
      (r) => r.memberName.toLowerCase().includes(q) || r.memberCode.toLowerCase().includes(q) || (r.phone && r.phone.includes(q))
    );
  }, [birthdayRecipients, birthdaySearch]);

  const filteredHistory = useMemo(() => {
    let list = history;
    if (historyFilter === "failed") list = list.filter((h) => h.status === "failed");
    else if (historyFilter === "card") list = list.filter((h) => h.message_type === "card");
    else if (historyFilter === "campaign") list = list.filter((h) => !h.message_type || h.message_type === "campaign");
    else if (historyFilter === "bot") list = list.filter((h) => h.message_type === "bot");

    const q = historySearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (h) =>
        (h.member_name && h.member_name.toLowerCase().includes(q)) ||
        (h.phone && h.phone.includes(q)) ||
        (h.body && h.body.toLowerCase().includes(q))
    );
  }, [history, historySearch, historyFilter]);

  // Main navigation tabs array
  const TABS = [
    {
      id: "leads" as OperationsTab,
      label: "العملاء المحتملين",
      icon: UserPlus,
      badge: leads.length > 0 ? String(leads.length) : undefined,
    },
    {
      id: "absent" as OperationsTab,
      label: "الغائبون باشتراك سارٍ",
      icon: Clock,
      badge: absentRecipients.length > 0 ? String(absentRecipients.length) : undefined,
    },
    {
      id: "expired" as OperationsTab,
      label: "المنقطعون والتجديد",
      icon: RotateCw,
      badge: expiryRecipients.length > 0 ? String(expiryRecipients.length) : undefined,
    },
    {
      id: "birthday" as OperationsTab,
      label: "أعياد الميلاد",
      icon: Calendar,
      badge: birthdayRecipients.length > 0 ? String(birthdayRecipients.length) : undefined,
    },
    { id: "templates" as OperationsTab, label: "قوالب الرسائل", icon: FileText },
    { id: "bot" as OperationsTab, label: "بوت الرد التلقائي", icon: Bot },
    { id: "history" as OperationsTab, label: "سجل الإرسال", icon: History },
    { id: "safety" as OperationsTab, label: "أمان الحظر", icon: ShieldCheck },
  ];

  return (
    <div className="space-y-4">
      {/* =========================================================================
          TOP COMMAND & WHATSAPP CONNECTION BAR
         ========================================================================= */}
      <Card className="border border-line/80 bg-panel/90 backdrop-blur-md shadow-card">
        <CardBody className="p-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Title & Connection Status */}
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-glow-sm">
                <MessageSquare className="size-6" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-lg font-black text-ink tracking-tight">مركز عمليات ورسائل الواتساب</h1>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold border",
                      gatewayRunning && gatewayPaired
                        ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                        : gatewayRunning && !gatewayPaired
                        ? "bg-amber/15 border-amber/30 text-amber"
                        : "bg-red/15 border-red/30 text-red"
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        gatewayRunning && gatewayPaired
                          ? "bg-emerald-400 animate-pulse"
                          : gatewayRunning
                          ? "bg-amber"
                          : "bg-red"
                      )}
                    />
                    <span>
                      {gatewayRunning && gatewayPaired
                        ? "متصل ومقترن بالهاتف ✓"
                        : gatewayRunning && !gatewayPaired
                        ? "بحاجة لمسح QR 📱"
                        : "البوابة غير مشغلة 🔴"}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-subtle mt-0.5">
                  حملات المتابعة الذكية، العملاء المحتملين، رسائل الغياب والتجديد، وتنبيهات أعياد الميلاد
                </p>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={openWhatsAppWeb}
                className="flex items-center gap-1.5 text-xs font-bold"
              >
                <ExternalLink className="size-3.5 text-neon" />
                <span>فتح WhatsApp Web ↗</span>
              </Button>

              <Button
                type="button"
                variant={gatewayPaired ? "secondary" : "primary"}
                size="sm"
                onClick={() => setPairModalOpen(true)}
                className="flex items-center gap-1.5 text-xs font-bold shadow-glow-sm"
              >
                <QrCode className="size-3.5" />
                <span>{gatewayPaired ? "إعادة ربط الـ QR" : "ربط واتساب بالهاتف (QR)"}</span>
              </Button>

              {gatewayRunning && gatewayPaired && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => void handleDisconnectGateway()}
                  disabled={disconnectingGateway}
                  className="flex items-center gap-1.5 text-xs font-bold"
                  title={t("settings.whatsappDisconnectButton")}
                >
                  <LogOut className="size-3.5" />
                  <span>{disconnectingGateway ? t("settings.whatsappDisconnecting") : t("settings.whatsappDisconnectButton")}</span>
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={checkingGateway}
                disabled={checkingGateway}
                onClick={() => void checkGateway()}
                className="text-xs text-subtle hover:text-ink"
                title="تحديث حالة الاتصال"
              >
                <RotateCw className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-line/60">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface/50 border border-line/40">
              <UserPlus className="size-5 text-neon shrink-0" />
              <div>
                <p className="text-[11px] text-faint">عملاء محتملين</p>
                <p className="text-base font-black text-ink tabnum">{leads.length}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface/50 border border-line/40">
              <Clock className="size-5 text-amber shrink-0" />
              <div>
                <p className="text-[11px] text-faint">غائبون باشتراك</p>
                <p className="text-base font-black text-ink tabnum">{absentRecipients.length}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface/50 border border-line/40">
              <RotateCw className="size-5 text-red shrink-0" />
              <div>
                <p className="text-[11px] text-faint">تجديد ومنقطعون</p>
                <p className="text-base font-black text-ink tabnum">{expiryRecipients.length + expiredMembers.length}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface/50 border border-line/40">
              <Calendar className="size-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-[11px] text-faint">أعياد ميلاد</p>
                <p className="text-base font-black text-ink tabnum">{birthdayRecipients.length}</p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* =========================================================================
          HORIZONTAL CAPSULE NAVIGATION TABS
         ========================================================================= */}
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex items-center gap-2 rounded-2xl border border-line/80 bg-panel/80 p-1.5 backdrop-blur-md shadow-sm min-w-max">
          {TABS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setSearchParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      next.set("tab", item.id);
                      if (item.id !== "bot") {
                        next.delete("section");
                      }
                      return next;
                    },
                    { replace: true }
                  );
                }}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all select-none",
                  isActive
                    ? "bg-primary text-white shadow-glow-sm ring-1 ring-primary/50"
                    : "text-subtle hover:text-ink hover:bg-surface/80"
                )}
              >
                <Icon className={cn("size-4 shrink-0", isActive ? "text-white" : "text-subtle")} />
                <span>{item.label}</span>
                {item.badge && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-black font-mono",
                      isActive ? "bg-white/20 text-white" : "bg-primary/10 text-primary border border-primary/20"
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

      {/* =========================================================================
          TAB 1: LEADS & PROSPECTS (العملاء المحتملين)
         ========================================================================= */}
      {activeTab === "leads" && (
        <div className="space-y-4">
          {/* Template Card for Leads */}
          <Card className="border border-neon/30 bg-neon/5">
            <CardBody className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <UserPlus className="size-4 text-neon" />
                    <h3 className="text-xs font-bold text-ink">الرسالة الافتراضية للعملاء المحتملين</h3>
                  </div>
                  <p className="text-[11px] text-faint">
                    تُرسل لكل عميل محتمل سجل اهتمامه أو طلب تجربة مجانية لتشجيعه على زيارة الجيم والاشتراك.
                  </p>
                </div>
                {canSend && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={filteredLeads.length === 0}
                    onClick={() => {
                      setBatchSegment("leads");
                      setBatchModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold shadow-glow-sm self-start lg:self-auto shrink-0"
                  >
                    <Send className="size-3.5" />
                    <span>إرسال العرض لجميع المهتمين ({filteredLeads.length})</span>
                  </Button>
                )}
              </div>
              <div className="mt-3 p-3 rounded-xl bg-surface/80 border border-line text-xs text-ink whitespace-pre-wrap font-sans">
                {leadsTemplate}
              </div>
            </CardBody>
          </Card>

          {/* Leads Table */}
          <Card>
            <CardHeader
              title={
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
                  <span className="text-sm font-bold text-ink">قائمة العملاء المحتملين ({filteredLeads.length})</span>
                  <div className="w-full sm:w-64">
                    <Input
                      placeholder="بحث بالاسم أو الهاتف..."
                      value={leadsSearch}
                      onChange={(e) => setLeadsSearch(e.target.value)}
                    />
                  </div>
                </div>
              }
            />
            {filteredLeads.length === 0 ? (
              <EmptyState
                icon={<UserPlus className="size-6" />}
                title="لا يوجد عملاء محتملون مطابقون"
                description="يمكنك إضافة عملاء محتملين من شاشة إدارة الـ CRM"
              />
            ) : (
              <DataTable<Lead>
                data={filteredLeads}
                rowKey={(l) => String(l.id)}
                columns={[
                  {
                    key: "name",
                    header: "اسم العميل",
                    render: (l: Lead) => <span className="font-bold text-ink">{l.fullName}</span>,
                  },
                  {
                    key: "phone",
                    header: "رقم الهاتف",
                    render: (l: Lead) => (
                      <span dir="ltr" className="font-mono text-xs font-bold text-subtle">
                        {l.phone || "—"}
                      </span>
                    ),
                  },
                  {
                    key: "status",
                    header: "الحالة",
                    render: (l: Lead) => (
                      <Badge variant={l.status === "new" ? "info" : l.status === "interested" ? "warning" : "success"}>
                        {l.status === "new"
                          ? "جديد"
                          : l.status === "interested"
                          ? "مهتم"
                          : l.status === "trial"
                          ? "تذكرة تجريبية"
                          : l.status}
                      </Badge>
                    ),
                  },
                  {
                    key: "createdAt",
                    header: "تاريخ التسجيل",
                    render: (l: Lead) => (
                      <span className="text-xs text-faint tabnum">{formatDateShort(parseDateKey(l.createdAt.slice(0, 10)))}</span>
                    ),
                  },
                  {
                    key: "actions",
                    header: "الإجراء",
                    align: "end",
                    render: (l: Lead) => (
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openSingleCompose({ name: l.fullName, phone: l.phone }, "leads")}
                          className="flex items-center gap-1 text-xs"
                        >
                          <Send className="size-3 text-neon" />
                          <span>إرسال عرض</span>
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {/* =========================================================================
          TAB 2: ABSENT WITH ACTIVE SUBSCRIPTION (الغائبون باشتراك سارٍ)
         ========================================================================= */}
      {activeTab === "absent" && (
        <div className="space-y-4">
          {/* Template Card for Absent */}
          <Card className="border border-amber/30 bg-amber/5">
            <CardBody className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-amber" />
                    <h3 className="text-xs font-bold text-ink">الرسالة الافتراضية للغائبين باشتراك سارٍ</h3>
                  </div>
                  <p className="text-[11px] text-faint">
                    رسالة تحفيزية تشعر العضو بالاهتمام وتذكره باستغلال أيام اشتراكه الساري قبل ضياعها.
                  </p>
                </div>
                {canSend && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={filteredAbsent.length === 0}
                    onClick={() => {
                      setBatchSegment("absent");
                      setBatchModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold shadow-glow-sm self-start lg:self-auto shrink-0"
                  >
                    <Send className="size-3.5" />
                    <span>إرسال تحفيز لجميع الغائبين ({filteredAbsent.length})</span>
                  </Button>
                )}
              </div>
              <div className="mt-3 p-3 rounded-xl bg-surface/80 border border-line text-xs text-ink whitespace-pre-wrap font-sans">
                {absentTemplate}
              </div>
            </CardBody>
          </Card>

          {/* Absent Members Table */}
          <Card>
            <CardHeader
              title={
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
                  <span className="text-sm font-bold text-ink">الأعضاء الغائبون ({filteredAbsent.length})</span>
                  <div className="w-full sm:w-64">
                    <Input
                      placeholder="بحث بالاسم أو الكود أو الهاتف..."
                      value={absentSearch}
                      onChange={(e) => setAbsentSearch(e.target.value)}
                    />
                  </div>
                </div>
              }
            />
            {filteredAbsent.length === 0 ? (
              <EmptyState
                icon={<UserCheck className="size-6" />}
                title="رائع! لا يوجد أعضاء غائبون حالياً"
                description="كافة المشتركين يلتزمون بالحضور والتدريب بانتظام"
              />
            ) : (
              <DataTable<MessageRecipient>
                data={filteredAbsent}
                rowKey={(r) => r.memberId}
                columns={[
                  {
                    key: "member",
                    header: "العضو",
                    render: (r: MessageRecipient) => (
                      <div>
                        <span className="font-bold text-ink">{r.memberName}</span>
                        <p className="text-[11px] text-faint font-mono">{r.memberCode}</p>
                      </div>
                    ),
                  },
                  {
                    key: "phone",
                    header: "رقم الهاتف",
                    render: (r: MessageRecipient) => (
                      <span dir="ltr" className="font-mono text-xs font-bold text-subtle">
                        {r.phone || "—"}
                      </span>
                    ),
                  },
                  {
                    key: "daysSinceLastVisit",
                    header: "مدة الانقطاع",
                    render: (r: MessageRecipient) => (
                      <Badge variant="danger">
                        {r.daysSinceLastVisit ? `غائب منذ ${r.daysSinceLastVisit} يوم` : "لم يحضر بعد"}
                      </Badge>
                    ),
                  },
                  {
                    key: "daysUntilExpiry",
                    header: "المتبقي في اشتراكه",
                    render: (r: MessageRecipient) => (
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                        {r.daysUntilExpiry ? `${r.daysUntilExpiry} يوماً` : "سارٍ"}
                      </span>
                    ),
                  },
                  {
                    key: "actions",
                    header: "الإجراء",
                    align: "end",
                    render: (r: MessageRecipient) => (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          openSingleCompose(
                            {
                              id: r.memberId,
                              name: r.memberName,
                              phone: r.phone,
                              code: r.memberCode,
                              daysSinceLastVisit: r.daysSinceLastVisit,
                              endDate: r.subscriptionEndKey,
                              daysUntilExpiry: r.daysUntilExpiry,
                            },
                            "absent"
                          )
                        }
                        className="flex items-center gap-1 text-xs"
                      >
                        <Send className="size-3 text-amber" />
                        <span>إرسال تشجيع</span>
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {/* =========================================================================
          TAB 3: EXPIRED & RENEWAL (المنقطعون وتجديد الاشتراك)
         ========================================================================= */}
      {activeTab === "expired" && (
        <div className="space-y-4">
          {/* Sub-Filters: Expiring soon vs Already Expired */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpiredFilter("expiring_soon")}
              className={cn(
                "rounded-xl px-4 py-2 text-xs font-bold transition-all border",
                expiredFilter === "expiring_soon"
                  ? "bg-primary text-white border-primary shadow-glow-sm"
                  : "bg-surface border-line text-subtle hover:text-ink"
              )}
            >
              قاربت على الانتهاء للتجديد ({expiryRecipients.length})
            </button>
            <button
              type="button"
              onClick={() => setExpiredFilter("already_expired")}
              className={cn(
                "rounded-xl px-4 py-2 text-xs font-bold transition-all border",
                expiredFilter === "already_expired"
                  ? "bg-primary text-white border-primary shadow-glow-sm"
                  : "bg-surface border-line text-subtle hover:text-ink"
              )}
            >
              انتهت بالفعل ومنقطعون ({expiredMembers.length})
            </button>
          </div>

          {/* Template Card for Expiry */}
          <Card className="border border-red/30 bg-red/5">
            <CardBody className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <RotateCw className="size-4 text-red" />
                    <h3 className="text-xs font-bold text-ink">الرسالة الافتراضية للتجديد واستعادة المنقطعين</h3>
                  </div>
                  <p className="text-[11px] text-faint">
                    عرض تجديد وخصم خاص لتشجيع العضو على تجديد اشتراكه ومواصلة تمارينه.
                  </p>
                </div>
                {canSend && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={expiryRecipients.length === 0}
                    onClick={() => {
                      setBatchSegment("expiry");
                      setBatchModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold shadow-glow-sm self-start lg:self-auto shrink-0"
                  >
                    <Send className="size-3.5" />
                    <span>إرسال تذكير التجديد للجميع</span>
                  </Button>
                )}
              </div>
              <div className="mt-3 p-3 rounded-xl bg-surface/80 border border-line text-xs text-ink whitespace-pre-wrap font-sans">
                {expiryTemplate}
              </div>
            </CardBody>
          </Card>

          {/* Expiring Soon Table */}
          {expiredFilter === "expiring_soon" && (
            <Card>
              <CardHeader
                title={
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
                    <span className="text-sm font-bold text-ink">اشتراكات تقترب من الانتهاء ({filteredExpiry.length})</span>
                    <div className="w-full sm:w-64">
                      <Input
                        placeholder="بحث بالاسم أو الكود..."
                        value={expiredSearch}
                        onChange={(e) => setExpiredSearch(e.target.value)}
                      />
                    </div>
                  </div>
                }
              />
              {filteredExpiry.length === 0 ? (
                <EmptyState icon={<RotateCw className="size-6" />} title="لا توجد اشتراكات تقترب من الانتهاء حالياً" />
              ) : (
                <DataTable<MessageRecipient>
                  data={filteredExpiry}
                  rowKey={(r) => r.memberId}
                  columns={[
                    {
                      key: "member",
                      header: "العضو",
                      render: (r: MessageRecipient) => (
                        <div>
                          <span className="font-bold text-ink">{r.memberName}</span>
                          <p className="text-[11px] text-faint font-mono">{r.memberCode}</p>
                        </div>
                      ),
                    },
                    {
                      key: "phone",
                      header: "الهاتف",
                      render: (r: MessageRecipient) => <span dir="ltr" className="font-mono text-xs">{r.phone || "—"}</span>,
                    },
                    {
                      key: "endDate",
                      header: "تاريخ الانتهاء",
                      render: (r: MessageRecipient) => (
                        <span className="text-xs font-bold text-red tabnum">{r.subscriptionEndKey}</span>
                      ),
                    },
                    {
                      key: "daysUntilExpiry",
                      header: "المتبقي",
                      render: (r: MessageRecipient) => (
                        <Badge variant="warning">{`خلال ${r.daysUntilExpiry ?? 0} يوم`}</Badge>
                      ),
                    },
                    {
                      key: "actions",
                      header: "الإجراء",
                      align: "end",
                      render: (r: MessageRecipient) => (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            openSingleCompose(
                              {
                                id: r.memberId,
                                name: r.memberName,
                                phone: r.phone,
                                code: r.memberCode,
                                endDate: r.subscriptionEndKey,
                                daysUntilExpiry: r.daysUntilExpiry,
                              },
                              "expiry"
                            )
                          }
                          className="flex items-center gap-1 text-xs"
                        >
                          <Send className="size-3 text-red" />
                          <span>إرسال تذكير</span>
                        </Button>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          )}

          {/* Already Expired Table */}
          {expiredFilter === "already_expired" && (
            <Card>
              <CardHeader
                title={
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
                    <span className="text-sm font-bold text-ink">الأعضاء المنتهية اشتراكاتهم (المنقطعون) ({filteredExpiredMembers.length})</span>
                    <div className="w-full sm:w-64">
                      <Input
                        placeholder="بحث بالاسم أو الكود..."
                        value={expiredSearch}
                        onChange={(e) => setExpiredSearch(e.target.value)}
                      />
                    </div>
                  </div>
                }
              />
              {filteredExpiredMembers.length === 0 ? (
                <EmptyState icon={<RotateCw className="size-6" />} title="لا يوجد أعضاء منتهية اشتراكاتهم" />
              ) : (
                <DataTable<PublicMember>
                  data={filteredExpiredMembers}
                  rowKey={(m) => m.id}
                  columns={[
                    {
                      key: "member",
                      header: "العضو",
                      render: (m: PublicMember) => (
                        <div>
                          <span className="font-bold text-ink">{m.fullName}</span>
                          <p className="text-[11px] text-faint font-mono">{m.memberCode}</p>
                        </div>
                      ),
                    },
                    {
                      key: "phone",
                      header: "الهاتف",
                      render: (m: PublicMember) => <span dir="ltr" className="font-mono text-xs">{m.phone || "—"}</span>,
                    },
                    {
                      key: "status",
                      header: "الحالة",
                      render: () => <Badge variant="danger">منتهي</Badge>,
                    },
                    {
                      key: "registrationDate",
                      header: "تاريخ الانضمام",
                      render: (m: PublicMember) => <span className="text-xs font-mono text-faint">{m.registrationDate}</span>,
                    },
                    {
                      key: "actions",
                      header: "الإجراء",
                      align: "end",
                      render: (m: PublicMember) => (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            openSingleCompose(
                              {
                                id: m.id,
                                name: m.fullName,
                                phone: m.phone,
                                code: m.memberCode,
                              },
                              "expiry"
                            )
                          }
                          className="flex items-center gap-1 text-xs"
                        >
                          <Send className="size-3 text-red" />
                          <span>إرسال عرض تجديد</span>
                        </Button>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 4: BIRTHDAYS (أعياد الميلاد)
         ========================================================================= */}
      {activeTab === "birthday" && (
        <div className="space-y-4">
          {/* Template Card for Birthday */}
          <Card className="border border-emerald-500/30 bg-emerald-500/5">
            <CardBody className="p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Calendar className="size-4 text-emerald-400" />
                    <h3 className="text-xs font-bold text-ink">الرسالة الافتراضية لتهنئة أعياد الميلاد</h3>
                  </div>
                  <p className="text-[11px] text-faint">
                    تهنئة راقية باسم الصالة تزيد من ولاء وانتماء الأعضاء للجيم.
                  </p>
                </div>
                {canSend && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={birthdayRecipients.length === 0}
                    onClick={() => {
                      setBatchSegment("birthday");
                      setBatchModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold shadow-glow-sm self-start lg:self-auto shrink-0"
                  >
                    <Send className="size-3.5" />
                    <span>إرسال تهنئة لجميع المحتفلين ({birthdayRecipients.length})</span>
                  </Button>
                )}
              </div>
              <div className="mt-3 p-3 rounded-xl bg-surface/80 border border-line text-xs text-ink whitespace-pre-wrap font-sans">
                {birthdayTemplate}
              </div>
            </CardBody>
          </Card>

          {/* Birthday Table */}
          <Card>
            <CardHeader
              title={
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
                  <span className="text-sm font-bold text-ink">أعياد ميلاد اليوم والأسبوع القادم ({filteredBirthdays.length})</span>
                  <div className="w-full sm:w-64">
                    <Input
                      placeholder="بحث بالاسم أو الكود..."
                      value={birthdaySearch}
                      onChange={(e) => setBirthdaySearch(e.target.value)}
                    />
                  </div>
                </div>
              }
            />
            {filteredBirthdays.length === 0 ? (
              <EmptyState
                icon={<Calendar className="size-6" />}
                title="لا توجد أعياد ميلاد قادمة هذا الأسبوع"
                description="يتم فحص تواريخ ميلاد الأعضاء المسجلة تلقائياً"
              />
            ) : (
              <DataTable<MessageRecipient>
                data={filteredBirthdays}
                rowKey={(r) => r.memberId}
                columns={[
                  {
                    key: "member",
                    header: "العضو",
                    render: (r: MessageRecipient) => (
                      <div>
                        <span className="font-bold text-ink">{r.memberName}</span>
                        <p className="text-[11px] text-faint font-mono">{r.memberCode}</p>
                      </div>
                    ),
                  },
                  {
                    key: "phone",
                    header: "رقم الهاتف",
                    render: (r: MessageRecipient) => <span dir="ltr" className="font-mono text-xs">{r.phone || "—"}</span>,
                  },
                  {
                    key: "nextBirthday",
                    header: "تاريخ المناسبة",
                    render: (r: MessageRecipient) => <span className="text-xs font-bold font-mono">{r.nextBirthdayKey}</span>,
                  },
                  {
                    key: "daysUntilBirthday",
                    header: "الموعد",
                    render: (r: MessageRecipient) => (
                      <Badge variant={r.daysUntilBirthday === 0 ? "success" : "info"}>
                        {r.daysUntilBirthday === 0 ? "اليوم! 🎂🎉" : `خلال ${r.daysUntilBirthday} يوم`}
                      </Badge>
                    ),
                  },
                  {
                    key: "actions",
                    header: "الإجراء",
                    align: "end",
                    render: (r: MessageRecipient) => (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          openSingleCompose(
                            {
                              id: r.memberId,
                              name: r.memberName,
                              phone: r.phone,
                              code: r.memberCode,
                            },
                            "birthday"
                          )
                        }
                        className="flex items-center gap-1 text-xs"
                      >
                        <Send className="size-3 text-emerald-400" />
                        <span>إرسال تهنئة</span>
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {/* =========================================================================
          TAB 5: TEMPLATES & SYSTEM MESSAGES (قوالب الرسائل الافتراضية)
         ========================================================================= */}
      {activeTab === "templates" && (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title={
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
                  <div>
                    <h3 className="text-sm font-bold text-ink">تخصيص قوالب الرسائل الافتراضية</h3>
                    <p className="text-[11px] text-subtle mt-0.5">
                      يتم استبدال المتغيرات المحصورة بين قوسين (مثل: {"{اسم العميل}"}) ببيانات كل مشترك تلقائياً
                    </p>
                  </div>
                  {canEditSettings && (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={savingConfig}
                      disabled={savingConfig}
                      onClick={() => void handleSaveAllConfig()}
                      className="flex items-center gap-1.5 text-xs font-bold shadow-glow-sm"
                    >
                      <Check className="size-3.5" />
                      <span>حفظ كافة القوالب</span>
                    </Button>
                  )}
                </div>
              }
            />

            <div className="p-5 space-y-6">
              {/* Placeholders palette */}
              <div className="rounded-2xl border border-line bg-surface/60 p-4">
                <p className="text-xs font-bold text-ink mb-2">المتغيرات الذكية المتاحة (انقر للنسخ):</p>
                <div className="flex flex-wrap gap-2">
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p.tag}
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(p.tag);
                        toast("info", `تم نسخ المتغير: ${p.tag}`);
                      }}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-mono font-bold bg-panel border border-line text-subtle hover:text-ink hover:border-primary/40 active:scale-95 transition-all"
                    >
                      <Copy className="size-3 text-primary" />
                      <span>{p.tag}</span>
                      <span className="text-[10px] text-faint">({p.desc})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Template Textareas */}
              <div className="grid gap-6 xl:grid-cols-2">
                {/* Leads Template */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-ink">قالب رسالة العملاء المحتملين (Leads)</label>
                  <textarea
                    rows={4}
                    value={leadsTemplate}
                    onChange={(e) => setLeadsTemplate(e.target.value)}
                    className="w-full rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-ink focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Absent Template */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-ink">قالب رسالة الغائبين باشتراك سارٍ</label>
                  <textarea
                    rows={4}
                    value={absentTemplate}
                    onChange={(e) => setAbsentTemplate(e.target.value)}
                    className="w-full rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-ink focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Expiry Template */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-ink">قالب رسالة التجديد والمنقطعين</label>
                  <textarea
                    rows={4}
                    value={expiryTemplate}
                    onChange={(e) => setExpiryTemplate(e.target.value)}
                    className="w-full rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-ink focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Birthday Template */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-ink">قالب رسالة أعياد الميلاد</label>
                  <textarea
                    rows={4}
                    value={birthdayTemplate}
                    onChange={(e) => setBirthdayTemplate(e.target.value)}
                    className="w-full rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-ink focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Welcome Template */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-ink">قالب رسالة الترحيب بالعضو الجديد</label>
                  <textarea
                    rows={4}
                    value={welcomeTemplate}
                    onChange={(e) => setWelcomeTemplate(e.target.value)}
                    className="w-full rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-ink focus:border-primary focus:outline-none"
                  />
                </div>

                {/* Payment Template */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-ink">قالب إشعار استلام الدفعة وسند السداد</label>
                  <textarea
                    rows={4}
                    value={paymentTemplate}
                    onChange={(e) => setPaymentTemplate(e.target.value)}
                    className="w-full rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-ink focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* =========================================================================
          TAB: WHATSAPP BOT & INTERACTIVE MENU (بوت الرد التلقائي والقائمة)
         ========================================================================= */}
      {activeTab === "bot" && (
        <WhatsAppBotManagerTab
          initialSection={
            (searchParams.get("section") as "menu" | "options" | "custom" | "handovers" | null) || undefined
          }
        />
      )}

      {/* =========================================================================
          TAB 6: DELIVERY AUDIT & LOG (سجل الرسائل والمراقبة)
         ========================================================================= */}
      {activeTab === "history" && (
        <Card>
          <CardHeader
            title={
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-ink">سجل الرسائل المرسلة ({filteredHistory.length})</span>
                  <div className="flex items-center gap-1 bg-surface p-1 rounded-xl border border-line text-xs">
                    {(["all", "card", "campaign", "failed"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setHistoryFilter(f)}
                        className={cn(
                          "px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all",
                          historyFilter === f
                            ? "bg-primary text-black shadow-glow-sm"
                            : "text-subtle hover:text-ink"
                        )}
                      >
                        {f === "all" ? "الكل" : f === "card" ? "بطاقات QR" : f === "campaign" ? "حملات" : "فشل الإرسال"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={onExportHistory} className="text-xs">
                    <Download className="size-3.5" />
                    <span>تصدير CSV</span>
                  </Button>
                  <div className="w-48">
                    <Input
                      placeholder="بحث في السجل..."
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            }
          />
          {filteredHistory.length === 0 ? (
            <EmptyState icon={<History className="size-6" />} title="سجل الرسائل فارغ حالياً" />
          ) : (
            <DataTable<PublicMessageRow>
              data={filteredHistory}
              rowKey={(h) => String(h.id)}
              columns={[
                {
                  key: "time",
                  header: "التوقيت",
                  render: (h: PublicMessageRow) => (
                    <span className="text-xs text-subtle tabnum font-mono">
                      {h.sent_at ? formatTime(h.sent_at) : h.created_at ? formatTime(h.created_at) : "—"}
                    </span>
                  ),
                },
                {
                  key: "recipient",
                  header: "المستلم",
                  render: (h: PublicMessageRow) => (
                    <div>
                      <span className="font-bold text-ink text-xs">{h.member_name || "—"}</span>
                      <p dir="ltr" className="text-[10px] text-faint font-mono">{h.phone || "—"}</p>
                    </div>
                  ),
                },
                {
                  key: "type",
                  header: "النوع",
                  render: (h: PublicMessageRow) => (
                    <Badge variant="neutral">
                      {h.message_type === "card"
                        ? "بطاقة QR"
                        : h.message_type === "direct"
                        ? "مباشر"
                        : h.message_type === "bot"
                        ? "رد آلي"
                        : "حملة"}
                    </Badge>
                  ),
                },
                {
                  key: "body",
                  header: "مقتطف الرسالة",
                  render: (h: PublicMessageRow) => (
                    <p className="text-xs text-subtle max-w-xs truncate" title={h.body}>
                      {h.body}
                    </p>
                  ),
                },
                {
                  key: "status",
                  header: "الحالة",
                  render: (h: PublicMessageRow) => (
                    <Badge variant={h.status === "sent" ? "success" : h.status === "failed" ? "danger" : "warning"}>
                      {h.status === "sent"
                        ? "تم الإرسال ✓"
                        : h.status === "failed"
                        ? "فشل ✕"
                        : "معلق"}
                    </Badge>
                  ),
                },
                {
                  key: "actions",
                  header: "",
                  align: "end",
                  render: (h: PublicMessageRow) =>
                    h.status === "failed" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={retryingId === h.id}
                        disabled={retryingId === h.id}
                        onClick={() => void handleRetry(h)}
                        className="text-xs text-amber"
                      >
                        <RotateCw className="size-3" />
                        <span>إعادة</span>
                      </Button>
                    ) : null,
                },
              ]}
            />
          )}
        </Card>
      )}

      {/* =========================================================================
          TAB 7: ANTI-BAN SAFETY (حماية الأرقام ومنع الحظر)
         ========================================================================= */}
      {activeTab === "safety" && (
        <Card>
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-ink">إعدادات الحماية الفائقة ومنع حظر أرقام الواتساب</h3>
              </div>
            }
          />
          <CardBody className="p-5 space-y-6">
            <div className="rounded-2xl border border-line bg-surface/60 p-4 space-y-1">
              <p className="text-xs font-bold text-ink">نظام التباعد الزمني وساعات الهدوء:</p>
              <p className="text-[11px] text-faint">
                يضمن هذا النظام محاكاة السلوك البشري الطبيعي أثناء الإرسال بحيث لا تكتشف خوارزميات ميتا أي إرسال آلي مفاجئ.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Input
                  label="أقل فاصل زمني (ثوانٍ)"
                  type="number"
                  value={pacingMin}
                  onChange={(e) => setPacingMin(e.target.value)}
                  disabled={!canEditSettings || savingConfig}
                />
                <p className="text-[10px] text-faint mt-1">الافتراضي: 15 ثانية</p>
              </div>

              <div>
                <Input
                  label="أقصى فاصل زمني (ثوانٍ)"
                  type="number"
                  value={pacingMax}
                  onChange={(e) => setPacingMax(e.target.value)}
                  disabled={!canEditSettings || savingConfig}
                />
                <p className="text-[10px] text-faint mt-1">الافتراضي: 35 ثانية</p>
              </div>

              <div>
                <Input
                  label="فترة حماية عدم التكرار (أيام)"
                  type="number"
                  value={cooldownDays}
                  onChange={(e) => setCooldownDays(e.target.value)}
                  disabled={!canEditSettings || savingConfig}
                />
                <p className="text-[10px] text-faint mt-1">منع تكرار نفس الرسالة لنفس الرقم خلال هذه الأيام</p>
              </div>
            </div>

            {canEditSettings && (
              <Button
                size="sm"
                variant="primary"
                loading={savingConfig}
                disabled={savingConfig}
                onClick={() => void handleSaveAllConfig()}
                className="text-xs font-bold"
              >
                حفظ إعدادات الأمان
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* =========================================================================
          MODAL: SINGLE COMPOSE & SEND
         ========================================================================= */}
      {composeOpen && composeRecipient && (
        <Modal
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          title={`مراسلة عبر واتساب: ${composeRecipient.name}`}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface/60 p-3">
              <div>
                <span className="text-xs font-bold text-ink">{composeRecipient.name}</span>
                {composeRecipient.code && (
                  <p className="text-[11px] text-faint font-mono">كود: {composeRecipient.code}</p>
                )}
              </div>
              <span dir="ltr" className="text-xs font-mono font-bold text-primary">
                {composeRecipient.phone || "بدون رقم"}
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-ink">نص الرسالة</label>
              <textarea
                rows={6}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                className="w-full rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-ink focus:border-primary focus:outline-none"
              />
              <div className="flex justify-between text-[11px] text-faint">
                <span>عدد الأحرف: {composeBody.length}</span>
                <span>سيتم إرسالها من رقم الواتساب المربوط بالسيستم</span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-line">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const url = buildWhatsAppDirectUrl(composeRecipient.phone || "", composeBody);
                  if (url) window.open(url, "_blank");
                }}
                className="text-xs text-subtle hover:text-ink flex items-center gap-1"
              >
                <ExternalLink className="size-3" />
                <span>فتح محادثة مباشرة (wa.me)</span>
              </Button>

              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setComposeOpen(false)}>
                  إلغاء
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={sendingSingle}
                  disabled={sendingSingle || !composeRecipient.phone}
                  onClick={() => void handleSendSingle()}
                  className="flex items-center gap-1.5 font-bold shadow-glow-sm"
                >
                  <Send className="size-3.5" />
                  <span>إرسال عبر واتساب</span>
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* =========================================================================
          CONFIRM BATCH SEND MODAL
         ========================================================================= */}
      <ConfirmDialog
        open={batchModalOpen}
        loading={batchSending}
        onClose={() => setBatchModalOpen(false)}
        onConfirm={() => void handleBatchSend()}
        title="تأكيد الإرسال الجماعي"
        message="سيتم إرسال الرسالة إلى جميع الأرقام في هذه الشريحة مع تطبيق التباعد الزمني الآمن لحماية حساب الواتساب من الحظر. هل تريد المتابعة؟"
        confirmLabel="بدء الإرسال الآن"
      />

      {/* =========================================================================
          WHATSAPP PAIR QR MODAL
         ========================================================================= */}
      <WhatsAppPairModal
        open={pairModalOpen}
        onClose={() => {
          setPairModalOpen(false);
          void checkGateway();
        }}
        gatewayUrl="http://127.0.0.1:8891"
        onStart={async (restart) => {
          await api.system.ensureWhatsAppGateway({ restart });
        }}
      />
    </div>
  );
}
