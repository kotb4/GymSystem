import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  Camera,
  CameraOff,
  CircleUserRound,
  Clock,
  CreditCard,
  MessageSquare,
  RefreshCw,
  ScanLine,
  Trash2,
  Undo2,
  UserRound,
  X,
  XCircle,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useT } from "@/i18n";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import { describeError } from "@/utils/app-error";
import { api } from "@/api";
import type { CheckInResult } from "@/core/services/attendance.service";
import { formatMinor } from "@/core/money";
import { diffDaysKeys, todayKey } from "@/core/dates";
import { trialPlanLabel } from "@/utils/trial-label";
import { playErrorBuzz, playScanBeep, playSuccessChime } from "@/utils/sound";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { useConfiguredScanner } from "@/hooks/use-configured-scanner";
import { normalizeBarcodeString } from "@/core/barcode/barcode-input";

interface DetectedBarcode {
  rawValue: string;
  format?: string;
}

const PREFERRED_CAM_KEY = "gym_preferred_scanner_cam_id";
const SCAN_INTERVAL_MS = 100;
const DUPLICATE_COOLDOWN_MS = 3500;
const COUNTDOWN_SECONDS = 4;

export interface ReceptionKioskPanelProps {
  onExitKiosk: () => void;
  onOpenProfile: (memberId: string) => void;
  onOpenWhatsApp: (memberId: string) => void;
  onRenewSub: (memberId: string) => void;
  onPayDebt: (memberId: string) => void;
  onAttendanceChanged: () => void;
  /** Injected handler for external hardware scanner input */
  externalBarcode?: string | null;
  onExternalBarcodeHandled?: () => void;
}

