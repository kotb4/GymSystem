import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarPlus,
  Camera,
  CheckCircle2,
  CircleUserRound,
  CreditCard,
  Dumbbell,
  IdCard,
  MessageSquare,
  QrCode,
  RotateCcw,
  ScanLine,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserRound,
  UserRoundCheck,
  UserPlus,
  Users,
  Clock,
  MonitorPlay,
  Zap,
} from "lucide-react";
import { ReceptionKioskPanel } from "./reception-kiosk-panel";
import { QuickDayPassModal } from "./quick-day-pass-modal";
import { LiveOccupantsPanel } from "./live-occupants-panel";
import { MemberFormModal } from "@/components/members/member-form-modal";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/contexts/auth-context";
import { describeError } from "@/utils/app-error";
import { trialPlanLabel } from "@/utils/trial-label";
import { api, type PublicMember } from "@/api";
import type {
  ReceptionLookup,
  ReceptionSearchResult,
} from "@/core/services/reception.service";
import type { CheckInResult } from "@/core/services/attendance.service";
import { diffDaysKeys, todayKey } from "@/core/dates";
import { formatMinor } from "@/core/money";
import { formatTime } from "@/services/format";
import { QuickWhatsAppModal } from "@/components/messages/quick-whatsapp-modal";
import { CardQrDeliveryModal } from "@/components/cards/card-qr-delivery-modal";
import { SubscriptionFormModal } from "@/components/subscriptions/subscription-form-modal";
import { PaymentFormModal } from "@/components/finance/payment-form-modal";
import { SettleMemberDuesModal } from "@/components/finance/settle-member-dues-modal";
import { CameraCapture } from "@/components/ui/camera-capture";
import { CameraBarcodeScannerModal } from "@/components/ui/camera-barcode-scanner-modal";
import { Modal } from "@/components/ui/modal";
import { compressMemberPhoto } from "@/utils/image-compressor";

import { useConfiguredScanner } from "@/hooks/use-configured-scanner";
import { playErrorBuzz, playSuccessChime } from "@/utils/sound";
import { cn } from "@/utils/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { BranchBadge } from "@/components/ui/branch-badge";

const DEBOUNCE_MS = 300;

interface RecentRow {
  id: string;
  memberName: string;
  memberCode: string;
  checkinAt: string;
  branchId?: string | null;
}

