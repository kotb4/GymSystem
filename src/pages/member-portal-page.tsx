import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  Users,
  Calendar,
  CreditCard,
  RefreshCw,
  Scale,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  Sparkles,
  AlertTriangle,
  Moon,
  ShieldCheck,
  Copy,
  Download,
  QrCode,
  Wifi,
  Smartphone,
} from "lucide-react";
import {
  api,
  type MemberPortalProfile,
  setStoredServerUrl,
} from "@/api";
import { formatMinor } from "@/core/money";
import { cn } from "@/utils/cn";

interface CachedPass {
  fullName: string;
  memberCode: string;
  planName?: string;
  qrDataUrl?: string;
  gymName?: string;
  cachedAt: string;
}

function extractUrlParam(name: string): string {
  if (typeof window === "undefined") return "";

  // 1. From window.location.search (?token=...)
  const fromSearch = new URLSearchParams(window.location.search).get(name);
  if (fromSearch) return fromSearch.trim();

  // 2. From window.location.hash (#/portal?token=... or #/?token=...)
  const hash = window.location.hash || "";
  const qIndex = hash.indexOf("?");
  if (qIndex !== -1) {
    const fromHash = new URLSearchParams(hash.slice(qIndex)).get(name);
    if (fromHash) return fromHash.trim();
  }

  return "";
}