export function ReceptionKioskPanel({
  onExitKiosk,
  onOpenProfile,
  onOpenWhatsApp,
  onRenewSub,
  onPayDebt,
  onAttendanceChanged,
  externalBarcode,
  onExternalBarcodeHandled,
}: ReceptionKioskPanelProps) {
  const t = useT();
  const { hasPermission } = useAuth();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const lastScannedCodeRef = useRef<string>("");
  const countdownTimerRef = useRef<number | null>(null);

  const [scanMode, setScanMode] = useState<"reader" | "camera">("reader");
  const [cameraActive, setCameraActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem(PREFERRED_CAM_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const inputScannerRef = useRef<HTMLInputElement>(null);
  const [manualBarcodeInput, setManualBarcodeInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [activeResult, setActiveResult] = useState<CheckInResult | null>(null);
  const [activeBarcode, setActiveBarcode] = useState<string>("");
  const [countdown, setCountdown] = useState<number>(0);
  const [attendanceDeleted, setAttendanceDeleted] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        }
        setIsFullscreen(true);
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen((p) => !p);
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Stop camera media stream
  const stopStream = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => {
        try {
          tr.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  // Start camera media stream
  const startStream = useCallback(
    async (deviceIdToUse?: string) => {
      setCameraError(null);
      setReady(false);
      stopStream();

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(t("reception.cameraUnsupported"));
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: deviceIdToUse
            ? {
                deviceId: { exact: deviceIdToUse },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          // Fallback to generic video constraints
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }

        if (navigator.mediaDevices.enumerateDevices) {
          const all = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = all
            .filter((d) => d.kind === "videoinput")
            .map((d, idx) => ({
              deviceId: d.deviceId,
              label: d.label || `${t("reception.cameraDevice")} ${idx + 1}`,
            }));
          setDevices(videoInputs);

          const activeTrack = stream.getVideoTracks()[0];
          const activeDeviceId = activeTrack?.getSettings?.()?.deviceId;
          if (activeDeviceId && !deviceIdToUse) {
            setSelectedDeviceId(activeDeviceId);
            try {
              localStorage.setItem(PREFERRED_CAM_KEY, activeDeviceId);
            } catch {
              // ignore
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.name : "";
        if (message === "NotAllowedError" || message === "PermissionDeniedError") {
          setCameraError(t("reception.cameraPermissionDenied"));
        } else if (message === "NotFoundError" || message === "DevicesNotFoundError") {
          setCameraError(t("reception.cameraNotFound"));
        } else {
          setCameraError(t("reception.cameraUnsupported"));
        }
      }
    },
    [stopStream, t],
  );

  // Initialize and clean up camera stream
  useEffect(() => {
    if (cameraActive) {
      void startStream(selectedDeviceId || undefined);
    } else {
      stopStream();
    }
    return () => {
      stopStream();
    };
  }, [cameraActive, selectedDeviceId, startStream, stopStream]);

  // Countdown timer handler: counts down from 20 to 0
  const startCountdown = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
    }
    setCountdown(COUNTDOWN_SECONDS);
    countdownTimerRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownTimerRef.current !== null) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          setActiveResult(null);
          setAttendanceDeleted(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Dismiss result manually
  const dismissResult = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setActiveResult(null);
    setAttendanceDeleted(false);
    setCountdown(0);
  }, []);

  // Central check-in processor (for both camera and hardware barcode scanner)
  const processBarcode = useCallback(
    async (code: string) => {
      const clean = normalizeBarcodeString(code.trim()).toUpperCase();
      if (!clean || processing) return;

      const now = Date.now();
      if (lastScannedCodeRef.current === clean && now - lastScanTimeRef.current < DUPLICATE_COOLDOWN_MS) {
        return;
      }
      lastScannedCodeRef.current = clean;
      lastScanTimeRef.current = now;

      // Scan optical feedback
      playScanBeep();
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate([70, 40, 70]);
        } catch {
          // ignore
        }
      }

      setProcessing(true);
      setActiveBarcode(clean);
      setAttendanceDeleted(false);

      try {
        const result = await api.reception.checkIn({
          barcode: clean,
          deviceIdentifier: "auto-kiosk",
        });

        setActiveResult(result);
        startCountdown();

        if (result.kind === "success") {
          if (!soundMuted) {
            playSuccessChime();
          }
          onAttendanceChanged();
        } else {
          // Denied or duplicate
          if (!soundMuted) {
            playErrorBuzz();
          }
        }
      } catch (err) {
        toast("error", describeError(err, t));
        if (!soundMuted) {
          playErrorBuzz();
        }
      } finally {
        setProcessing(false);
      }
    },
    [onAttendanceChanged, processing, startCountdown, t, toast],
  );

  // Handle external barcode scanner input
  useEffect(() => {
    if (externalBarcode && externalBarcode.trim() !== "") {
      void processBarcode(externalBarcode);
      onExternalBarcodeHandled?.();
    }
  }, [externalBarcode, onExternalBarcodeHandled, processBarcode]);

  // Keep scanner input continuously focused in reader mode so members can scan back-to-back
  useEffect(() => {
    if (scanMode !== "reader") return;
    const focusInput = () => {
      if (document.activeElement !== inputScannerRef.current) {
        inputScannerRef.current?.focus();
      }
    };
    focusInput();
    const interval = window.setInterval(focusInput, 1000);
    return () => window.clearInterval(interval);
  }, [scanMode, activeResult]);

  // Direct hardware scanner integration — works even when an <input> is focused.
  // Also clears the manual input field so scanner chars that leaked into it don't linger.
  useConfiguredScanner((barcode) => {
    const normalized = normalizeBarcodeString(barcode.trim());
    if (normalized !== "") {
      setManualBarcodeInput("");
      void processBarcode(normalized);
    }
  });

  // Auto-submit when the manual input hasn't changed for 400 ms (handles readers that
  // don't send Enter — after the last char the 400 ms timer fires the check-in).
  useEffect(() => {
    const val = manualBarcodeInput.trim();
    if (!val) return;
    const timer = window.setTimeout(() => {
      void processBarcode(val);
      setManualBarcodeInput("");
    }, 400);
    return () => window.clearTimeout(timer);
  }, [manualBarcodeInput, processBarcode]);


  useEffect(() => {
    if (!cameraActive || !ready) return;

    const BarcodeDetectorClass = (window as unknown as {
      BarcodeDetector?: new (options?: { formats: string[] }) => {
        detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
      };
    }).BarcodeDetector;

    if (!BarcodeDetectorClass) {
      setCameraError(t("reception.cameraUnsupported"));
      return;
    }

    let detector: InstanceType<typeof BarcodeDetectorClass>;
    try {
      detector = new BarcodeDetectorClass({
        formats: [
          "qr_code",
          "code_128",
          "code_39",
          "code_93",
          "ean_13",
          "ean_8",
          "upc_a",
          "upc_e",
          "codabar",
          "data_matrix",
          "aztec",
          "pdf417",
        ],
      });
    } catch {
      detector = new BarcodeDetectorClass();
    }

    let lastTick = 0;
    let running = true;

    const scanFrame = async (timestamp: number) => {
      if (!running) return;

      if (timestamp - lastTick >= SCAN_INTERVAL_MS) {
        lastTick = timestamp;
        const video = videoRef.current;
        if (
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          video.videoHeight > 0
        ) {
          try {
            const results = await detector.detect(video);
            if (results && results.length > 0) {
              const code = results[0]?.rawValue?.trim();
              if (code) {
                void processBarcode(code);
              }
            }
          } catch {
            // detection frame skipped
          }
        }
      }

      if (running) {
        animFrameRef.current = requestAnimationFrame(scanFrame);
      }
    };

    animFrameRef.current = requestAnimationFrame(scanFrame);

    return () => {
      running = false;
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [cameraActive, processBarcode, ready, t]);

  // Delete attendance check-in
  const handleCancelAttendance = async () => {
    if (!activeResult || activeResult.kind !== "success") return;
    setActionBusy(true);
    try {
      await api.attendance.delete(activeResult.attendanceId);
      setAttendanceDeleted(true);
      setConfirmCancelOpen(false);
      toast("success", t("reception.cancelAttendanceSuccess"));
      onAttendanceChanged();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionBusy(false);
    }
  };

  // Restore attendance check-in
  const handleRestoreAttendance = async () => {
    if (!activeResult || activeResult.kind !== "success") return;
    setActionBusy(true);
    try {
      await api.attendance.restore(activeResult.attendanceId);
      setAttendanceDeleted(false);
      toast("success", t("reception.restoreAttendanceSuccess"));
      onAttendanceChanged();
    } catch (err) {
      toast("error", describeError(err, t));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeviceChange = (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    try {
      localStorage.setItem(PREFERRED_CAM_KEY, newDeviceId);
    } catch {
      // ignore
    }
    void startStream(newDeviceId);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "space-y-4 transition-all duration-300",
        isFullscreen && "fixed inset-0 z-50 bg-[#070A11] p-6 overflow-y-auto"
      )}
    >
      {/* Top Kiosk Header / Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neon/30 bg-neon/[0.04] p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="relative flex size-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neon opacity-75" />
            <span className="relative inline-flex size-3.5 rounded-full bg-neon" />
          </span>
          <div>
            <h2 className="text-base font-extrabold text-foreground flex items-center gap-2">
              <span>{t("reception.autoKioskTitle")}</span>
              {isFullscreen && (
                <span className="px-2 py-0.5 rounded-full bg-neon/15 border border-neon/30 text-neon text-[10px] font-bold">
                  وضع ملء الشاشة المستقل
                </span>
              )}
            </h2>
            <p className="text-xs text-subtle">{t("reception.autoKioskSub")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle between Reader vs Camera */}
          <div className="flex items-center rounded-xl border border-line bg-surface/80 p-0.5">
            <button
              type="button"
              onClick={() => {
                setScanMode("reader");
                setCameraActive(false);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                scanMode === "reader"
                  ? "bg-neon/15 text-neon shadow-sm"
                  : "text-subtle hover:text-foreground",
              )}
            >
              <ScanLine className="size-3.5" />
              <span>{t("reception.autoKioskSourceReader")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setScanMode("camera");
                setCameraActive(true);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                scanMode === "camera"
                  ? "bg-neon/15 text-neon shadow-sm"
                  : "text-subtle hover:text-foreground",
              )}
            >
              <Camera className="size-3.5" />
              <span>{t("reception.autoKioskSourceCamera")}</span>
            </button>
          </div>

          {scanMode === "camera" && devices.length > 1 && (
            <div className="min-w-[170px]">
              <Select
                value={selectedDeviceId}
                onChange={(e) => handleDeviceChange(e.target.value)}
                options={devices.map((d) => ({ value: d.deviceId, label: d.label }))}
                aria-label={t("reception.cameraDevice")}
                className="h-8 text-xs"
              />
            </div>
          )}

          {scanMode === "camera" && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCameraActive((prev) => !prev)}
              title={cameraActive ? t("reception.autoKioskCameraPause") : t("reception.autoKioskCameraOff")}
              className="gap-1.5"
            >
              {cameraActive ? (
                <>
                  <Camera className="size-3.5 text-neon" />
                  <span>{t("reception.autoKioskCameraPause")}</span>
                </>
              ) : (
                <>
                  <CameraOff className="size-3.5 text-subtle" />
                  <span>{t("reception.autoKioskCameraOff")}</span>
                </>
              )}
            </Button>
          )}

          {/* Sound Feedback Chimes Toggle */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setSoundMuted((m) => !m)}
            title={soundMuted ? "تفعيل النغمات الصوتية" : "كتم النغمات الصوتية"}
            className={cn("gap-1.5 border-line", !soundMuted && "border-neon/40 text-neon bg-neon/[0.08]")}
          >
            {soundMuted ? <VolumeX className="size-3.5 text-subtle" /> : <Volume2 className="size-3.5 text-neon" />}
            <span className="hidden sm:inline">{soundMuted ? "صامت" : "صوت المسح"}</span>
          </Button>

          {/* Native Fullscreen Toggle */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={toggleFullscreen}
            title={isFullscreen ? "إنهاء ملء الشاشة (Esc)" : "وضع ملء الشاشة المستقل"}
            className={cn("gap-1.5 border-line", isFullscreen ? "border-neon/50 bg-neon/15 text-neon font-bold shadow-glow-sm" : "hover:border-neon/30 hover:text-foreground")}
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            <span>{isFullscreen ? "إنهاء ملء الشاشة" : "ملء الشاشة"}</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onExitKiosk}
            className="gap-1.5 border-line hover:border-red/40 hover:text-red"
          >
            <X className="size-3.5" />
            <span>{t("reception.autoKioskExit")}</span>
          </Button>
        </div>
      </div>

      {/* Main Kiosk Content Area */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left / Camera Viewport (5 cols) - only shown when Camera mode is selected */}
        {scanMode === "camera" && (
          <div className="lg:col-span-5">
          <div className="relative overflow-hidden rounded-2xl border border-line bg-black/80 shadow-lg">
            {/* Live Camera Video */}
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className={cn(
                  "size-full object-cover transition-opacity duration-300",
                  ready && cameraActive ? "opacity-100" : "opacity-0",
                )}
              />

              {/* Laser Scan Line Animation when active */}
              {ready && cameraActive && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className="animate-scan-line absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-neon to-transparent shadow-[0_0_12px_#00f0ff]" />
                  {/* Targeting Reticle Corners */}
                  <div className="absolute inset-8 rounded-2xl border border-neon/30 pointer-events-none">
                    <span className="absolute -top-1 -left-1 size-4 border-t-2 border-l-2 border-neon" />
                    <span className="absolute -top-1 -right-1 size-4 border-t-2 border-r-2 border-neon" />
                    <span className="absolute -bottom-1 -left-1 size-4 border-b-2 border-l-2 border-neon" />
                    <span className="absolute -bottom-1 -right-1 size-4 border-b-2 border-r-2 border-neon" />
                  </div>
                </div>
              )}

              {/* Camera Offline / Error State */}
              {(!ready || !cameraActive || cameraError) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="grid size-12 place-items-center rounded-2xl border border-line bg-surface/80 text-subtle shadow-sm">
                    {cameraError ? (
                      <AlertTriangle className="size-6 text-amber" />
                    ) : (
                      <CameraOff className="size-6 text-faint" />
                    )}
                  </div>
                  <p className="max-w-xs text-xs font-semibold text-subtle">
                    {cameraError ||
                      (!cameraActive
                        ? t("reception.autoKioskCameraPause")
                        : t("reception.cameraNotFound"))}
                  </p>
                  {cameraError && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void startStream(selectedDeviceId || undefined)}
                      className="gap-1.5 text-xs"
                    >
                      <RefreshCw className="size-3.5" />
                      <span>{t("common.retry")}</span>
                    </Button>
                  )}
                </div>
              )}

              {/* Processing Overlay */}
              {processing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs">
                  <div className="flex items-center gap-2 rounded-xl border border-neon/40 bg-surface/90 px-4 py-2 text-xs font-bold text-neon shadow-lg">
                    <RefreshCw className="size-4 animate-spin" />
                    <span>{t("reception.autoKioskProcessing")}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Status strip */}
            <div className="flex items-center justify-between border-t border-line/40 bg-surface/90 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    ready && cameraActive ? "bg-neon" : "bg-zinc-500",
                  )}
                />
                <span className="font-semibold text-subtle">
                  {ready && cameraActive
                    ? t("reception.autoKioskCameraActive")
                    : t("reception.autoKioskCameraOff")}
                </span>
              </div>
              <span className="font-mono text-[11px] text-faint">
                {activeBarcode ? `[${activeBarcode}]` : "Ready"}
              </span>
            </div>
          </div>
        </div>
        )}

        {/* Right / Live Check-In Card & Actions */}
        <div className={cn(scanMode === "camera" ? "lg:col-span-7" : "lg:col-span-12")}>
          {activeResult ? (
            <div
              className={cn(
                "relative flex h-full flex-col justify-between rounded-2xl border p-5 transition-all shadow-md",
                activeResult.kind === "success"
                  ? "border-neon/40 bg-neon/[0.06] shadow-glow-sm"
                  : activeResult.kind === "duplicate"
                    ? "border-amber/40 bg-amber/[0.06]"
                    : "border-red/40 bg-red/[0.06]",
              )}
            >
              <div>
                {/* 20-Second Countdown Banner */}
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-line/60 pb-3.5">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-neon animate-pulse" />
                    <span className="text-xs font-bold text-foreground">
                      {t("reception.autoKioskTimer", { seconds: String(countdown) })}
                    </span>
                    <Badge variant="neutral" className="font-mono text-[11px]">
                      {countdown}s
                    </Badge>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={dismissResult}
                    className="h-7 gap-1 px-2.5 text-xs text-subtle hover:text-foreground"
                  >
                    <X className="size-3" />
                    <span>{t("reception.autoKioskDismiss")}</span>
                  </Button>
                </div>

                {/* Member Header / Photo & Name */}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="relative shrink-0">
                    {activeResult.photoFileId ? (
                      <img
                        src={api.files.url(activeResult.photoFileId)}
                        alt={activeResult.memberName || ""}
                        className="size-16 rounded-2xl border-2 border-line/80 object-cover shadow-sm sm:size-20"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-16 place-items-center rounded-2xl shadow-sm sm:size-20",
                          activeResult.kind === "success"
                            ? "bg-neon/15 text-neon"
                            : activeResult.kind === "duplicate"
                              ? "bg-amber/15 text-amber"
                              : "bg-red/15 text-red",
                        )}
                      >
                        <CircleUserRound className="size-10" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-xl font-extrabold text-foreground">
                      {activeResult.memberName || activeBarcode || "—"}
                    </h3>
                    <p className="mt-0.5 text-xs text-subtle">
                      {"memberCode" in activeResult && activeResult.memberCode && (
                        <span dir="ltr" className="tabnum font-mono font-semibold">
                          {activeResult.memberCode}
                        </span>
                      )}
                      {"barcode" in activeResult && activeResult.barcode && (
                        <span dir="ltr" className="tabnum font-mono font-semibold ms-2">
                          {activeResult.barcode}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    {attendanceDeleted ? (
                      <Badge variant="danger" dot>
                        {t("reception.cancelAttendanceSuccess")}
                      </Badge>
                    ) : activeResult.kind === "success" ? (
                      <Badge variant="success" dot>
                        {t("reception.statusValid")}
                      </Badge>
                    ) : activeResult.kind === "duplicate" ? (
                      <Badge variant="warning" dot>
                        {t("reception.alreadyIn")}
                      </Badge>
                    ) : (
                      <Badge variant="danger" dot>
                        {t(`reception.reasons.${activeResult.reason}`)}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Subscriptions / Assessment Info if Success */}
                {activeResult.kind === "success" && (
                  <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-line/60 pt-4 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-[11px] font-semibold text-faint">
                        {t("reception.fieldPlan")}
                      </dt>
                      <dd className="mt-0.5 truncate font-bold">
                        {trialPlanLabel(activeResult.planName, t) ?? "—"}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-[11px] font-semibold text-faint">
                        {t("reception.fieldExpiry")}
                      </dt>
                      <dd dir="ltr" className="mt-0.5 truncate font-bold font-mono">
                        {activeResult.subscriptionEndsAt || "—"}
                      </dd>
                    </div>

                    {activeResult.subscriptionEndsAt && (
                      <div>
                        <dt className="text-[11px] font-semibold text-faint">
                          {t("reception.fieldRemaining")}
                        </dt>
                        <dd dir="ltr" className="mt-0.5 font-bold font-mono">
                          {diffDaysKeys(activeResult.subscriptionEndsAt, todayKey())}{" "}
                          {t("common.days")}
                        </dd>
                      </div>
                    )}

                    {activeResult.sessionsRemaining != null && (
                      <div>
                        <dt className="text-[11px] font-semibold text-faint">
                          {t("reception.sessionsLeft")}
                        </dt>
                        <dd dir="ltr" className="mt-0.5 font-bold font-mono">
                          {activeResult.sessionsRemaining}
                        </dd>
                      </div>
                    )}

                    <div>
                      <dt className="text-[11px] font-semibold text-faint">
                        {t("reception.outstanding")}
                      </dt>
                      <dd
                        dir="ltr"
                        className={cn(
                          "mt-0.5 font-bold font-mono",
                          activeResult.outstandingMinor > 0 ? "text-red" : "text-subtle",
                        )}
                      >
                        {formatMinor(activeResult.outstandingMinor)}
                      </dd>
                    </div>
                  </dl>
                )}

                {/* Denial Reason Box if Denied */}
                {activeResult.kind === "denied" && (
                  <div className="mt-5 flex items-center gap-3 rounded-xl border border-red/30 bg-red/10 p-3.5 text-xs text-red">
                    <XCircle className="size-5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-bold">
                        {t(`reception.reasons.${activeResult.reason}`)}
                      </p>
                      <p className="mt-0.5 text-subtle text-[11px]">
                        {t("reception.statusInvalid")}
                      </p>
                    </div>
                  </div>
                )}

                {/* Duplicate Notification if Duplicate */}
                {activeResult.kind === "duplicate" && (
                  <div className="mt-5 flex items-center gap-3 rounded-xl border border-amber/30 bg-amber/10 p-3.5 text-xs text-amber">
                    <AlertTriangle className="size-5 shrink-0" />
                    <div className="min-w-0">
                      <p className="font-bold">{t("reception.alreadyIn")}</p>
                      <p className="mt-0.5 text-subtle text-[11px]">
                        {t("reception.duplicateSub", { n: String(activeResult.secondsAgo) })}
                      </p>
                    </div>
                  </div>
                )}

                {/* Member Notes Display if Present */}
                {"notes" in activeResult && activeResult.notes && activeResult.notes.trim() !== "" && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-2.5 text-xs text-amber">
                    <span className="font-bold shrink-0">{t("members.notes")}:</span>
                    <p className="whitespace-pre-line leading-relaxed font-medium text-amber-200">{activeResult.notes}</p>
                  </div>
                )}
              </div>

              {/* Quick Action Toolbar for Receptionist (Bottom of Card) */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  {"memberId" in activeResult && activeResult.memberId && (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onOpenProfile(activeResult.memberId!)}
                        className="gap-1.5 text-xs"
                      >
                        <UserRound className="size-3.5" />
                        <span>{t("reception.viewProfile")}</span>
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onOpenWhatsApp(activeResult.memberId!)}
                        className="gap-1.5 text-xs"
                      >
                        <MessageSquare className="size-3.5 text-emerald-400" />
                        <span>{t("reception.sendWhatsApp")}</span>
                      </Button>

                      {hasPermission("subscriptions.create") && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => onRenewSub(activeResult.memberId!)}
                          className="gap-1.5 text-xs border-neon/40 text-neon hover:bg-neon/10"
                        >
                          <CalendarPlus className="size-3.5" />
                          <span>{t("reception.renewSub")}</span>
                        </Button>
                      )}

                      {hasPermission("payments.create") &&
                        "outstandingMinor" in activeResult &&
                        (activeResult.outstandingMinor ?? 0) > 0 && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => onPayDebt(activeResult.memberId!)}
                            className="gap-1.5 text-xs"
                          >
                            <CreditCard className="size-3.5" />
                            <span>{t("reception.payOutstanding")}</span>
                          </Button>
                        )}
                    </>
                  )}
                </div>

                {/* Attendance Cancellation / Restore Button (Permission: checkin.delete) */}
                {activeResult.kind === "success" && hasPermission("checkin.delete") && (
                  <div>
                    {!attendanceDeleted ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmCancelOpen(true)}
                        loading={actionBusy}
                        disabled={actionBusy}
                        className="gap-1.5 text-xs border-red/30 text-red hover:bg-red/10"
                        title={t("reception.cancelAttendance")}
                      >
                        <Trash2 className="size-3.5" />
                        <span>{t("reception.cancelAttendance")}</span>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleRestoreAttendance}
                        loading={actionBusy}
                        disabled={actionBusy}
                        className="gap-1.5 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                      >
                        <Undo2 className="size-3.5" />
                        <span>{t("reception.restoreAttendance")}</span>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Idle Ready-To-Scan View */
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3.5 rounded-2xl border border-line bg-panel p-8 text-center shadow-sm">
              <span
                aria-hidden
                className="grid size-16 animate-pulse place-items-center rounded-2xl border border-neon/30 bg-neon/10 text-neon shadow-glow-sm"
              >
                <ScanLine className="size-8" />
              </span>
              <div>
                <h3 className="text-base font-bold text-foreground">
                  {t("reception.autoKioskReady")}
                </h3>
                <p className="mt-1 max-w-sm text-xs text-subtle">
                  {t("reception.autoKioskSub")}
                </p>
              </div>
              {/* Manual entry / barcode-reader fallback */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const val = manualBarcodeInput.trim();
                  if (val) {
                    void processBarcode(val);
                    setManualBarcodeInput("");
                  }
                }}
                className="mt-3 w-full max-w-sm"
              >
                <Input
                  ref={inputScannerRef}
                  value={manualBarcodeInput}
                  onChange={(e) => setManualBarcodeInput(e.target.value)}
                  placeholder={t("reception.autoKioskInputPh")}
                  data-scanner-input="true"
                  className="text-center font-mono text-base tracking-wider py-2.5 shadow-sm border-neon/40 focus:border-neon focus:ring-neon/30"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
              </form>
            </div>
          )}
        </div>
      </div>


      {/* Cancel Attendance Confirmation Dialog */}
      {confirmCancelOpen && activeResult && activeResult.kind === "success" && (
        <Modal
          open={confirmCancelOpen}
          onClose={() => setConfirmCancelOpen(false)}
          title={t("reception.cancelAttendance")}
          widthClass="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              {t("reception.cancelAttendanceConfirm", { name: activeResult.memberName })}
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmCancelOpen(false)}
                disabled={actionBusy}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleCancelAttendance}
                loading={actionBusy}
              >
                {t("reception.cancelAttendance")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