export function ReceptionTab() {
  const t = useT();
  const { actor, hasPermission } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [term, setTerm] = useState("");
  const [looking, setLooking] = useState(false);
  const [results, setResults] = useState<ReceptionSearchResult[]>([]);
  const [selected, setSelected] = useState<ReceptionLookup | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitted, setSubmitted] = useState<CheckInResult | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [tick, setTick] = useState(0);

  const navigate = useNavigate();
  const [kioskMode, setKioskMode] = useState(false);
  const [externalKioskBarcode, setExternalKioskBarcode] = useState<string | null>(null);
  const [confirmDeleteRecentRow, setConfirmDeleteRecentRow] = useState<RecentRow | null>(null);
  const [deletingAttendance, setDeletingAttendance] = useState(false);

  const [whatsAppOpen, setWhatsAppOpen] = useState(false);
  const [dayPassOpen, setDayPassOpen] = useState(false);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [registeredMemberForSub, setRegisteredMemberForSub] = useState<PublicMember | null>(null);
  const [activeRightTab, setActiveRightTab] = useState<"live" | "history">("live");
  const [liveOccupantsCount, setLiveOccupantsCount] = useState<number>(0);
  const [telemetry, setTelemetry] = useState<{
    liveOccupants: number;
    todayCheckins: number;
    expiringCount: number;
    dayPassesCount: number;
    pendingDebtMinor: number;
  }>({
    liveOccupants: 0,
    todayCheckins: 0,
    expiringCount: 0,
    dayPassesCount: 0,
    pendingDebtMinor: 0,
  });

  const fetchTelemetry = useCallback(async () => {
    try {
      const today = todayKey();
      const [statsRes, expiringRes, quickRes, debtsRes] = await Promise.allSettled([
        api.dashboard.stats(),
        api.dashboard.expiring(1),
        api.quickSessions.getStats(today),
        api.debts.list({ limit: 1 }),
      ]);

      setTelemetry((prev) => ({
        liveOccupants: statsRes.status === "fulfilled" && statsRes.value ? statsRes.value.occupancyNow : liveOccupantsCount,
        todayCheckins: statsRes.status === "fulfilled" && statsRes.value ? statsRes.value.checkinsToday : recent.length,
        expiringCount: expiringRes.status === "fulfilled" && Array.isArray(expiringRes.value) ? expiringRes.value.length : prev.expiringCount,
        dayPassesCount: quickRes.status === "fulfilled" && quickRes.value ? quickRes.value.guestSessionsToday ?? quickRes.value.totalSessionsToday ?? 0 : prev.dayPassesCount,
        pendingDebtMinor: debtsRes.status === "fulfilled" && debtsRes.value ? debtsRes.value.totalDebtMinor ?? 0 : prev.pendingDebtMinor,
      }));
    } catch {
      // ignore
    }
  }, [liveOccupantsCount, recent.length]);

  useEffect(() => {
    void fetchTelemetry();
  }, [fetchTelemetry, tick]);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrCardData, setQrCardData] = useState<{ barcode: string; cardId: string } | null>(null);
  const [loadingCard, setLoadingCard] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const handleCapturePhoto = async (file: File) => {
    if (!selected?.member || !actor) return;
    setPhotoSaving(true);
    try {
      const compressed = await compressMemberPhoto(file, { maxDimension: 512, quality: 0.82 });
      const { id: fileId } = await api.files.upload("member_photo", compressed);
      await api.members.setMemberPhoto(selected.member.id, fileId);
      toast("success", t("members.photoSaved"));
      setCameraOpen(false);
      void applyLookup({ memberId: selected.member.id });
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setPhotoSaving(false);
    }
  };

  const openCardQr = async () => {
    if (!selected?.member) return;
    setLoadingCard(true);
    try {
      const cards = await api.cards.listForMember(selected.member.id);
      if (cards && cards.length > 0) {
        const c = cards.find((x) => x.status === "assigned") ?? cards[0];
        setQrCardData({ barcode: c.barcodeValue, cardId: c.id });
        setQrModalOpen(true);
      } else {
        toast("warning", t("reception.noCardFound"));
      }
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setLoadingCard(false);
    }
  };

  const reloadRecent = useCallback(() => {
    if (!actor || !hasPermission("checkin.view_history")) return;
    let alive = true;
    api.attendance
      .recent(10)
      .then((rows) => {
        if (!alive) return;
        setRecent(
          (rows as unknown as RecentRow[]).map((r) => ({
            id: r.id,
            memberName: r.memberName,
            memberCode: r.memberCode,
            checkinAt: r.checkinAt,
            branchId: r.branchId,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [actor, hasPermission]);

  useEffect(() => {
    reloadRecent();
  }, [reloadRecent, tick]);

  // Debounced fuzzy search by name / phone / member-code while typing.
  useEffect(() => {
    const value = term.trim();
    if (value === "" || looking) {
      setResults([]);
      return;
    }
    let alive = true;
    const handle = window.setTimeout(() => {
      api.reception
        .search(value)
        .then((res) => {
          if (alive) setResults(res);
        })
        .catch(() => {
          if (alive) setResults([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [term, looking]);

  const applyLookup = useCallback(
    async (input: { barcode?: string; memberId?: string }) => {
      setLooking(true);
      setSubmitted(null);
      setErrorText(null);
      try {
        const lookup = await api.reception.lookup(input);
        setSelected(lookup);
        if (lookup.member && !input.memberId) setTerm(lookup.member.memberCode);
      } catch (err) {
        setErrorText(describeError(err, t));
      } finally {
        setResults([]);
        setLooking(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [t],
  );

  useConfiguredScanner((barcode) => {
    if (barcode.trim() !== "") {
      if (kioskMode) {
        setExternalKioskBarcode(barcode.trim());
      } else {
        setTerm(barcode);
        void applyLookup({ barcode });
      }
    }
  });

  const handleKioskOpenWhatsApp = async (memberId: string) => {
    try {
      const lookup = await api.reception.lookup({ memberId });
      if (lookup.member) {
        setSelected(lookup);
        setWhatsAppOpen(true);
      }
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const handleKioskRenewSub = async (memberId: string) => {
    try {
      const lookup = await api.reception.lookup({ memberId });
      if (lookup.member) {
        setSelected(lookup);
        setSubModalOpen(true);
      }
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const handleKioskPayDebt = async (memberId: string) => {
    try {
      const lookup = await api.reception.lookup({ memberId });
      if (lookup.member) {
        setSelected(lookup);
        setPayModalOpen(true);
      }
    } catch (err) {
      toast("error", describeError(err, t));
    }
  };

  const handleCameraScan = (barcode: string) => {
    if (barcode.trim() !== "") {
      setTerm(barcode.trim());
      void applyLookup({ barcode: barcode.trim() });
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = term.trim();
    if (value === "") return;
    if (selected?.member && value === selected.member.memberCode) return;
    void applyLookup({ barcode: value });
  };

  const pickMember = (memberId: string) => {
    void applyLookup({ memberId });
  };

  const resetAll = () => {
    setTerm("");
    setResults([]);
    setSelected(null);
    setSubmitted(null);
    setErrorText(null);
    setLooking(false);
    setWhatsAppOpen(false);
    setSubModalOpen(false);
    setPayModalOpen(false);
    setQrModalOpen(false);
    inputRef.current?.focus();
  };

  const doCheckIn = async () => {
    if (!selected || !selected.member) return;
    setChecking(true);
    setErrorText(null);
    try {
      const result = await api.reception.checkIn({
        barcode: selected.source === "barcode" && selected.barcode ? selected.barcode : undefined,
        memberId: selected.member.id,
        deviceIdentifier: "reception",
      });
      setSubmitted(result);
      if (result.kind === "success") {
        void api.settings.soundEnabled().then((on) => {
          if (on) playSuccessChime();
        });
        toast("success", t("reception.successSub", { name: result.memberName }));
      } else if (result.kind !== "duplicate") {
        void api.settings.soundEnabled().then((on) => {
          if (on) playErrorBuzz();
        });
      }
      setTick((prev) => prev + 1);
    } catch (err) {
      setErrorText(describeError(err, t));
    } finally {
      setChecking(false);
    }
  };

  const recentColumns: Column<RecentRow>[] = [
    {
      key: "name",
      header: t("common.member"),
      render: (row) => <span className="font-bold">{row.memberName}</span>,
    },
    {
      key: "code",
      header: t("members.code"),
      render: (row) => (
        <span dir="ltr" className="tabnum text-subtle">
          {row.memberCode}
        </span>
      ),
    },
    {
      key: "branch",
      header: t("common.branch"),
      render: (row) => <BranchBadge branchId={row.branchId} />,
    },
    {
      key: "time",
      header: t("common.time"),
      render: (row) => (
        <span className="tabnum text-subtle font-medium">
          {formatTime(row.checkinAt)}
        </span>
      ),
    },
    ...(hasPermission("checkin.delete")
      ? [
          {
            key: "actions",
            header: "",
            render: (row: RecentRow) => (
              <button
                type="button"
                onClick={() => setConfirmDeleteRecentRow(row)}
                className="grid size-7 place-items-center rounded-lg text-subtle transition-colors hover:bg-red/10 hover:text-red"
                title={t("reception.cancelAttendance")}
              >
                <Trash2 className="size-3.5" />
              </button>
            ),
          },
        ]
      : []),
  ];

  const showResultsList = !selected && results.length > 0;

  return (
    <div className="space-y-4">
      {/* Top Reception Hub Bar with Live Occupants Badge & Quick Actions */}
      {!kioskMode && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0F1420]/80 p-3.5 rounded-2xl border border-white/[0.08] shadow-lg backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-neon/20 to-blue-500/10 border border-neon/30 text-neon shadow-glow-sm">
                <ScanLine className="size-5" />
              </div>
              <div>
                <h1 className="text-base font-black text-white tracking-tight flex items-center gap-2">
                  <span>شاشة الاستقبال واليومية</span>
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold font-mono">
                    <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>{liveOccupantsCount || telemetry.liveOccupants} متواجد حالياً</span>
                  </span>
                </h1>
                <p className="text-[11px] text-slate-400 font-medium">
                  مسح الباركود، تذاكر اليوم الواحد السريعة، وإدارة الحضور اللحظي
                </p>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                onClick={() => setKioskMode(true)}
                className="bg-panel border border-neon/40 text-neon hover:bg-neon/15 font-bold text-xs h-9 px-3.5 gap-2 shadow-glow-sm"
              >
                <MonitorPlay className="size-4" />
                <span>كشك الحضور الذاتي 🖥️</span>
              </Button>

              <Button
                type="button"
                onClick={() => setMemberFormOpen(true)}
                className="bg-neon hover:bg-neon/90 text-black font-bold text-xs h-9 px-3.5 gap-2 shadow-glow-sm"
              >
                <UserPlus className="size-4" />
                <span>مشترك جديد ➕</span>
              </Button>
            </div>
          </div>

          {/* Top Telemetry Hub (5 KPI cards with active glow badges) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {/* Card 1: Live Occupants */}
            <button
              type="button"
              onClick={() => setActiveRightTab("live")}
              className={cn(
                "group relative overflow-hidden rounded-2xl border p-3.5 text-start transition-all duration-200",
                "bg-panel/70 backdrop-blur-md hover:scale-[1.01] active:scale-[0.99]",
                activeRightTab === "live"
                  ? "border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.2)] bg-emerald-500/[0.04]"
                  : "border-white/[0.08] hover:border-emerald-500/40 hover:bg-white/[0.04]"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-subtle">المتواجدون الآن</span>
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabnum font-mono text-2xl font-black text-emerald-400">
                  {liveOccupantsCount || telemetry.liveOccupants}
                </span>
                <span className="text-[11px] text-subtle">عضو في الجيم</span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400/80">
                <Users className="size-3" />
                <span>تمرين قيد التقدم</span>
              </div>
            </button>

            {/* Card 2: Today's Attendance */}
            <button
              type="button"
              onClick={() => setActiveRightTab("history")}
              className={cn(
                "group relative overflow-hidden rounded-2xl border p-3.5 text-start transition-all duration-200",
                "bg-panel/70 backdrop-blur-md hover:scale-[1.01] active:scale-[0.99]",
                activeRightTab === "history"
                  ? "border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.2)] bg-cyan-500/[0.04]"
                  : "border-white/[0.08] hover:border-cyan-500/40 hover:bg-white/[0.04]"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-subtle">حضور اليوم</span>
                <div className="size-6 rounded-lg bg-cyan-500/15 text-cyan-400 grid place-items-center">
                  <UserRoundCheck className="size-3.5" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabnum font-mono text-2xl font-black text-cyan-400">
                  {telemetry.todayCheckins}
                </span>
                <span className="text-[11px] text-subtle">تسجيل دخول</span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-cyan-400/80">
                <ScanLine className="size-3" />
                <span>إجمالي الزيارات</span>
              </div>
            </button>

            {/* Card 3: Expiring Soon */}
            <button
              type="button"
              onClick={() => navigate("/reports")}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/70 p-3.5 text-start backdrop-blur-md transition-all duration-200 hover:border-amber-500/50 hover:bg-white/[0.04] hover:scale-[1.01] active:scale-[0.99]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-subtle">تنتهي قريباً</span>
                <div className="size-6 rounded-lg bg-amber-500/15 text-amber-400 grid place-items-center">
                  <Clock className="size-3.5" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabnum font-mono text-2xl font-black text-amber-400">
                  {telemetry.expiringCount}
                </span>
                <span className="text-[11px] text-subtle">اشتراك</span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-400/80">
                <Sparkles className="size-3" />
                <span>تتطلب متابعة وتجديد</span>
              </div>
            </button>

            {/* Card 4: Day Passes */}
            <button
              type="button"
              onClick={() => setDayPassOpen(true)}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/70 p-3.5 text-start backdrop-blur-md transition-all duration-200 hover:border-yellow-500/50 hover:bg-white/[0.04] hover:scale-[1.01] active:scale-[0.99]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-subtle">تذاكر اليوم</span>
                <div className="size-6 rounded-lg bg-yellow-500/15 text-yellow-400 grid place-items-center">
                  <Zap className="size-3.5" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabnum font-mono text-2xl font-black text-yellow-400">
                  {telemetry.dayPassesCount}
                </span>
                <span className="text-[11px] text-subtle">تذكرة مباعة</span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-yellow-400/80">
                <Zap className="size-3" />
                <span>إصدار تذكرة سريعة</span>
              </div>
            </button>

            {/* Card 5: Pending Debts */}
            <button
              type="button"
              onClick={() => navigate("/debts")}
              className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-panel/70 p-3.5 text-start backdrop-blur-md transition-all duration-200 hover:border-rose-500/50 hover:bg-white/[0.04] hover:scale-[1.01] active:scale-[0.99]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-subtle">الديون المعلقة</span>
                <div className="size-6 rounded-lg bg-rose-500/15 text-rose-400 grid place-items-center">
                  <CreditCard className="size-3.5" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="tabnum font-mono text-xl font-black text-rose-400">
                  {formatMinor(telemetry.pendingDebtMinor)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-rose-400/80">
                <ShieldAlert className="size-3" />
                <span>مستحقات على الأعضاء</span>
              </div>
            </button>
          </div>
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          {kioskMode ? (
            <ReceptionKioskPanel
              onExitKiosk={() => setKioskMode(false)}
              onOpenProfile={(memberId) => navigate(`/members/${memberId}`)}
              onOpenWhatsApp={handleKioskOpenWhatsApp}
              onRenewSub={handleKioskRenewSub}
              onPayDebt={handleKioskPayDebt}
              onAttendanceChanged={() => setTick((p) => p + 1)}
              externalBarcode={externalKioskBarcode}
              onExternalBarcodeHandled={() => setExternalKioskBarcode(null)}
            />
          ) : (
            <>
              <Card>
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="text-base font-bold text-foreground">{t("reception.searchTitle")}</h2>
              </div>
              <div className="space-y-4 p-5">
                <p className="text-[13px] text-subtle">{t("reception.searchHint")}</p>
                <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2.5">
                  <div className="min-w-[200px] flex-1">
                    <Input
                      ref={inputRef}
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      placeholder={t("reception.searchPh")}
                      icon={<Search className="size-4" />}
                      disabled={looking}
                      autoFocus
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() => setBarcodeScannerOpen(true)}
                    title={t("reception.cameraScanTitle")}
                    className="gap-2"
                  >
                    <Camera className="size-4 text-neon" />
                    <span>{t("reception.cameraScanBtn")}</span>
                  </Button>
                  <Button type="submit" size="lg" disabled={looking || term.trim() === ""}>
                    <ScanLine className="size-4" />
                    {t("reception.checkin")}
                  </Button>
                </form>

                <button
                  type="button"
                  onClick={resetAll}
                  className="inline-flex items-center gap-1 text-xs font-bold text-neon transition-opacity hover:opacity-80"
                >
                  <RotateCcw className="size-3.5" />
                  {t("reception.reset")}
                </button>
              </div>
            </Card>

        {errorText && (
          <div role="alert" className="rounded-2xl border border-red/30 bg-red/10 px-4 py-3.5 text-sm font-semibold text-red">
            {errorText}
          </div>
        )}

        {submitted?.kind === "success" && submitted.memberName && (
          <ResultBanner
            kind="success"
            title={t("reception.statusValid")}
            sub={t("reception.successSub", { name: submitted.memberName })}
          />
        )}
        {submitted?.kind === "duplicate" && submitted.memberName && (
          <ResultBanner
            kind="warning"
            title={t("reception.alreadyIn")}
            sub={t("reception.duplicateSub", { n: String(submitted.secondsAgo) })}
          />
        )}
        {submitted?.kind === "denied" && submitted.memberName && (
          <ResultBanner
            kind="error"
            title={t(`reception.reasons.${submitted.reason}`)}
            sub={submitted.barcode ? submitted.barcode : ""}
          />
        )}

        {selected?.member && (
          <StatusPanel
            lookup={selected}
            checking={checking}
            onCheckIn={doCheckIn}
            onOpenProfile={() => selected.member && navigate(`/members/${selected.member.id}`)}
            onOpenWhatsApp={() => setWhatsAppOpen(true)}
            onOpenCardQr={openCardQr}
            loadingCard={loadingCard}
            onRenewSub={() => setSubModalOpen(true)}
            onPayDebt={() => setPayModalOpen(true)}
            onTakePhoto={() => setCameraOpen(true)}
            onPreviewPhoto={(url) => setPreviewPhotoUrl(url)}
            onAttendanceChanged={() => {
              setTick((p) => p + 1);
              if (selected.member) void applyLookup({ memberId: selected.member.id });
            }}
          />
        )}

        {!selected && showResultsList && (
          <Card>
            <CardHeader title={t("reception.selectHint")} />
            <ul className="divide-y divide-line p-2">
              {results.map((res) => (
                <SearchRow key={res.member.id} result={res} onSelect={pickMember} />
              ))}
            </ul>
          </Card>
        )}

        {!selected && !showResultsList && !errorText && (
          <Card>
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <span
                aria-hidden
                className="grid size-14 animate-pulse place-items-center rounded-2xl border border-line bg-surface text-faint"
              >
                <ScanLine className="size-6" />
              </span>
              <p className="text-sm font-semibold text-subtle">{t("reception.selectHint")}</p>
            </div>
          </Card>
        )}
          </>
        )}
      </div>

      <div className="space-y-3 xl:col-span-2">
        {/* Segmented Switcher: Live Occupants vs History */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-surface border border-line">
          <button
            type="button"
            onClick={() => setActiveRightTab("live")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all",
              activeRightTab === "live"
                ? "bg-neon/15 text-neon border border-neon/30 shadow-sm"
                : "text-subtle hover:text-ink hover:bg-white/[0.03]"
            )}
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span>المتواجدون الآن</span>
            <span className="font-mono text-[11px] font-bold px-1.5 py-0.2 rounded-full bg-black/40 border border-white/[0.08]">
              {liveOccupantsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveRightTab("history")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all",
              activeRightTab === "history"
                ? "bg-neon/15 text-neon border border-neon/30 shadow-sm"
                : "text-subtle hover:text-ink hover:bg-white/[0.03]"
            )}
          >
            <UserRoundCheck className="size-3.5" />
            <span>سجل حضور اليوم</span>
            <span className="font-mono text-[11px] font-bold px-1.5 py-0.2 rounded-full bg-black/40 border border-white/[0.08]">
              {recent.length}
            </span>
          </button>
        </div>

        {activeRightTab === "live" ? (
          <LiveOccupantsPanel
            tick={tick}
            onOccupancyChange={(cnt) => {
              setLiveOccupantsCount(cnt);
              setTelemetry((p) => ({ ...p, liveOccupants: cnt }));
            }}
          />
        ) : (
          hasPermission("checkin.view_history") && (
            <Card className="h-fit">
              <CardHeader title={t("reception.recent")} />
              {recent.length === 0 ? (
                <EmptyState icon={<UserRoundCheck />} title={t("reception.noRecent")} />
              ) : (
                <DataTable columns={recentColumns} data={recent} rowKey={(r) => r.id} />
              )}
            </Card>
          )
        )}
      </div>

      {selected?.member && (
        <>
          {whatsAppOpen && (
            <QuickWhatsAppModal
              open={whatsAppOpen}
              onClose={() => setWhatsAppOpen(false)}
              memberId={selected.member.id}
            />
          )}

          {payModalOpen && (
            (selected.eligibility?.outstandingMinor ?? 0) > 0 ? (
              <SettleMemberDuesModal
                open={payModalOpen}
                onClose={() => setPayModalOpen(false)}
                member={selected.member}
                onSaved={() => {
                  setPayModalOpen(false);
                  toast("success", t("reception.quickCheckInSuccess"));
                  if (selected.member) void applyLookup({ memberId: selected.member.id });
                }}
              />
            ) : (
              <PaymentFormModal
                open={payModalOpen}
                onClose={() => setPayModalOpen(false)}
                presetMember={selected.member}
                onSaved={() => {
                  setPayModalOpen(false);
                  toast("success", t("reception.quickCheckInSuccess"));
                  if (selected.member) void applyLookup({ memberId: selected.member.id });
                }}
              />
            )
          )}
          {qrModalOpen && qrCardData && (
            <CardQrDeliveryModal
              open={qrModalOpen}
              onClose={() => setQrModalOpen(false)}
              memberName={selected.member.fullName}
              memberPhone={selected.member.phone}
              barcodeValue={qrCardData.barcode}
              cardId={qrCardData.cardId}
              memberId={selected.member.id}
            />
          )}
          {cameraOpen && (
            <CameraCapture
              open={cameraOpen}
              onClose={() => setCameraOpen(false)}
              onCapture={(file) => void handleCapturePhoto(file)}
              captureBusy={photoSaving}
            />
          )}
          {previewPhotoUrl && (
            <Modal
              open={!!previewPhotoUrl}
              onClose={() => setPreviewPhotoUrl(null)}
              title={t("members.photoPreview")}
              widthClass="max-w-md"
            >
              <div className="flex flex-col items-center gap-4">
                <img
                  src={previewPhotoUrl}
                  alt={selected.member.fullName}
                  className="max-h-[65vh] w-auto rounded-2xl border border-line object-contain shadow-lg"
                />
                {hasPermission("members.edit") && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setPreviewPhotoUrl(null);
                      setCameraOpen(true);
                    }}
                  >
                    <Camera className="size-4" />
                    {t("members.photoChange")}
                  </Button>
                )}
              </div>
            </Modal>
          )}
        </>
      )}

      {dayPassOpen && (
        <QuickDayPassModal
          open={dayPassOpen}
          onClose={() => setDayPassOpen(false)}
          onSaved={() => setTick((p) => p + 1)}
        />
      )}

      {memberFormOpen && (
        <MemberFormModal
          open={memberFormOpen}
          onClose={() => setMemberFormOpen(false)}
          onSaved={(newMember) => {
            setMemberFormOpen(false);
            setRegisteredMemberForSub(newMember);
            setSubModalOpen(true);
          }}
        />
      )}

      {subModalOpen && (
        <SubscriptionFormModal
          open={subModalOpen}
          onClose={() => {
            setSubModalOpen(false);
            setRegisteredMemberForSub(null);
          }}
          presetMember={registeredMemberForSub || selected?.member}
          onSaved={() => {
            setSubModalOpen(false);
            toast("success", t("reception.quickCheckInSuccess"));
            const targetId = registeredMemberForSub?.id || selected?.member?.id;
            setRegisteredMemberForSub(null);
            setTick((p) => p + 1);
            if (targetId) void applyLookup({ memberId: targetId });
          }}
        />
      )}

      {barcodeScannerOpen && (
        <CameraBarcodeScannerModal
          open={barcodeScannerOpen}
          onClose={() => setBarcodeScannerOpen(false)}
          onScan={handleCameraScan}
          allowContinuous
        />
      )}

      {confirmDeleteRecentRow && (
        <Modal
          open={!!confirmDeleteRecentRow}
          onClose={() => setConfirmDeleteRecentRow(null)}
          title={t("reception.cancelAttendance")}
          widthClass="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              {t("reception.cancelAttendanceConfirm", { name: confirmDeleteRecentRow.memberName })}
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmDeleteRecentRow(null)}
                disabled={deletingAttendance}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  setDeletingAttendance(true);
                  try {
                    await api.attendance.delete(confirmDeleteRecentRow.id);
                    toast("success", t("reception.cancelAttendanceSuccess"));
                    setConfirmDeleteRecentRow(null);
                    setTick((p) => p + 1);
                  } catch (err) {
                    toast("error", describeError(err, t));
                  } finally {
                    setDeletingAttendance(false);
                  }
                }}
                loading={deletingAttendance}
              >
                {t("reception.cancelAttendance")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
    </div>
  );
}

function SearchRow({
  result,
  onSelect,
}: {
  result: ReceptionSearchResult;
  onSelect: (memberId: string) => void;
}) {
  const t = useT();
  const elig = result.eligibility;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(result.member.id)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition-colors hover:bg-white/[0.04]"
      >
        {result.member.photoFileId ? (
          <img
            src={api.files.url(result.member.photoFileId)}
            alt={result.member.fullName}
            className="size-10 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-faint">
            <CircleUserRound className="size-5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{result.member.fullName}</span>
          <span className="block text-xs text-subtle">
            <span dir="ltr" className="tabnum">
              {result.member.memberCode}
            </span>
            {result.member.phone ? ` · ${result.member.phone}` : ""}
          </span>
        </span>
        <Badge variant={elig.eligible ? "success" : "danger"} dot>
          {t(`reception.reasons.${elig.reason}`)}
        </Badge>
      </button>
    </li>
  );
}

function StatusPanel({
  lookup,
  checking,
  onCheckIn,
  onOpenProfile,
  onOpenWhatsApp,
  onOpenCardQr,
  loadingCard,
  onRenewSub,
  onPayDebt,
  onTakePhoto,
  onPreviewPhoto,
  onAttendanceChanged,
}: {
  lookup: ReceptionLookup;
  checking: boolean;
  onCheckIn: () => void;
  onOpenProfile: () => void;
  onOpenWhatsApp: () => void;
  onOpenCardQr: () => void;
  loadingCard: boolean;
  onRenewSub: () => void;
  onPayDebt: () => void;
  onTakePhoto: () => void;
  onPreviewPhoto: (url: string) => void;
  onAttendanceChanged?: () => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const member = lookup.member!;
  const elig = lookup.eligibility;
  const valid = elig?.eligible ?? false;
  const left = elig?.subscriptionEndsAt != null ? diffDaysKeys(elig.subscriptionEndsAt, todayKey()) : null;

  const [academySubs, setAcademySubs] = useState<
    Array<{ id: string; planName: string; remaining: number | null; total: number | null; used: number }>
  >([]);
  const [deductingSubId, setDeductingSubId] = useState<string | null>(null);

  useEffect(() => {
    if (!member.id) {
      setAcademySubs([]);
      return;
    }
    let alive = true;
    api.subscriptions
      .listForMember(member.id)
      .then((list) => {
        if (!alive) return;
        const activeSessionsSubs = list
          .filter((s) => s.status === "active" && (s.sessionsTotal != null || (s as any).planSessionsCount != null))
          .map((s) => {
            const rawTotal = s.sessionsTotal ?? (s as any).planSessionsCount;
            const total = rawTotal != null ? Number(rawTotal) : null;
            const used = Number(s.sessionsUsed ?? 0);
            const remaining = total !== null ? Math.max(0, total - used) : null;
            return {
              id: s.id,
              planName: String(s.planName || "اشتراك حصص"),
              total,
              used,
              remaining,
            };
          })
          .filter((s) => s.remaining === null || s.remaining > 0);
        setAcademySubs(activeSessionsSubs);
      })
      .catch(console.error);

    return () => {
      alive = false;
    };
  }, [member.id]);

  const handleDeductAcademySession = async (sub: { id: string; planName: string }) => {
    setDeductingSubId(sub.id);
    try {
      const res = await api.classes.recordDirectAttendance({
        memberId: member.id,
        subscriptionId: sub.id,
      });
      toast("success", `تم تسجيل حضور وخصم حصة (${res.memberName}) بنجاح`);
      playSuccessChime();
      onAttendanceChanged?.();
      setAcademySubs((prev) =>
        prev
          .map((s) =>
            s.id === sub.id
              ? {
                  ...s,
                  used: res.sessionsUsed,
                  remaining: res.sessionsRemaining,
                }
              : s,
          )
          .filter((s) => s.remaining === null || s.remaining > 0),
      );
    } catch (err) {
      playErrorBuzz();
      toast("error", describeError(err, t));
    } finally {
      setDeductingSubId(null);
    }
  };

  return (
    <div
      className={cn(
        "animate-pop rounded-2xl border p-5",
        valid ? "border-neon/40 bg-neon/[0.07] shadow-glow-sm" : "border-red/40 bg-red/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="relative shrink-0">
          {member.photoFileId ? (
            <div className="group relative">
              <button
                type="button"
                onClick={() => onPreviewPhoto(api.files.url(member.photoFileId!))}
                className="block overflow-hidden rounded-2xl border-2 border-line/60 shadow-sm transition-transform hover:scale-105"
                title={t("members.photoPreview")}
              >
                <img
                  src={api.files.url(member.photoFileId)}
                  alt={member.fullName}
                  className="size-16 shrink-0 rounded-2xl object-cover sm:size-20"
                />
              </button>
              {hasPermission("members.edit") && (
                <button
                  type="button"
                  onClick={onTakePhoto}
                  className="absolute -bottom-1 -left-1 grid size-6 place-items-center rounded-lg border border-line bg-surface text-subtle shadow-sm transition-colors hover:text-neon"
                  title={t("members.photoChange")}
                >
                  <Camera className="size-3" />
                </button>
              )}
            </div>
          ) : (
            <div className="relative">
              <span
                aria-hidden
                className={cn(
                  "grid size-16 shrink-0 place-items-center rounded-2xl sm:size-20",
                  valid ? "bg-neon/15 text-neon" : "bg-red/15 text-red",
                )}
              >
                <UserRoundCheck className="size-8" />
              </span>
              {hasPermission("members.edit") && (
                <button
                  type="button"
                  onClick={onTakePhoto}
                  className="absolute -bottom-1 -left-1 grid size-7 place-items-center rounded-xl border border-line bg-surface text-neon shadow-sm transition-colors hover:bg-neon/10"
                  title={t("members.takePhoto")}
                >
                  <Camera className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold">{member.fullName}</p>
          <p className="text-[13px] text-subtle">
            <span dir="ltr" className="tabnum">
              {member.memberCode}
            </span>
            {member.phone ? ` · ${member.phone}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={valid ? "success" : "danger"} dot>
            {valid ? t("reception.statusValid") : t("reception.statusInvalid")}
          </Badge>
          <Badge variant="neutral">
            {lookup.source === "barcode" ? t("reception.sourceBarcode") : t("reception.sourceMember")}
          </Badge>
        </div>
      </div>

      {member.notes && member.notes.trim() !== "" && (
        <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-xs text-amber">
          <span className="font-bold shrink-0">{t("members.notes")}:</span>
          <p className="whitespace-pre-line leading-relaxed font-medium text-amber-200">{member.notes}</p>
        </div>
      )}

      {elig ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-line/60 pt-4 text-[13px] sm:grid-cols-3">
          <Info label={t("reception.fieldPlan")} value={trialPlanLabel(elig.planName, t) ?? "—"} />
          {elig.subscriptionEndsAt && (
            <Info label={t("reception.fieldExpiry")} value={elig.subscriptionEndsAt} ltr />
          )}
          {left != null && <Info label={t("reception.fieldRemaining")} value={`${left}`} ltr />}
          {elig.sessionsRemaining != null && (
            <Info label={t("reception.sessionsLeft")} value={`${elig.sessionsRemaining}`} ltr />
          )}
          <Info
            label={t("reception.outstanding")}
            value={formatMinor(elig.outstandingMinor)}
            ltr
            tone={elig.outstandingMinor > 0 ? "red" : undefined}
          />
          <Info
            label={t("reception.lastCheckIn")}
            value={elig.lastCheckInAt ? formatTime(elig.lastCheckInAt) : t("reception.noCheckInYet")}
          />
        </dl>
      ) : (
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 border-t border-line/60 pt-4 text-[13px] sm:grid-cols-2">
          <Info
            label={t("reception.cardStatus")}
            value={
              lookup.cardStatus === "available"
                ? t("cards.statusAvailable")
                : lookup.cardStatus === "assigned"
                  ? t("cards.statusAssigned")
                  : lookup.cardStatus === "lost"
                    ? t("cards.statusLost")
                    : lookup.cardStatus === "blocked"
                      ? t("cards.statusBlocked")
                      : "—"
            }
          />
        </dl>
      )}

      {/* Academy Subscriptions Quick Check-in Banner */}
      {academySubs.length > 0 && (
        <div className="mt-3.5 space-y-2">
          {academySubs.map((sub) => (
            <div
              key={sub.id}
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2.5 text-xs text-cyan-300"
            >
              <div className="flex items-center gap-2">
                <Dumbbell className="size-4 shrink-0 text-cyan-400" />
                <span className="font-bold text-fg">اشتراك أكاديمية نشط:</span>
                <span className="font-bold text-cyan-200">{sub.planName}</span>
                <Badge variant={sub.remaining !== null && sub.remaining <= 1 ? "warning" : "info"} className="text-[10px]">
                  {sub.remaining !== null ? `باقي ${sub.remaining} من ${sub.total} حصص` : "حصص مفتوحة"}
                </Badge>
              </div>
              {hasPermission("checkin.create") && (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  loading={deductingSubId === sub.id}
                  onClick={() => void handleDeductAcademySession(sub)}
                  className="border border-cyan-400/40 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 font-bold text-xs h-7 px-3 gap-1.5 shadow-sm"
                >
                  <span>خصم حصة ({sub.planName})</span>
                  <span>⚡</span>
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dues Breakdown Banner if Member Has Outstanding Balance */}
      {elig && elig.outstandingMinor > 0 && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red/30 bg-red/10 px-3.5 py-2.5 text-xs text-red">
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 shrink-0 text-red" />
            <span className="font-bold">{t("pay.settleTotalOwed")}:</span>
            <span dir="ltr" className="font-mono font-extrabold text-sm">{formatMinor(elig.outstandingMinor)}</span>
          </div>
          {hasPermission("payments.create") && (
            <button
              type="button"
              onClick={onPayDebt}
              className="inline-flex items-center gap-1 rounded-lg bg-red/20 px-2.5 py-1 text-xs font-bold text-red hover:bg-red/30 transition-colors"
            >
              <span>{t("reception.payOutstanding")}</span>
              <span>←</span>
            </button>
          )}
        </div>
      )}

      {/* Quick Actions Bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line/60 pt-4">
        <span className="text-xs font-bold text-subtle">{t("reception.quickActions")}:</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onOpenProfile}
        >
          <UserRound className="size-3.5" />
          {t("reception.viewProfile")}
        </Button>
        {member.phone && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenWhatsApp}
          >
            <MessageSquare className="size-3.5 text-emerald-400" />
            {t("reception.sendWhatsApp")}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onOpenCardQr}
          loading={loadingCard}
        >
          <QrCode className="size-3.5" />
          {t("reception.viewCardQr")}
        </Button>
        {hasPermission("subscriptions.create") && (!valid || (left != null && left <= 5)) && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onRenewSub}
            className="border border-neon/40 bg-neon/15 text-neon hover:bg-neon/25"
          >
            <CalendarPlus className="size-3.5" />
            {t("reception.renewSub")}
          </Button>
        )}
        {hasPermission("payments.create") && elig && elig.outstandingMinor > 0 && (
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onPayDebt}
          >
            <CreditCard className="size-3.5" />
            {t("reception.payOutstanding")} ({formatMinor(elig.outstandingMinor)})
          </Button>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line/60 pt-4">
        <p className={cn("text-[13px] font-semibold", valid ? "text-neon" : "text-red")}>
          {valid
            ? t("reception.validHint")
            : elig
              ? t(`reception.reasons.${elig.reason}`)
              : t("reception.statusInvalid")}
        </p>
        <Button size="lg" onClick={onCheckIn} loading={checking} disabled={checking || !valid}>
          {!checking && <CheckCircle2 className="size-4" />}
          {t("reception.checkin")}
        </Button>
      </div>
    </div>
  );
}

function ResultBanner({
  kind,
  title,
  sub,
}: {
  kind: "success" | "warning" | "error";
  title: string;
  sub: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "animate-pop flex items-center gap-3 rounded-2xl border px-4 py-3.5",
        kind === "success" && "border-neon/40 bg-neon/[0.07]",
        kind === "warning" && "border-amber/40 bg-amber/[0.07]",
        kind === "error" && "border-red/40 bg-red/[0.07]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          kind === "success" && "bg-neon/15 text-neon",
          kind === "warning" && "bg-amber/15 text-amber",
          kind === "error" && "bg-red/15 text-red",
        )}
      >
        {kind === "success" ? (
          <CheckCircle2 className="size-5" />
        ) : kind === "warning" ? (
          <IdCard className="size-5" />
        ) : (
          <ShieldAlert className="size-5" />
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate font-extrabold">{title}</p>
        <p className="truncate text-[13px] text-subtle">{sub}</p>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  ltr,
  tone,
}: {
  label: string;
  value: string;
  ltr?: boolean;
  tone?: "red";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-faint">{label}</dt>
      <dd
        dir={ltr ? "ltr" : undefined}
        className={cn("mt-0.5 truncate font-bold tabnum", tone === "red" && "text-red")}
      >
        {value}
      </dd>
    </div>
  );
}
