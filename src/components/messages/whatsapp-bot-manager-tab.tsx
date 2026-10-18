import { useCallback, useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bot,
  Smartphone,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  RefreshCw,
  Sparkles,
  Send,
  User,
  QrCode,
  Clock,
  Dumbbell,
  Tag,
  Headphones,
  CheckCheck,
  MessageSquare,
  Flame,
  Sliders,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n";
import { describeError } from "@/utils/app-error";
import { cn } from "@/utils/cn";
import {
  api,
  type WhatsAppBotConfig,
  type BotCustomOption,
  type PublicMember,
  type BotHandoverRow,
} from "@/api";

interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  time: string;
  media?: {
    base64: string;
    mime: string;
    caption?: string;
  } | null;
  handledOption?: string;
}

export interface WhatsAppBotManagerTabProps {
  initialSection?: "menu" | "options" | "custom" | "handovers";
}

export function WhatsAppBotManagerTab({ initialSection }: WhatsAppBotManagerTabProps = {}) {
  const t = useT();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<WhatsAppBotConfig | null>(null);

  const urlSection = searchParams.get("section") as
    | "menu"
    | "options"
    | "custom"
    | "handovers"
    | null;
  const initialResolvedSection =
    initialSection ||
    (urlSection && ["menu", "options", "custom", "handovers"].includes(urlSection)
      ? urlSection
      : "menu");

  // Active section inside the manager
  const [activeSection, setActiveSection] = useState<"menu" | "options" | "custom" | "handovers">(
    initialResolvedSection
  );
  const [activeOptionTab, setActiveOptionTab] = useState<"0" | "1" | "2" | "3" | "4" | "5">("1");

  useEffect(() => {
    const sec = (initialSection || searchParams.get("section")) as
      | "menu"
      | "options"
      | "custom"
      | "handovers"
      | null;
    if (sec && ["menu", "options", "custom", "handovers"].includes(sec)) {
      setActiveSection(sec);
    }
  }, [initialSection, searchParams]);

  const switchSection = (sec: "menu" | "options" | "custom" | "handovers") => {
    setActiveSection(sec);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "bot");
        if (sec === "menu") {
          next.delete("section");
        } else {
          next.set("section", sec);
        }
        return next;
      },
      { replace: true }
    );
  };

  // Handovers states (Option 0)
  const [handovers, setHandovers] = useState<BotHandoverRow[]>([]);
  const [loadingHandovers, setLoadingHandovers] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [handoverFilter, setHandoverFilter] = useState<"pending" | "resolved" | "all">("pending");

  // Editable fields
  const [botEnabled, setBotEnabled] = useState(true);
  const [menuTemplate, setMenuTemplate] = useState("");
  const [option0Template, setOption0Template] = useState("");
  const [option1Template, setOption1Template] = useState("");
  const [option2Template, setOption2Template] = useState("");
  const [option3Template, setOption3Template] = useState("");
  const [option4Template, setOption4Template] = useState("");
  const [option5Template, setOption5Template] = useState("");
  const [customOptions, setCustomOptions] = useState<BotCustomOption[]>([]);

  // Simulation states
  const [simulatorMember, setSimulatorMember] = useState<PublicMember | null>(null);
  const [memberPickerSearch, setMemberPickerSearch] = useState("");
  const [memberPickerResults, setMemberPickerResults] = useState<PublicMember[]>([]);
  const [simulatedInput, setSimulatedInput] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Load config from backend
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await api.whatsappBot.getConfig();
      setConfig(cfg);
      setBotEnabled(cfg.enabled);
      setMenuTemplate(cfg.menuTemplate);
      setOption0Template(cfg.option0Template);
      setOption1Template(cfg.option1Template);
      setOption2Template(cfg.option2Template);
      setOption3Template(cfg.option3Template);
      setOption4Template(cfg.option4Template);
      setOption5Template(cfg.option5Template);
      setCustomOptions(cfg.customOptions || []);

      // Initialize simulator with initial greeting
      const nowTime = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
      setChatMessages([
        {
          id: "welcome",
          sender: "bot",
          text: cfg.menuTemplate,
          time: nowTime,
          handledOption: "menu",
        },
      ]);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const loadHandovers = useCallback(async () => {
    setLoadingHandovers(true);
    try {
      const list = await api.whatsappBot.listHandovers({
        status: handoverFilter !== "all" ? handoverFilter : undefined,
      });
      setHandovers(list);
    } catch {
      /* ignore */
    } finally {
      setLoadingHandovers(false);
    }
  }, [handoverFilter]);

  useEffect(() => {
    void loadHandovers();
  }, [loadHandovers]);

  useEffect(() => {
    if (activeSection === "handovers") {
      void loadHandovers();
    }
  }, [activeSection, loadHandovers]);

  const handleResolveHandover = async (id: string) => {
    setResolvingId(id);
    try {
      await api.whatsappBot.resolveHandover(id);
      toast("success", "تم تحديد طلب المحادثة كمكتمل بنجاح ✅");
      window.dispatchEvent(new Event("reload-notifications"));
      void loadHandovers();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setResolvingId(null);
    }
  };

  // Search members for simulation context
  useEffect(() => {
    if (!memberPickerSearch.trim()) {
      setMemberPickerResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.members.searchPicker(memberPickerSearch.trim(), 5);
        setMemberPickerResults(res);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [memberPickerSearch]);

  // Scroll simulator chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, simulating]);

  // Save changes to backend
  const handleSave = async () => {
    setSaving(true);
    try {
      await api.whatsappBot.saveConfig({
        enabled: botEnabled,
        menuTemplate,
        option0Template,
        option1Template,
        option2Template,
        option3Template,
        option4Template,
        option5Template,
        customOptions,
      });
      toast("success", "تم حفظ إعدادات وقوالب الرد الآلي بنجاح! ✅");
      void loadConfig();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSaving(false);
    }
  };

  // Reset current field to default
  const handleResetToDefault = (target: "menu" | "0" | "1" | "2" | "3" | "4" | "5") => {
    if (!config) return;
    if (target === "menu") setMenuTemplate(config.defaultTemplates.menu);
    else if (target === "0") setOption0Template(config.defaultTemplates.option0);
    else if (target === "1") setOption1Template(config.defaultTemplates.option1);
    else if (target === "2") setOption2Template(config.defaultTemplates.option2);
    else if (target === "3") setOption3Template(config.defaultTemplates.option3);
    else if (target === "4") setOption4Template(config.defaultTemplates.option4);
    else if (target === "5") setOption5Template(config.defaultTemplates.option5);
    toast("info", "تم استرجاع النص الافتراضي بنجاح");
  };

  // Add custom option
  const handleAddCustomOption = () => {
    const nextNumber = String(customOptions.length + 6);
    const newOpt: BotCustomOption = {
      id: "cust_" + Math.random().toString(36).substring(2, 9),
      triggerKey: nextNumber,
      title: `خيار إضافي ${nextNumber}`,
      replyMessage: "مرحباً بك! هذه رسالة رد مخصصة على الخيار رقم " + nextNumber,
      enabled: true,
    };
    setCustomOptions([...customOptions, newOpt]);
  };

  // Remove custom option
  const handleRemoveCustomOption = (id: string) => {
    setCustomOptions(customOptions.filter((o) => o.id !== id));
  };

  // Update custom option
  const handleUpdateCustomOption = (id: string, patch: Partial<BotCustomOption>) => {
    setCustomOptions(customOptions.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  // Insert tag into text
  const insertPlaceholder = (tag: string, target: "menu" | "0" | "1" | "2" | "3" | "4" | "5") => {
    if (target === "menu") setMenuTemplate((prev) => prev + " " + tag);
    else if (target === "0") setOption0Template((prev) => prev + " " + tag);
    else if (target === "1") setOption1Template((prev) => prev + " " + tag);
    else if (target === "2") setOption2Template((prev) => prev + " " + tag);
    else if (target === "3") setOption3Template((prev) => prev + " " + tag);
    else if (target === "4") setOption4Template((prev) => prev + " " + tag);
    else if (target === "5") setOption5Template((prev) => prev + " " + tag);
  };

  // Send message in simulator
  const handleSendSimulation = async (textToSend?: string) => {
    const msg = (textToSend || simulatedInput).trim();
    if (!msg) return;

    const timeStr = new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });

    // Append user message
    const userMsg: ChatMessage = {
      id: "u_" + Date.now(),
      sender: "user",
      text: msg,
      time: timeStr,
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setSimulatedInput("");
    setSimulating(true);

    try {
      const res = await api.whatsappBot.simulate({
        message: msg,
        memberId: simulatorMember ? simulatorMember.id : undefined,
      });

      const botReply: ChatMessage = {
        id: "b_" + Date.now(),
        sender: "bot",
        text: res.reply || "لم يتم استلام رد من البوت (قد يكون معطلاً أو تم كتمه).",
        time: new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
        media: res.media,
        handledOption: res.handledOption,
      };
      setChatMessages((prev) => [...prev, botReply]);
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setSimulating(false);
    }
  };

  // Placeholders dictionary
  const COMMON_TAGS = [
    { tag: "{اسم الجيم}", desc: "اسم الصالة الرياضية" },
    { tag: "{اسم العضو}", desc: "اسم العضو أو العميل" },
    { tag: "{كود العضوية}", desc: "كود العضوية (MEM-0001)" },
  ];

  const OPTION1_TAGS = [
    ...COMMON_TAGS,
    { tag: "{اسم الباقة}", desc: "اسم باقة الاشتراك الحالية" },
    { tag: "{تاريخ البدء}", desc: "تاريخ بداية الاشتراك" },
    { tag: "{تاريخ الانتهاء}", desc: "تاريخ نهاية الاشتراك" },
    { tag: "{الأيام المتبقية}", desc: "عدد الأيام المتبقية" },
    { tag: "{تفاصيل الحصص}", desc: "الحصص المتبقية (للباقات المحدودة)" },
    { tag: "{رابط البوابة}", desc: "رابط البوابة الإلكترونية الشخصية للعضو" },
  ];

  const OPTION2_TAGS = [
    ...COMMON_TAGS,
    { tag: "{عدد المتواجدين}", desc: "عدد الأعضاء المتواجدين بالصالة الآن" },
  ];

  const OPTION3_TAGS = [
    ...COMMON_TAGS,
    { tag: "{مواعيد العمل}", desc: "ساعات العمل الرسمية للصالة" },
  ];

  const OPTION4_TAGS = [
    ...COMMON_TAGS,
    { tag: "{قائمة الباقات}", desc: "عرض قائمة الباقات والأسعار النشطة تلقائياً" },
  ];

  const OPTION5_TAGS = [
    ...COMMON_TAGS,
    { tag: "{رمز الباركود}", desc: "رقم الباركود الفعلي للعضو" },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-subtle space-y-3">
        <RefreshCw className="size-8 animate-spin text-primary" />
        <p className="text-sm">جاري تحميل إعدادات وقوالب الرد الآلي للواتساب...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* =========================================================================
          TOP COMMAND & STATUS BAR
         ========================================================================= */}
      <Card className="border border-line/80 bg-panel/90 backdrop-blur-md shadow-card">
        <CardBody className="p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-glow-sm">
                <Bot className="size-7" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-bold text-foreground">
                    بوت الرد التلقائي والقائمة التفاعلية على الواتساب
                  </h2>
                  <Badge variant={botEnabled ? "success" : "neutral"} dot>
                    {botEnabled ? "البوت نشط ويعمل" : "البوت معطل"}
                  </Badge>
                </div>
                <p className="text-xs text-subtle mt-0.5">
                  تحكم كامل في الرسالة الأساسية، القائمة التفاعلية، ورسائل الرد لكل رقم وخيارات مخصصة
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant={botEnabled ? "secondary" : "primary"}
                size="sm"
                onClick={() => setBotEnabled(!botEnabled)}
              >
                {botEnabled ? "تعطيل البوت مؤقتاً" : "تفعيل البوت الآن"}
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={saving}
                className="gap-1.5"
              >
                <Save className="size-4" />
                {saving ? "جاري الحفظ..." : "حفظ التعديلات"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* =========================================================================
          MAIN WORKSPACE: CONFIGURATION (LEFT) + LIVE SMARTPHONE SIMULATOR (RIGHT)
         ========================================================================= */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: BOT CONTROLS & TEMPLATES (7 cols) */}
        <div className="xl:col-span-7 space-y-5">
          {/* Section Navigation Tabs */}
          <div className="flex items-center gap-2 p-1 bg-surface-muted/60 border border-line/80 rounded-xl">
            <button
              onClick={() => switchSection("menu")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all",
                activeSection === "menu"
                  ? "bg-primary text-white shadow-sm"
                  : "text-subtle hover:text-foreground hover:bg-surface/50"
              )}
            >
              <MessageSquare className="size-3.5" />
              <span>القائمة الرئيسية والرسالة الأساسية</span>
            </button>
            <button
              onClick={() => switchSection("options")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all",
                activeSection === "options"
                  ? "bg-primary text-white shadow-sm"
                  : "text-subtle hover:text-foreground hover:bg-surface/50"
              )}
            >
              <Sliders className="size-3.5" />
              <span>خيارات الأرقام (0 - 5)</span>
            </button>
            <button
              onClick={() => switchSection("custom")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all",
                activeSection === "custom"
                  ? "bg-primary text-white shadow-sm"
                  : "text-subtle hover:text-foreground hover:bg-surface/50"
              )}
            >
              <Plus className="size-3.5" />
              <span>أرقام مخصصة ({customOptions.length})</span>
            </button>
            <button
              onClick={() => switchSection("handovers")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 text-xs font-semibold rounded-lg transition-all",
                activeSection === "handovers"
                  ? "bg-rose-500 text-white shadow-sm"
                  : "text-subtle hover:text-foreground hover:bg-surface/50"
              )}
            >
              <Headphones className="size-3.5" />
              <span>طلبات المحادثة (0)</span>
              {handovers.filter((h) => h.status === "pending").length > 0 && (
                <span className="ms-1 px-1.5 py-0.2 rounded-full bg-rose-600 text-white text-[10px] font-bold animate-pulse">
                  {handovers.filter((h) => h.status === "pending").length}
                </span>
              )}
            </button>
          </div>

          {/* ---------------- SECTION 1: MAIN MENU & GREETING ---------------- */}
          {activeSection === "menu" && (
            <Card className="border border-line/80 bg-panel/90">
              <CardHeader
                title={
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-amber" />
                    <span>الرسالة الترحيبية والقائمة الرئيسية</span>
                  </div>
                }
                description="هذه الرسالة تظهر تلقائياً عند أول تواصل للعضو، أو إرسال تحية، أو كلمة «قائمة»."
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleResetToDefault("menu")}
                    className="gap-1 text-xs"
                  >
                    <RotateCcw className="size-3.5" />
                    استرجاع الافتراضي
                  </Button>
                }
              />
              <CardBody className="p-4 space-y-4">
                <div>
                  <textarea
                    rows={8}
                    value={menuTemplate}
                    onChange={(e) => setMenuTemplate(e.target.value)}
                    dir="rtl"
                    className="w-full text-xs font-mono p-3 rounded-xl border border-line bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 leading-relaxed resize-y"
                    placeholder="اكتب هنا الرسالة الترحيبية وقائمة الأرقام..."
                  />
                </div>

                {/* Placeholder chips */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-subtle flex items-center gap-1">
                    <Tag className="size-3 text-primary" />
                    اضغط لإدراج وسم ذكي في نص الرسالة:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_TAGS.map((t) => (
                      <button
                        key={t.tag}
                        onClick={() => insertPlaceholder(t.tag, "menu")}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-surface border border-line/80 hover:border-primary/50 text-foreground transition-all flex items-center gap-1"
                        title={t.desc}
                      >
                        <span className="font-mono text-primary font-bold">{t.tag}</span>
                        <span className="text-[10px] text-subtle">({t.desc})</span>
                      </button>
                    ))}
                    <button
                      onClick={() => insertPlaceholder("{تحية العضو}", "menu")}
                      className="text-[11px] px-2.5 py-1 rounded-lg bg-surface border border-line/80 hover:border-primary/50 text-foreground transition-all flex items-center gap-1"
                      title="تحية مخصصة للعضو المسجل (يا كابتن فلان)"
                    >
                      <span className="font-mono text-primary font-bold">{"{تحية العضو}"}</span>
                      <span className="text-[10px] text-subtle">(تحية ذكية باسم العضو)</span>
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* ---------------- SECTION 2: BUILT-IN OPTIONS (0 - 5) ---------------- */}
          {activeSection === "options" && (
            <div className="space-y-4">
              {/* Option Selector Pills */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[
                  { id: "1" as const, label: "1️⃣ الباقة والبوابة", icon: Tag },
                  { id: "2" as const, label: "2️⃣ نسبة الإشغال", icon: Flame },
                  { id: "3" as const, label: "3️⃣ مواعيد العمل", icon: Clock },
                  { id: "4" as const, label: "4️⃣ خطط وأسعار", icon: Dumbbell },
                  { id: "5" as const, label: "5️⃣ الكارنيه وQR", icon: QrCode },
                  { id: "0" as const, label: "0️⃣ الاستقبال", icon: Headphones },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setActiveOptionTab(opt.id)}
                    className={cn(
                      "flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-semibold transition-all gap-1 text-center",
                      activeOptionTab === opt.id
                        ? "bg-primary/10 border-primary text-primary shadow-sm"
                        : "bg-surface border-line/80 text-subtle hover:text-foreground hover:bg-surface-muted"
                    )}
                  >
                    <opt.icon className="size-4" />
                    <span className="truncate max-w-full">{opt.label}</span>
                  </button>
                ))}
              </div>

              {/* Option 1: Subscription & Portal */}
              {activeOptionTab === "1" && (
                <Card className="border border-line/80 bg-panel/90">
                  <CardHeader
                    title="1️⃣ تفاصيل الاشتراك ورابط البوابة الإلكترونية"
                    description="الرد عند إرسال الرقم 1 أو كلمات: «اشتراك»، «باقتي»، «اشتراكي»"
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetToDefault("1")}
                        className="gap-1 text-xs"
                      >
                        <RotateCcw className="size-3.5" />
                        استرجاع الافتراضي
                      </Button>
                    }
                  />
                  <CardBody className="p-4 space-y-4">
                    <textarea
                      rows={8}
                      value={option1Template}
                      onChange={(e) => setOption1Template(e.target.value)}
                      dir="rtl"
                      className="w-full text-xs font-mono p-3 rounded-xl border border-line bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 leading-relaxed resize-y"
                    />
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-subtle">
                        الوسوم المتاحة لهذا الخيار:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {OPTION1_TAGS.map((t) => (
                          <button
                            key={t.tag}
                            onClick={() => insertPlaceholder(t.tag, "1")}
                            className="text-[11px] px-2 py-0.5 rounded-lg bg-surface border border-line/80 hover:border-primary/50 text-foreground"
                            title={t.desc}
                          >
                            <span className="font-mono text-primary">{t.tag}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Option 2: Live Occupancy */}
              {activeOptionTab === "2" && (
                <Card className="border border-line/80 bg-panel/90">
                  <CardHeader
                    title="2️⃣ نسبة إشغال الصالة والزحمة حالياً"
                    description="الرد عند إرسال الرقم 2 أو كلمات: «إشغال»، «اشغال»، «زحمة»"
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetToDefault("2")}
                        className="gap-1 text-xs"
                      >
                        <RotateCcw className="size-3.5" />
                        استرجاع الافتراضي
                      </Button>
                    }
                  />
                  <CardBody className="p-4 space-y-4">
                    <textarea
                      rows={6}
                      value={option2Template}
                      onChange={(e) => setOption2Template(e.target.value)}
                      dir="rtl"
                      className="w-full text-xs font-mono p-3 rounded-xl border border-line bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 leading-relaxed resize-y"
                    />
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-subtle">الوسوم المتاحة:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {OPTION2_TAGS.map((t) => (
                          <button
                            key={t.tag}
                            onClick={() => insertPlaceholder(t.tag, "2")}
                            className="text-[11px] px-2 py-0.5 rounded-lg bg-surface border border-line/80 hover:border-primary/50 text-foreground"
                            title={t.desc}
                          >
                            <span className="font-mono text-primary">{t.tag}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Option 3: Working Hours */}
              {activeOptionTab === "3" && (
                <Card className="border border-line/80 bg-panel/90">
                  <CardHeader
                    title="3️⃣ مواعيد العمل وفترات الشباب والسيدات"
                    description="الرد عند إرسال الرقم 3 أو كلمات: «مواعيد»، «ساعات العمل»، «أوقات»"
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetToDefault("3")}
                        className="gap-1 text-xs"
                      >
                        <RotateCcw className="size-3.5" />
                        استرجاع الافتراضي
                      </Button>
                    }
                  />
                  <CardBody className="p-4 space-y-4">
                    <textarea
                      rows={7}
                      value={option3Template}
                      onChange={(e) => setOption3Template(e.target.value)}
                      dir="rtl"
                      className="w-full text-xs font-mono p-3 rounded-xl border border-line bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 leading-relaxed resize-y"
                    />
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-subtle">الوسوم المتاحة:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {OPTION3_TAGS.map((t) => (
                          <button
                            key={t.tag}
                            onClick={() => insertPlaceholder(t.tag, "3")}
                            className="text-[11px] px-2 py-0.5 rounded-lg bg-surface border border-line/80 hover:border-primary/50 text-foreground"
                            title={t.desc}
                          >
                            <span className="font-mono text-primary">{t.tag}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Option 4: Membership Plans & Prices */}
              {activeOptionTab === "4" && (
                <Card className="border border-line/80 bg-panel/90">
                  <CardHeader
                    title="4️⃣ خطط وأسعار الاشتراكات"
                    description="الرد عند إرسال الرقم 4 أو كلمات: «أسعار»، «اسعار»، «باقات»، «خطط»"
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetToDefault("4")}
                        className="gap-1 text-xs"
                      >
                        <RotateCcw className="size-3.5" />
                        استرجاع الافتراضي
                      </Button>
                    }
                  />
                  <CardBody className="p-4 space-y-4">
                    <textarea
                      rows={6}
                      value={option4Template}
                      onChange={(e) => setOption4Template(e.target.value)}
                      dir="rtl"
                      className="w-full text-xs font-mono p-3 rounded-xl border border-line bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 leading-relaxed resize-y"
                    />
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-subtle">الوسوم المتاحة:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {OPTION4_TAGS.map((t) => (
                          <button
                            key={t.tag}
                            onClick={() => insertPlaceholder(t.tag, "4")}
                            className="text-[11px] px-2 py-0.5 rounded-lg bg-surface border border-line/80 hover:border-primary/50 text-foreground"
                            title={t.desc}
                          >
                            <span className="font-mono text-primary">{t.tag}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Option 5: Digital Card QR Barcode */}
              {activeOptionTab === "5" && (
                <Card className="border border-line/80 bg-panel/90">
                  <CardHeader
                    title="5️⃣ كارنيه العضوية والباركود الرقمي للدخول"
                    description="الرد عند إرسال الرقم 5 أو كلمات: «كارنيه»، «باركود»، «qr»، «كارت»"
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetToDefault("5")}
                        className="gap-1 text-xs"
                      >
                        <RotateCcw className="size-3.5" />
                        استرجاع الافتراضي
                      </Button>
                    }
                  />
                  <CardBody className="p-4 space-y-4">
                    <textarea
                      rows={6}
                      value={option5Template}
                      onChange={(e) => setOption5Template(e.target.value)}
                      dir="rtl"
                      className="w-full text-xs font-mono p-3 rounded-xl border border-line bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 leading-relaxed resize-y"
                    />
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-subtle">الوسوم المتاحة:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {OPTION5_TAGS.map((t) => (
                          <button
                            key={t.tag}
                            onClick={() => insertPlaceholder(t.tag, "5")}
                            className="text-[11px] px-2 py-0.5 rounded-lg bg-surface border border-line/80 hover:border-primary/50 text-foreground"
                            title={t.desc}
                          >
                            <span className="font-mono text-primary">{t.tag}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )}

              {/* Option 0: Reception Handover */}
              {activeOptionTab === "0" && (
                <Card className="border border-line/80 bg-panel/90">
                  <CardHeader
                    title="0️⃣ التحويل لموظف الاستقبال وكتم البوت"
                    description="الرد عند إرسال الرقم 0 أو كلمات: «استقبال»، «موظف»، «خدمة العملاء»"
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetToDefault("0")}
                        className="gap-1 text-xs"
                      >
                        <RotateCcw className="size-3.5" />
                        استرجاع الافتراضي
                      </Button>
                    }
                  />
                  <CardBody className="p-4 space-y-4">
                    <textarea
                      rows={5}
                      value={option0Template}
                      onChange={(e) => setOption0Template(e.target.value)}
                      dir="rtl"
                      className="w-full text-xs font-mono p-3 rounded-xl border border-line bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/40 leading-relaxed resize-y"
                    />
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-subtle">الوسوم المتاحة:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {COMMON_TAGS.map((t) => (
                          <button
                            key={t.tag}
                            onClick={() => insertPlaceholder(t.tag, "0")}
                            className="text-[11px] px-2 py-0.5 rounded-lg bg-surface border border-line/80 hover:border-primary/50 text-foreground"
                            title={t.desc}
                          >
                            <span className="font-mono text-primary">{t.tag}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {/* ---------------- SECTION 3: CUSTOM OPTIONS & KEYWORDS ---------------- */}
          {activeSection === "custom" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    الخيارات والأرقام المخصصة (Keywords)
                  </h3>
                  <p className="text-xs text-subtle">
                    يمكنك إضافة أرقام جديدة (مثل 6، 7) أو كلمات مفتاحية (مثل «لوكيشن»، «عروض») للرد برد مخصص.
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAddCustomOption}
                  className="gap-1"
                >
                  <Plus className="size-3.5" />
                  إضافة خيار جديد
                </Button>
              </div>

              {customOptions.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="size-6" />}
                  title="لا توجد خيارات مخصصة مضافة بعد"
                  description="اضغط على زر «إضافة خيار جديد» لتعيين رقم أو كلمة مفتاحية مع رد مخصص."
                />
              ) : (
                <div className="space-y-3">
                  {customOptions.map((opt, idx) => (
                    <Card key={opt.id} className="border border-line/80 bg-panel/80">
                      <CardBody className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 flex-1">
                            <span className="text-xs font-bold px-2 py-1 bg-surface-muted rounded-md text-primary">
                              #{idx + 1}
                            </span>
                            <Input
                              value={opt.title}
                              onChange={(e) => handleUpdateCustomOption(opt.id, { title: e.target.value })}
                              placeholder="عنوان الخيار (مثال: موقع الفرع ورابط الخريطة)"
                              className="text-xs font-medium h-8"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              variant={opt.enabled ? "secondary" : "ghost"}
                              size="sm"
                              onClick={() => handleUpdateCustomOption(opt.id, { enabled: !opt.enabled })}
                              className={cn("h-7 px-2 text-xs", opt.enabled ? "text-emerald-400" : "text-muted")}
                            >
                              {opt.enabled ? "نشط" : "معطل"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveCustomOption(opt.id)}
                              className="h-7 px-2 text-xs text-red hover:bg-red/10"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-1">
                            <label className="text-[11px] font-semibold text-subtle mb-1 block">
                              رقم أو كلمات الاستدعاء (مفصولة بفواصل):
                            </label>
                            <Input
                              value={opt.triggerKey}
                              onChange={(e) => handleUpdateCustomOption(opt.id, { triggerKey: e.target.value })}
                              placeholder="مثال: 6, لوكيشن, موقع"
                              className="text-xs font-mono h-8"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="text-[11px] font-semibold text-subtle mb-1 block">
                              رسالة الرد التلقائي:
                            </label>
                            <textarea
                              rows={2}
                              value={opt.replyMessage}
                              onChange={(e) => handleUpdateCustomOption(opt.id, { replyMessage: e.target.value })}
                              dir="rtl"
                              className="w-full text-xs font-mono p-2 rounded-lg border border-line bg-surface text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary/40 leading-relaxed resize-y"
                              placeholder="اكتب هنا نص الرد التلقائي..."
                            />
                          </div>
                        </div>
                      </CardBody>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---------------- SECTION 4: BOT HANDOVERS (طلبات المحادثة 0) ---------------- */}
          {activeSection === "handovers" && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Headphones className="size-4 text-rose-400" />
                    طلبات المحادثة وتحويل المشتركين للاستقبال (Option 0)
                  </h3>
                  <p className="text-xs text-subtle mt-0.5">
                    العملاء والمشتركون الذين طلبوا التحدث المباشر مع موظف الاستقبال أو الإدارة عبر الواتساب.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg bg-surface-muted/60 p-0.5 border border-line/80 text-xs">
                    <button
                      onClick={() => setHandoverFilter("pending")}
                      className={cn(
                        "px-2.5 py-1 rounded-md font-semibold transition-all",
                        handoverFilter === "pending" ? "bg-rose-500/20 text-rose-400 font-bold" : "text-subtle hover:text-foreground"
                      )}
                    >
                      قيد الانتظار ({handovers.filter((h) => h.status === "pending").length})
                    </button>
                    <button
                      onClick={() => setHandoverFilter("resolved")}
                      className={cn(
                        "px-2.5 py-1 rounded-md font-semibold transition-all",
                        handoverFilter === "resolved" ? "bg-emerald-500/20 text-emerald-400 font-bold" : "text-subtle hover:text-foreground"
                      )}
                    >
                      تم الرد
                    </button>
                    <button
                      onClick={() => setHandoverFilter("all")}
                      className={cn(
                        "px-2.5 py-1 rounded-md font-semibold transition-all",
                        handoverFilter === "all" ? "bg-primary/20 text-primary font-bold" : "text-subtle hover:text-foreground"
                      )}
                    >
                      الكل
                    </button>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => void loadHandovers()} disabled={loadingHandovers}>
                    <RefreshCw className={cn("size-3.5", loadingHandovers && "animate-spin")} />
                  </Button>
                </div>
              </div>

              {handovers.length === 0 ? (
                <EmptyState
                  icon={<Headphones className="size-6 text-emerald-400" />}
                  title="لا توجد طلبات محادثة معلقة حالياً"
                  description="جميع العملاء الذين طلبوا التحدث للاستقبال تم الرد عليهم بنجاح."
                />
              ) : (
                <div className="space-y-2.5">
                  {handovers.map((h) => {
                    const isPending = h.status === "pending";
                    const cleanPhone = h.phone.replace(/[^\d]/g, "");
                    const waLink = `https://wa.me/${cleanPhone.startsWith("0") ? "2" + cleanPhone : cleanPhone}`;

                    return (
                      <Card
                        key={h.id}
                        className={cn(
                          "border p-4 transition-all",
                          isPending ? "border-rose-500/40 bg-rose-500/[0.03]" : "border-line/70 bg-panel/60"
                        )}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground text-sm">{h.customer_name}</span>
                              {h.member_code && (
                                <Badge variant="neutral" className="font-mono text-[10px]">
                                  {h.member_code}
                                </Badge>
                              )}
                              <Badge variant={isPending ? "danger" : "success"} dot className="text-[10px]">
                                {isPending ? "بانتظار الرد البشري" : "تم الرد والتسوية"}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-subtle">
                              <span className="font-mono text-foreground/80">{h.phone}</span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Clock className="size-3" />
                                {h.created_at}
                              </span>
                              {h.resolver_name && (
                                <span className="text-emerald-400">
                                  تم الرد بواسطة: {h.resolver_name}
                                </span>
                              )}
                            </div>
                            {h.last_message && (
                              <p className="text-xs text-foreground/90 bg-surface/60 rounded-lg p-2 border border-line/60 mt-1">
                                💬 «{h.last_message}»
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <a
                              href={waLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-sm transition-all"
                            >
                              <Smartphone className="size-3.5" />
                              <span>فتح المحادثة في واتساب</span>
                            </a>
                            {isPending && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => handleResolveHandover(h.id)}
                                disabled={resolvingId === h.id}
                                className="gap-1 text-xs bg-rose-600 hover:bg-rose-500 text-white"
                              >
                                <CheckCheck className="size-3.5" />
                                <span>تم الرد</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: INTERACTIVE WHATSAPP SMARTPHONE SIMULATOR (5 cols) */}
        <div className="xl:col-span-5 space-y-3 sticky top-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Smartphone className="size-4 text-emerald-400" />
              <span>شاشة المحاكاة المباشرة (WhatsApp Mockup)</span>
            </div>
            <Badge variant="neutral">
              تجربة حية فورية
            </Badge>
          </div>

          {/* Member Picker Context for Simulation */}
          <div className="p-2.5 rounded-xl bg-surface-muted/60 border border-line/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-subtle font-medium flex items-center gap-1">
                <User className="size-3.5 text-primary" />
                هوية المتحدث في المحاكاة:
              </span>
              {simulatorMember ? (
                <button
                  onClick={() => setSimulatorMember(null)}
                  className="text-[11px] text-primary hover:underline font-semibold"
                >
                  إلغاء التحديد (كعميل غير مسجل)
                </button>
              ) : (
                <span className="text-[11px] text-muted">زائر غير مربوط بعضوية</span>
              )}
            </div>

            {simulatorMember ? (
              <div className="flex items-center justify-between p-2 rounded-lg bg-surface border border-line text-xs">
                <div>
                  <div className="font-bold text-foreground">{simulatorMember.fullName}</div>
                  <div className="text-[11px] text-subtle font-mono">
                    {simulatorMember.memberCode} | {simulatorMember.phone || "بدون هاتف"}
                  </div>
                </div>
                <Badge variant="success">
                  عضو مسجل
                </Badge>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={memberPickerSearch}
                  onChange={(e) => setMemberPickerSearch(e.target.value)}
                  placeholder="ابحث باسم أو هاتف عضو لتجربة بياناته في الرد..."
                  className="text-xs h-8"
                />
                {memberPickerResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-panel border border-line rounded-lg shadow-popover z-50 overflow-hidden divide-y divide-line/60">
                    {memberPickerResults.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSimulatorMember(m);
                          setMemberPickerSearch("");
                          setMemberPickerResults([]);
                        }}
                        className="w-full p-2 text-right text-xs hover:bg-surface-muted transition-colors flex items-center justify-between"
                      >
                        <span className="font-semibold text-foreground">{m.fullName}</span>
                        <span className="text-subtle font-mono text-[11px]">{m.memberCode}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Smartphone Shell */}
          <div className="w-full max-w-[360px] mx-auto rounded-[36px] p-3.5 bg-neutral-900 border-[6px] border-neutral-700 shadow-2xl relative overflow-hidden">
            {/* Phone Speaker & Camera Notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-28 h-4 bg-neutral-950 rounded-b-xl flex items-center justify-center gap-2 z-20">
              <div className="w-10 h-1 bg-neutral-800 rounded-full" />
              <div className="size-2 bg-neutral-900 rounded-full border border-neutral-800" />
            </div>

            {/* WhatsApp App Screen */}
            <div className="rounded-[26px] overflow-hidden bg-[#0b141a] text-white flex flex-col h-[520px] relative font-sans">
              {/* WhatsApp Top Header Bar */}
              <div className="bg-[#1f2c34] px-3 pt-6 pb-2.5 flex items-center justify-between border-b border-[#2a3942] z-10">
                <div className="flex items-center gap-2">
                  <div className="size-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shadow-inner">
                    <Bot className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight flex items-center gap-1">
                      <span>بوت الصالة الذكي</span>
                      <CheckCheck className="size-3 text-emerald-400" />
                    </div>
                    <div className="text-[10px] text-emerald-400 leading-none">متصل الآن</div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setChatMessages([]);
                      void handleSendSimulation("قائمة");
                    }}
                    className="h-6 px-1.5 text-[10px] text-subtle hover:text-white"
                    title="مسح وإعادة القائمة"
                  >
                    <RotateCcw className="size-3" />
                  </Button>
                </div>
              </div>

              {/* Chat Messages Area */}
              <div
                ref={chatScrollRef}
                className="flex-1 p-3 overflow-y-auto space-y-2.5 bg-[radial-gradient(#1f2c34_1px,transparent_1px)] [background-size:16px_16px] text-xs"
              >
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex flex-col max-w-[85%] rounded-2xl p-2.5 shadow-sm text-xs relative",
                      msg.sender === "user"
                        ? "ms-auto bg-[#005c4b] text-white rounded-br-xs"
                        : "me-auto bg-[#202c33] text-[#e9edef] rounded-bl-xs"
                    )}
                  >
                    {/* Media preview (e.g. QR code) */}
                    {msg.media?.base64 && (
                      <div className="mb-2 rounded-lg overflow-hidden bg-white p-2 flex items-center justify-center">
                        <img
                          src={`data:${msg.media.mime};base64,${msg.media.base64}`}
                          alt="QR Code"
                          className="size-36 object-contain"
                        />
                      </div>
                    )}

                    <div className="whitespace-pre-wrap leading-relaxed text-[11px] font-sans">
                      {msg.text}
                    </div>

                    <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-[#8696a0]">
                      <span>{msg.time}</span>
                      {msg.sender === "user" && <CheckCheck className="size-3 text-[#53bdeb]" />}
                    </div>
                  </div>
                ))}

                {simulating && (
                  <div className="flex items-center gap-1.5 p-2 rounded-xl bg-[#202c33] text-[#8696a0] me-auto text-xs w-24">
                    <span className="size-1.5 bg-emerald-400 rounded-full animate-bounce" />
                    <span className="size-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="size-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                )}
              </div>

              {/* Quick Quick-Reply Suggestion Pills */}
              <div className="bg-[#1f2c34]/95 p-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-[#2a3942]/60">
                {["قائمة", "1", "2", "3", "4", "5", "0"].map((btn) => (
                  <button
                    key={btn}
                    onClick={() => handleSendSimulation(btn)}
                    disabled={simulating}
                    className="px-2.5 py-1 rounded-full bg-[#2a3942] hover:bg-[#005c4b] text-white text-[10px] font-medium transition-colors shrink-0"
                  >
                    {btn}
                  </button>
                ))}
                {customOptions.map((co) => (
                  <button
                    key={co.id}
                    onClick={() => handleSendSimulation(co.triggerKey.split(",")[0].trim())}
                    disabled={simulating}
                    className="px-2.5 py-1 rounded-full bg-[#2a3942] hover:bg-[#005c4b] text-white text-[10px] font-medium transition-colors shrink-0"
                  >
                    {co.triggerKey.split(",")[0].trim()} ({co.title.slice(0, 8)})
                  </button>
                ))}
              </div>

              {/* Chat Input Bar */}
              <div className="bg-[#1f2c34] p-2 flex items-center gap-1.5 border-t border-[#2a3942]">
                <input
                  type="text"
                  value={simulatedInput}
                  onChange={(e) => setSimulatedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSendSimulation();
                    }
                  }}
                  placeholder="اكتب رسالة تجريبية..."
                  className="flex-1 bg-[#2a3942] text-white placeholder:text-[#8696a0] text-xs px-3 py-2 rounded-full focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  onClick={() => handleSendSimulation()}
                  disabled={simulating || !simulatedInput.trim()}
                  className="size-8 rounded-full bg-[#00a884] hover:bg-[#008f6f] disabled:opacity-40 text-white flex items-center justify-center transition-transform active:scale-95 shrink-0"
                >
                  <Send className="size-3.5 rotate-180" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