export function MemberPortalPage() {
  const [searchParams] = useSearchParams();
  const tokenParam = extractUrlParam("token") || searchParams.get("token") || "";
  const serverParam = extractUrlParam("server") || searchParams.get("server") || "";

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<MemberPortalProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isServerClosed, setIsServerClosed] = useState(false);
  const [cachedPass, setCachedPass] = useState<CachedPass | null>(null);

  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [refreshingOccupancy, setRefreshingOccupancy] = useState(false);
  const [occupancyTimestamp, setOccupancyTimestamp] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);

  const [activeCardView, setActiveCardView] = useState<"pass" | "qr">("pass");
  const [showPwaModal, setShowPwaModal] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isPwaInstalled, setIsPwaInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    if (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) {
      setIsPwaInstalled(true);
    }
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") {
          setIsPwaInstalled(true);
        }
        setDeferredPrompt(null);
      } catch {
        setShowPwaModal(true);
      }
    } else {
      setShowPwaModal(true);
    }
  };

  const downloadQrImage = () => {
    const src = qrDataUrl || cachedPass?.qrDataUrl;
    if (!src) return;
    const link = document.createElement("a");
    link.href = src;
    link.download = `GymGate_Pass_${profile?.member.memberCode || cachedPass?.memberCode || "card"}.png`;
    link.click();
  };

  const copyProfileLink = () => {
    void navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Load cached offline pass from localStorage if available
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gymgate_cached_pass");
      if (raw) {
        setCachedPass(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
  }, []);

  // Save server URL if passed in query param
  useEffect(() => {
    if (serverParam && serverParam.trim()) {
      setStoredServerUrl(serverParam.trim());
    }
  }, [serverParam]);

  const loadProfile = useCallback(
    async (token: string) => {
      if (!token || !token.trim()) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setIsServerClosed(false);
      try {
        const res = await api.memberPortal.getProfile({ token: token.trim() });
        setProfile(res);
        setIsServerClosed(false);

        // Store token in localStorage for easy re-visits
        localStorage.setItem("gymgate_member_token", token.trim());
        if (res.member.memberCode) {
          localStorage.setItem("gymgate_client_code", res.member.memberCode);
        }

        // Generate QR Code for reception attendance scanner
        let generatedQr = "";
        try {
          generatedQr = await QRCode.toDataURL(res.member.memberCode, {
            width: 320,
            margin: 2,
            errorCorrectionLevel: "M",
            color: { dark: "#06080D", light: "#ffffff" },
          });
          setQrDataUrl(generatedQr);
        } catch (err) {
          console.error("QR generation failed", err);
        }

        // Cache offline pass
        try {
          const passData: CachedPass = {
            fullName: res.member.fullName,
            memberCode: res.member.memberCode,
            planName: res.subscription?.planName,
            qrDataUrl: generatedQr || undefined,
            gymName: res.gymInfo?.name,
            cachedAt: new Date().toLocaleDateString("ar-EG"),
          };
          localStorage.setItem("gymgate_cached_pass", JSON.stringify(passData));
          setCachedPass(passData);
        } catch {
          // ignore cache error
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err || "");
        console.warn("Profile load error:", msg);

        // Detect if server is offline or unreachable (gym closed / server down)
        const isOffline =
          msg.includes("boot.failed") ||
          msg.includes("Failed to fetch") ||
          msg.includes("NetworkError") ||
          msg.includes("timeout") ||
          msg.includes("ECONNREFUSED") ||
          msg.includes("502") ||
          msg.includes("503");

        if (isOffline) {
          setIsServerClosed(true);
        } else if (msg.includes("portalInvalidToken") || msg.includes("portalTokenRequired")) {
          setError("رابط البروفايل غير صالح أو منتهي الصلاحية. يرجى مراجعة إدارة الجيم.");
        } else if (msg.includes("notFound") || msg.includes("not found")) {
          setError("لم يتم العثور على العضوية المرتبطة بهذا الرابط.");
        } else {
          setError("تعذر فتح ملف العضوية عبر هذا الرابط.");
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Initial Boot: check URL token or stored token
  useEffect(() => {
    const savedToken = localStorage.getItem("gymgate_member_token");
    const effectiveToken = tokenParam || savedToken || "";

    if (effectiveToken) {
      void loadProfile(effectiveToken);
    } else {
      setLoading(false);
    }
  }, [tokenParam, loadProfile]);

  const handleRefreshOccupancy = async () => {
    if (refreshingOccupancy) return;
    setRefreshingOccupancy(true);
    try {
      const res = await api.memberPortal.getLiveOccupancy();
      if (profile) {
        setProfile({ ...profile, liveOccupancyNow: res.occupancyNow });
      }
      setOccupancyTimestamp(res.updatedAt);
    } catch (e) {
      console.error("Live occupancy refresh failed", e);
    } finally {
      setRefreshingOccupancy(false);
    }
  };

  const occupancyCount = profile?.liveOccupancyNow ?? 0;
  const occupancyState =
    occupancyCount <= 5
      ? { text: "الصالة هادئة ومثالية للتمرين 🧘", badge: "هادئ", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" }
      : occupancyCount <= 20
        ? { text: "حركة ونشاط معتدل بالصالة 💪", badge: "معتدل", color: "text-[#00D2FF] border-[#00D2FF]/30 bg-[#00D2FF]/10" }
        : { text: "وقت ذروة الحضور والحماس 🔥", badge: "ذروة", color: "text-amber-400 border-amber-500/30 bg-amber-500/10" };

  return (
    <div className="min-h-screen bg-[#06080D] text-slate-100 flex flex-col font-sans selection:bg-[#0055FF] selection:text-white" dir="rtl">
      {/* Top Banner / Gym & KOTB Branding Header */}
      <header className="border-b border-white/[0.08] bg-[#080B11]/90 backdrop-blur sticky top-0 z-30 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-[#0F1420] border border-[#0055FF]/35 p-1.5 flex items-center justify-center shadow-glow-sm">
              <img
                src="/branding/kotb-k-icon.png"
                alt="KOTB"
                className="size-full object-contain"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold text-white tracking-wide">
                  {profile?.gymInfo.name || cachedPass?.gymName || "GymGate Pass"}
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0055FF]/10 text-[#0055FF] border border-[#0055FF]/30">
                  GymGate
                </span>
              </div>
              <p className="text-[11px] text-[#94A3B8]">
                البوابة الرقمية وبروفايل العضو •{" "}
                <span className="text-[#0055FF] font-medium">Powered by KOTB Digital Solutions</span>
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto p-4 space-y-4">
        {/* Loading Spinner */}
        {loading && (
          <div className="py-20 text-center space-y-3">
            <RefreshCw className="size-8 text-[#0055FF] animate-spin mx-auto" />
            <p className="text-sm text-[#94A3B8]">جارٍ تجهيز ملف العضو وحالة الصالة اللحظية...</p>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SCENARIO A: GYM CLOSED / SERVER OFFLINE SCREEN                      */}
        {/* ------------------------------------------------------------------ */}
        {!loading && isServerClosed && (
          <div className="py-6 space-y-5">
            <div className="relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0F1420] via-[#0F1420]/95 to-amber-950/20 p-6 text-center shadow-card space-y-3">
              <div className="size-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400 shadow-lg">
                <Moon className="size-8" />
              </div>

              <h2 className="text-lg font-black text-white">
                الصالة الرياضية مغلقة حالياً أو السيرفر غير متصل
              </h2>

              <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto">
                جهاز استقبال الجيم غير متصل بالإنترنت حالياً أو أن الصالة في فترة الإغلاق. سنكون سعداء باستقبالك في مواعيد العمل القادمة!
              </p>

              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    const savedToken = localStorage.getItem("gymgate_member_token") || "";
                    void loadProfile(savedToken);
                  }}
                  className="inline-flex items-center gap-2 bg-[#0055FF] hover:bg-[#1E6BFF] active:bg-[#0044CC] text-white font-bold px-5 py-2.5 rounded-xl text-xs shadow-glow-sm border border-[#1E6BFF]/40 active:scale-95 transition"
                >
                  <RefreshCw className="size-3.5" />
                  <span>إعادة المحاولة والتحقق من الاتصال</span>
                </button>
              </div>
            </div>

            {/* Offline Member Card from Local Cache */}
            {cachedPass && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#0F1420] p-4 shadow-card space-y-3">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                  <div>
                    <span className="text-[10px] text-[#00D2FF] font-bold flex items-center gap-1">
                      <ShieldCheck className="size-3.5" />
                      <span>بطاقة عضوية مخزنة بدون إنترنت</span>
                    </span>
                    <h3 className="text-sm font-bold text-white mt-0.5">{cachedPass.fullName}</h3>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#00D2FF]" dir="ltr">
                    {cachedPass.memberCode}
                  </span>
                </div>

                {cachedPass.qrDataUrl && (
                  <div className="flex flex-col items-center justify-center py-2 space-y-1.5">
                    <div className="p-3 bg-white rounded-2xl shadow-card border border-slate-200">
                      <img src={cachedPass.qrDataUrl} alt="QR Code" className="size-40 object-contain" />
                    </div>
                    <p className="text-[11px] text-[#94A3B8] text-center">
                      يمكنك استخدام هذا الرمز لتسجيل حضورك عند الاستقبال
                    </p>
                    <button
                      type="button"
                      onClick={downloadQrImage}
                      className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0055FF]/10 text-[#00D2FF] hover:bg-[#0055FF]/20 border border-[#0055FF]/30 text-xs font-bold transition active:scale-95"
                    >
                      <Download className="size-3.5" />
                      <span>حفظ كصورة</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SCENARIO B: STRICT ACCESS SHIELD (Protected & Encrypted Link Only)  */}
        {/* ------------------------------------------------------------------ */}
        {!loading && !profile && !isServerClosed && (
          <div className="py-12 space-y-6 text-center">
            <div className="relative overflow-hidden rounded-3xl border border-[#0055FF]/35 bg-gradient-to-b from-[#0F1420] via-[#0F1420]/95 to-[#0055FF]/10 p-8 shadow-card space-y-4">
              <div className="size-20 rounded-2xl bg-[#0055FF]/10 border border-[#0055FF]/30 flex items-center justify-center mx-auto text-[#0055FF] shadow-glow-sm">
                <ShieldCheck className="size-10" />
              </div>

              <div className="space-y-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0055FF]/10 px-3 py-1 text-xs font-bold text-[#0055FF] border border-[#0055FF]/30">
                  <span className="size-2 rounded-full bg-[#0055FF] animate-pulse" />
                  رابط مشفر ومحمي 🔒
                </span>
                <h2 className="text-xl font-black text-white">
                  بوابة العضوية محمية ومخصصة للمشتركين فقط
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto">
                  {error || "لا يمكن الدخول إلى هذا البروفايل إلا من خلال الرابط الشخصي والمشفر المرسل لك عبر الواتساب من إدارة الجيم."}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#06080D] border border-white/[0.08] text-xs text-[#94A3B8] text-center leading-relaxed max-w-md mx-auto">
                💡 يرجى مراجعة رسائل الواتساب الخاصة بك والضغط على الرابط الشخصي لمتابعة اشتراكك وبطاقتك الإلكترونية، أو التوجه لمكتب الاستقبال لطلب الرابط المباشر.
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* SCENARIO C: ACTIVE MEMBER PROFILE                                  */}
        {/* ------------------------------------------------------------------ */}
        {!loading && profile && (
          <div className="space-y-4">
            {/* 1. Live Gym Occupancy Card (THE MAIN FEATURE) */}
            <div className="relative overflow-hidden rounded-2xl border border-[#0055FF]/40 bg-gradient-to-br from-[#0F1420] via-[#0F1420]/95 to-[#0055FF]/20 p-4 shadow-card shadow-[#0055FF]/10">
              <div className="absolute -top-12 -left-12 size-36 bg-[#0055FF]/15 rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex size-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0055FF] opacity-75"></span>
                    <span className="relative inline-flex rounded-full size-3 bg-[#0055FF]"></span>
                  </span>
                  <span className="text-xs font-bold text-[#0055FF] tracking-wide uppercase">
                    مباشر الآن بالجيم (Live Floor Occupancy)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleRefreshOccupancy}
                  disabled={refreshingOccupancy}
                  className="flex items-center gap-1.5 text-[11px] text-[#94A3B8] hover:text-white bg-[#161E2E] hover:bg-[#1E293B] px-2.5 py-1 rounded-lg border border-white/[0.08] transition active:scale-95"
                  title="تحديث عدد الحضور الآن"
                >
                  <RefreshCw className={`size-3 text-[#0055FF] ${refreshingOccupancy ? "animate-spin" : ""}`} />
                  <span>تحديث</span>
                </button>
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <div className="text-4xl font-extrabold text-white tracking-tight flex items-baseline gap-2">
                    <span className="text-[#00D2FF] font-mono tabnum">{occupancyCount}</span>
                    <span className="text-sm font-semibold text-slate-300">متدرب بالصالة الآن</span>
                  </div>
                  <p className="text-xs text-[#94A3B8] mt-1 flex items-center gap-1.5">
                    <Users className="size-3.5 text-[#94A3B8]" />
                    <span>{occupancyState.text}</span>
                  </p>
                </div>

                <div className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${occupancyState.color}`}>
                  {occupancyState.badge}
                </div>
              </div>

              {occupancyTimestamp && (
                <div className="mt-3 pt-2.5 border-t border-white/[0.08] flex items-center justify-between text-[10px] text-slate-500">
                  <span>تم التحديث الساعة: {occupancyTimestamp}</span>
                  <span className="text-[#0055FF] font-medium">حضور فعلي مسجل</span>
                </div>
              )}
            </div>

            {/* 2. Official Member Digital Wallet Pass (بطاقة العضوية الرقمية - بتصميم محفظة آبل وجوجل الفخمة) */}
            <div className="relative overflow-hidden rounded-3xl border border-[#0055FF]/40 bg-gradient-to-br from-[#121826] via-[#0A0E17] to-[#04060A] p-5 shadow-[0_16px_50px_rgba(0,85,255,0.2)] text-white space-y-4">
              {/* Holographic light sheen background effect */}
              <div className="absolute -top-24 -right-24 size-64 bg-gradient-to-bl from-[#00D2FF]/15 via-[#0055FF]/10 to-transparent rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-24 -left-24 size-64 bg-gradient-to-tr from-[#0055FF]/20 via-purple-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />

              {/* Card Header: Gym Logo & Brand + Card Switch Tab */}
              <div className="relative z-10 flex items-center justify-between border-b border-white/[0.08] pb-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="size-9 rounded-xl bg-[#06080D] border border-[#0055FF]/40 p-1 flex items-center justify-center shadow-glow-sm">
                    <img src="/branding/kotb-k-icon.png" alt="KOTB" className="size-full object-contain" />
                  </div>
                  <div>
                    <h2 className="text-xs font-black text-white tracking-wide">
                      {profile.gymInfo.name}
                    </h2>
                    <span className="text-[10px] text-[#00D2FF] font-mono font-bold tracking-wider uppercase flex items-center gap-1">
                      <span>VIP MEMBERSHIP PASS</span>
                      <Sparkles className="size-2.5 text-[#00D2FF]" />
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-[#06080D]/80 p-1 rounded-xl border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setActiveCardView("pass")}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1",
                      activeCardView === "pass"
                        ? "bg-[#0055FF] text-white shadow-glow-sm"
                        : "text-slate-400 hover:text-white"
                    )}
                  >
                    <CreditCard className="size-3" />
                    <span>البطاقة</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCardView("qr")}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-bold transition flex items-center gap-1",
                      activeCardView === "qr"
                        ? "bg-[#0055FF] text-white shadow-glow-sm"
                        : "text-slate-400 hover:text-white"
                    )}
                  >
                    <QrCode className="size-3" />
                    <span>رمز الدخول</span>
                  </button>
                </div>
              </div>

              {/* VIEW 1: LUXURY VIP PASS FRONT */}
              {activeCardView === "pass" && (
                <div className="relative z-10 space-y-4 py-1 animate-in fade-in duration-200">
                  {/* Smart Chip & Contactless Wave */}
                  <div className="flex items-center justify-between">
                    {/* Golden EMV Smart Chip */}
                    <div className="relative size-10 rounded-lg bg-gradient-to-br from-[#FFE4A0] via-[#D4AF37] to-[#8C6D2B] p-1 shadow-md border border-[#FFF0BA]/60 flex flex-col justify-between overflow-hidden">
                      <div className="h-0.5 w-full bg-black/35 rounded" />
                      <div className="h-0.5 w-full bg-black/35 rounded" />
                      <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-black/35" />
                    </div>

                    <div className="flex items-center gap-2">
                      <Wifi className="size-5 text-slate-400 rotate-90 opacity-70" />
                      <span
                        className={cn(
                          "px-2.5 py-0.5 rounded-full text-[10px] font-bold border",
                          profile.member.status === "active"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : "bg-red-500/10 text-red-400 border-red-500/30"
                        )}
                      >
                        {profile.member.status === "active" ? "عضوية سارية • Active" : "غير نشطة • Inactive"}
                      </span>
                    </div>
                  </div>

                  {/* Member Details */}
                  <div className="space-y-1">
                    <span className="text-[10px] text-slate-400 font-medium">اسم المشترك / Member Name</span>
                    <h3 className="text-xl font-black text-white tracking-wide">
                      {profile.member.fullName}
                    </h3>
                  </div>

                  {/* Member Code & Plan Info in Metallic Grid */}
                  <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                    <div className="p-2.5 rounded-xl bg-[#06080D]/70 border border-white/[0.08]">
                      <span className="text-[10px] text-slate-400 block">كود العضوية / Member ID</span>
                      <span className="font-black text-[#00D2FF] font-mono tracking-wider text-sm" dir="ltr">
                        {profile.member.memberCode}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#06080D]/70 border border-white/[0.08]">
                      <span className="text-[10px] text-slate-400 block">الباقة / Active Plan</span>
                      <span className="font-bold text-white truncate block">
                        {profile.subscription?.planName || "بدون اشتراك نشط"}
                      </span>
                    </div>
                  </div>

                  {/* Quick switch to QR banner */}
                  <button
                    type="button"
                    onClick={() => setActiveCardView("qr")}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#0055FF]/20 via-[#00D2FF]/15 to-[#0055FF]/20 border border-[#0055FF]/30 hover:border-[#00D2FF]/50 text-xs font-bold text-white flex items-center justify-center gap-2 transition active:scale-98 shadow-sm"
                  >
                    <QrCode className="size-4 text-[#00D2FF]" />
                    <span>عرض رمز الاستجابة السريعة (QR) للدخول بالاستقبال</span>
                  </button>
                </div>
              )}

              {/* VIEW 2: HIGH-DENSITY SCANNING QR PASS */}
              {activeCardView === "qr" && (
                <div className="relative z-10 flex flex-col items-center justify-center py-2 space-y-3 animate-in fade-in duration-200">
                  <div className="p-3.5 bg-white rounded-2xl shadow-2xl border-2 border-white flex flex-col items-center">
                    {qrDataUrl ? (
                      <img src={qrDataUrl} alt={profile.member.memberCode} className="size-52 object-contain" />
                    ) : (
                      <div className="size-52 flex items-center justify-center text-slate-400">
                        <CreditCard className="size-12 animate-pulse text-[#0055FF]" />
                      </div>
                    )}
                    <span className="mt-1 font-mono font-black text-slate-900 text-sm tracking-widest" dir="ltr">
                      {profile.member.memberCode}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 text-center font-medium">
                    وجّه هذا الكود نحو ماسح الاستقبال لتسجيل حضورك في ثانية واحدة ⚡
                  </p>
                </div>
              )}

              {/* Action Buttons Footer */}
              <div className="relative z-10 flex items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={downloadQrImage}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-[#0055FF]/10 text-[#00D2FF] hover:bg-[#0055FF]/20 border border-[#0055FF]/30 text-xs font-bold transition active:scale-95"
                >
                  <Download className="size-3.5" />
                  <span>حفظ البطاقة</span>
                </button>
                <button
                  type="button"
                  onClick={copyProfileLink}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white/[0.05] text-slate-300 hover:text-white hover:bg-white/[0.08] border border-white/[0.08] text-xs font-bold transition active:scale-95"
                >
                  {copiedLink ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                  <span>{copiedLink ? "تم النسخ" : "نسخ الرابط"}</span>
                </button>
                {!isPwaInstalled && (
                  <button
                    type="button"
                    onClick={handleInstallClick}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500/10 to-amber-600/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-bold transition active:scale-95"
                  >
                    <Smartphone className="size-3.5" />
                    <span>تثبيت كتطبيق</span>
                  </button>
                )}
              </div>
            </div>

            {/* 3. Subscription Card (بيانات الاشتراك) */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0F1420] p-4 shadow-card space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <Calendar className="size-4 text-[#0055FF]" />
                <span>بيانات الاشتراك الحالي</span>
              </div>

              {profile.subscription ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-[#06080D] p-3 rounded-xl border border-white/[0.08]">
                    <div>
                      <p className="text-xs text-[#94A3B8]">اسم الخطة / الباقة</p>
                      <p className="text-sm font-bold text-white mt-0.5">{profile.subscription.planName}</p>
                    </div>
                    <div className="text-end">
                      <p className="text-xs text-[#94A3B8]">المدة المتبقية</p>
                      <p className="text-sm font-extrabold text-[#0055FF] mt-0.5">
                        {profile.subscription.daysRemaining} يوم
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-[#06080D] border border-white/[0.06]">
                      <span className="text-[#94A3B8] block text-[11px]">تاريخ البداية:</span>
                      <span className="font-semibold text-slate-200 font-mono" dir="ltr">{profile.subscription.startDate}</span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-[#06080D] border border-white/[0.06]">
                      <span className="text-[#94A3B8] block text-[11px]">تاريخ الانتهاء:</span>
                      <span className="font-semibold text-slate-200 font-mono" dir="ltr">{profile.subscription.endDate}</span>
                    </div>
                  </div>

                  {profile.subscription.sessionsTotal != null && (
                    <div className="p-2.5 rounded-xl bg-[#0055FF]/10 border border-[#0055FF]/30 text-[#00D2FF] text-xs flex items-center justify-between">
                      <span>رصيد الحصص المتبقية:</span>
                      <span className="font-extrabold">
                        {profile.subscription.sessionsRemaining} من {profile.subscription.sessionsTotal} حصة
                      </span>
                    </div>
                  )}

                  {profile.subscription.isFrozen && (
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs text-center">
                      ❄️ هذا الاشتراك مجمد حالياً
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-4 text-center text-xs text-slate-500">
                  لا يوجد اشتراك نشط مسجل حالياً
                </div>
              )}
            </div>

            {/* 4. InBody Assessment (التقييم البدني) */}
            {profile.inbody.latest && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#0F1420] p-4 shadow-card space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Scale className="size-4 text-[#0055FF]" />
                    <span>آخر فحص بدني (InBody)</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono" dir="ltr">
                    {profile.inbody.latest.date}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-[#06080D] p-2 rounded-xl border border-white/[0.08]">
                    <span className="text-[10px] text-[#94A3B8] block">الوزن</span>
                    <span className="text-xs font-bold text-white">
                      {profile.inbody.latest.weightKg ?? "-"} <span className="text-[9px] text-slate-500">كجم</span>
                    </span>
                  </div>
                  <div className="bg-[#06080D] p-2 rounded-xl border border-white/[0.08]">
                    <span className="text-[10px] text-[#94A3B8] block">الدهون</span>
                    <span className="text-xs font-bold text-amber-400">
                      {profile.inbody.latest.bodyFatPercent != null ? `${profile.inbody.latest.bodyFatPercent}%` : "-"}
                    </span>
                  </div>
                  <div className="bg-[#06080D] p-2 rounded-xl border border-white/[0.08]">
                    <span className="text-[10px] text-[#94A3B8] block">العضلات</span>
                    <span className="text-xs font-bold text-[#00D2FF]">
                      {profile.inbody.latest.muscleMassKg ?? "-"} <span className="text-[9px] text-slate-500">كجم</span>
                    </span>
                  </div>
                  <div className="bg-[#06080D] p-2 rounded-xl border border-white/[0.08]">
                    <span className="text-[10px] text-[#94A3B8] block">BMI</span>
                    <span className="text-xs font-bold text-white">
                      {profile.inbody.latest.bmi ?? "-"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 5. Recent Attendance (سجل الحضور) */}
            {profile.attendance.length > 0 && (
              <div className="rounded-2xl border border-white/[0.08] bg-[#0F1420] p-4 shadow-card space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <Clock className="size-4 text-[#0055FF]" />
                  <span>سجل الحضور الأخير ({profile.attendance.length} زيارات)</span>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {profile.attendance.slice(0, 5).map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center justify-between text-xs bg-[#06080D] px-3 py-2 rounded-xl border border-white/[0.06]"
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="size-3.5 text-emerald-400" />
                        <span className="font-semibold text-slate-200 font-mono" dir="ltr">{att.date}</span>
                      </div>
                      <div className="text-[#94A3B8] text-[11px] font-mono" dir="ltr">
                        {att.checkinTime} {att.checkoutTime ? `→ ${att.checkoutTime}` : "(بالصالة)"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Outstanding Debt Notice (إن وُجد) */}
            {profile.totalDebtMinor > 0 && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-red-400">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span>متبقي مديونية متجر / حساب:</span>
                </div>
                <span className="font-extrabold text-red-400 font-mono">
                  {formatMinor(profile.totalDebtMinor)} ج.م
                </span>
              </div>
            )}

            {/* 7. Gym Information & KOTB Digital Solutions Attribution Footer */}
            <div className="rounded-2xl border border-white/[0.08] bg-[#0F1420] p-4 text-center space-y-3 text-xs text-[#94A3B8] shadow-card">
              <p className="font-extrabold text-white text-sm">{profile.gymInfo.name}</p>
              {profile.gymInfo.address && (
                <p className="flex items-center justify-center gap-1.5 text-[11px]">
                  <MapPin className="size-3 text-slate-500" />
                  <span>{profile.gymInfo.address}</span>
                </p>
              )}
              {profile.gymInfo.phone && (
                <p className="flex items-center justify-center gap-1.5 text-[11px]" dir="ltr">
                  <Phone className="size-3 text-slate-500" />
                  <span>{profile.gymInfo.phone}</span>
                </p>
              )}

              {/* Developer Attribution Card */}
              <div className="pt-3 border-t border-white/[0.08] flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-2">
                  <img src="/branding/kotb-logo.png" alt="KOTB Digital Solutions" className="h-5 object-contain" />
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0055FF]/10 text-[#0055FF] border border-[#0055FF]/30">
                    GymGate
                  </span>
                </div>
                <p className="text-[11px] text-white font-medium">
                  GymGate — Powered by KOTB Digital Solutions
                </p>
                <p className="text-[11px] text-[#94A3B8]">
                  قُطب للحلول الرقمية • Enterprise System Architecture © 2026
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* PWA Install Guide Modal (دليل حفظ البطاقة كتطبيق على الهاتف) */}
      {showPwaModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200" dir="rtl">
          <div className="bg-[#0F1420] border border-white/[0.12] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-start">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <Smartphone className="size-4 text-[#0055FF]" />
                <span>تثبيت بطاقة العضوية على هاتفك</span>
              </div>
              <button
                type="button"
                onClick={() => setShowPwaModal(false)}
                className="size-7 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-slate-400 flex items-center justify-center text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="p-3 rounded-2xl bg-[#06080D] border border-white/[0.06] space-y-2">
                <span className="font-bold text-[#00D2FF] flex items-center gap-1.5">
                  <span>📱 لهواتف iPhone (متصفح Safari):</span>
                </span>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 pr-1">
                  <li>اضغط على زر المشاركة <strong>(Share ⎋)</strong> أسفل المتصفح.</li>
                  <li>مرر للأسفل واضغط <strong>«إضافة إلى الشاشة الرئيسية» (Add to Home Screen)</strong>.</li>
                  <li>اضغط «إضافة» لتظهر أيقونة الجيم بجانب تطبيقاتك!</li>
                </ol>
              </div>

              <div className="p-3 rounded-2xl bg-[#06080D] border border-white/[0.06] space-y-2">
                <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                  <span>🤖 لهواتف Android (متصفح Chrome):</span>
                </span>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 pr-1">
                  <li>اضغط على النقاط الثلاث <strong>(⋮)</strong> أعلى يسار/يمين المتصفح.</li>
                  <li>اختر <strong>«تثبيت التطبيق» (Install app)</strong> أو «إضافة إلى الشاشة الرئيسية».</li>
                  <li>اضغط «تثبيت» ليتم حفظ البطاقة فوراً والوصول لها بضغطة زر.</li>
                </ol>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowPwaModal(false)}
              className="w-full py-2.5 rounded-xl bg-[#0055FF] hover:bg-[#1E6BFF] text-white font-bold text-xs shadow-glow-sm transition"
            >
              فهمت ذلك، شكراً!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MemberPortalPage;
