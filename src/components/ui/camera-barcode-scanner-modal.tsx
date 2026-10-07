import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  RefreshCw,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "./button";
import { Modal } from "./modal";
import { Select } from "./select";
import { Checkbox } from "./checkbox";
import { playScanBeep } from "@/utils/sound";
import { cn } from "@/utils/cn";

export interface CameraBarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  title?: string;
  allowContinuous?: boolean;
}

interface DetectedBarcode {
  rawValue: string;
  format?: string;
}

const PREFERRED_CAM_KEY = "gym_preferred_scanner_cam_id";
const SCAN_INTERVAL_MS = 120;
const DUPLICATE_COOLDOWN_MS = 2000;

export function CameraBarcodeScannerModal({
  open,
  onClose,
  onScan,
  title,
  allowContinuous = true,
}: CameraBarcodeScannerModalProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const lastScannedCodeRef = useRef<string>("");

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    try {
      return localStorage.getItem(PREFERRED_CAM_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [lastDetected, setLastDetected] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);

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
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const startStream = useCallback(
    async (deviceIdToUse?: string) => {
      setError(null);
      setReady(false);
      stopStream();

      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t("reception.cameraUnsupported"));
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
          // Fallback to basic video without resolution/deviceId constraints
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

        // Check torch capability
        const track = stream.getVideoTracks()[0];
        if (track && typeof track.getCapabilities === "function") {
          try {
            const caps = track.getCapabilities() as { torch?: boolean };
            setTorchSupported(Boolean(caps && caps.torch));
          } catch {
            setTorchSupported(false);
          }
        }

        // Enumerate devices for selector
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
          setError(t("reception.cameraPermissionDenied"));
        } else if (message === "NotFoundError" || message === "DevicesNotFoundError") {
          setError(t("reception.cameraNotFound"));
        } else {
          setError(t("reception.cameraUnsupported"));
        }
      }
    },
    [stopStream, t],
  );

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track || typeof track.applyConstraints !== "function") return;
    try {
      const nextState = !torchOn;
      // @ts-expect-error torch is valid on mobile Chrome/Edge ImageCapture
      await track.applyConstraints({ advanced: [{ torch: nextState }] });
      setTorchOn(nextState);
    } catch {
      // ignore
    }
  }, [torchOn]);

  const handleDeviceChange = (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    try {
      localStorage.setItem(PREFERRED_CAM_KEY, newDeviceId);
    } catch {
      // ignore
    }
    void startStream(newDeviceId);
  };

  // Barcode detection loop
  useEffect(() => {
    if (!open || !ready) return;

    // Check BarcodeDetector support
    const BarcodeDetectorClass = (window as unknown as {
      BarcodeDetector?: new (options?: { formats: string[] }) => {
        detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
      };
    }).BarcodeDetector;

    if (!BarcodeDetectorClass) {
      setError(t("reception.cameraUnsupported"));
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
                const now = Date.now();
                const isRecentDuplicate =
                  lastScannedCodeRef.current === code &&
                  now - lastScanTimeRef.current < DUPLICATE_COOLDOWN_MS;

                if (!isRecentDuplicate) {
                  lastScannedCodeRef.current = code;
                  lastScanTimeRef.current = now;

                  // Feedback: audio beep & haptics
                  playScanBeep();
                  if (typeof navigator !== "undefined" && navigator.vibrate) {
                    try {
                      navigator.vibrate([60, 40, 60]);
                    } catch {
                      // ignore
                    }
                  }

                  setLastDetected(code);
                  setScanCount((prev) => prev + 1);
                  onScan(code);

                  if (!continuous) {
                    onClose();
                    return;
                  }
                }
              }
            }
          } catch {
            // frame dropped or format glitch; continue
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
  }, [open, ready, continuous, onScan, onClose, t]);

  // Open/close lifecycle
  useEffect(() => {
    if (!open) {
      stopStream();
      setReady(false);
      setError(null);
      setLastDetected(null);
      setScanCount(0);
      return;
    }

    void startStream(selectedDeviceId || undefined);
    return () => stopStream();
  }, [open, selectedDeviceId, startStream, stopStream]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? t("reception.cameraScanTitle")}
      widthClass="max-w-lg"
    >
      <div className="space-y-4">
        {/* Device selector and controls header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {devices.length > 1 ? (
            <div className="flex flex-1 items-center gap-2 min-w-[200px]">
              <span className="shrink-0 text-xs font-semibold text-subtle">
                {t("reception.cameraDevice")}:
              </span>
              <div className="flex-1">
                <Select
                  value={selectedDeviceId}
                  onChange={(e) => handleDeviceChange(e.target.value)}
                  options={devices.map((d) => ({
                    value: d.deviceId,
                    label: d.label,
                  }))}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-subtle">{t("reception.cameraScanHint")}</p>
          )}

          <div className="flex items-center gap-1.5 ms-auto">
            {torchSupported && (
              <Button
                type="button"
                variant={torchOn ? "primary" : "ghost"}
                size="sm"
                onClick={toggleTorch}
                title={
                  torchOn
                    ? t("reception.cameraTorchOff")
                    : t("reception.cameraTorchOn")
                }
              >
                {torchOn ? (
                  <FlashlightOff className="size-4 text-neon" />
                ) : (
                  <Flashlight className="size-4" />
                )}
              </Button>
            )}

            {devices.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const currentIndex = devices.findIndex(
                    (d) => d.deviceId === selectedDeviceId,
                  );
                  const nextIndex = (currentIndex + 1) % devices.length;
                  handleDeviceChange(devices[nextIndex].deviceId);
                }}
                title={t("reception.cameraSwitch")}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Viewfinder display */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-black shadow-inner">
          <video
            ref={videoRef}
            playsInline
            muted
            className={cn("h-full w-full object-cover", ready ? "" : "hidden")}
          />

          {/* Center Target Box / Reticle */}
          {ready && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div
                className={cn(
                  "relative aspect-square w-64 max-w-[80%] rounded-2xl border-2 transition-all duration-300",
                  lastDetected
                    ? "border-neon bg-neon/10 scale-105"
                    : "border-dashed border-white/30",
                )}
              >
                {/* 4 Glowing Corner Brackets */}
                <div className="absolute -left-1 -top-1 size-6 rounded-tl-lg border-s-4 border-t-4 border-neon shadow-[0_0_8px_rgba(20,241,149,0.8)]" />
                <div className="absolute -right-1 -top-1 size-6 rounded-tr-lg border-e-4 border-t-4 border-neon shadow-[0_0_8px_rgba(20,241,149,0.8)]" />
                <div className="absolute -left-1 -bottom-1 size-6 rounded-bl-lg border-s-4 border-b-4 border-neon shadow-[0_0_8px_rgba(20,241,149,0.8)]" />
                <div className="absolute -right-1 -bottom-1 size-6 rounded-br-lg border-e-4 border-b-4 border-neon shadow-[0_0_8px_rgba(20,241,149,0.8)]" />

                {/* Animated Laser Beam */}
                <div className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2 h-0.5 animate-pulse bg-gradient-to-r from-transparent via-neon to-transparent shadow-[0_0_12px_#10b981]" />
              </div>
            </div>
          )}

          {/* Loading state */}
          {!ready && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-faint">
              <VideoIcon className="size-8 animate-pulse text-neon" />
              <span className="text-xs">{t("common.loading")}</span>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="rounded-xl border border-red/30 bg-red/10 p-4 text-xs font-semibold leading-relaxed text-red">
                {error}
              </div>
            </div>
          )}
        </div>

        {/* Success badge for last scanned code */}
        {lastDetected && (
          <div className="flex items-center justify-between rounded-xl border border-neon/30 bg-neon/10 px-4 py-2.5 text-xs font-semibold text-neon animate-in fade-in">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{t("reception.cameraDetected", { code: lastDetected })}</span>
            </div>
            {continuous && scanCount > 0 && (
              <span className="rounded-full bg-neon/20 px-2 py-0.5 text-[11px] font-bold">
                {scanCount}
              </span>
            )}
          </div>
        )}

        {/* Continuous mode toggle & close actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/50 pt-3">
          {allowContinuous ? (
            <Checkbox
              checked={continuous}
              onCheckedChange={setContinuous}
            >
              <span className="text-xs font-medium">{t("reception.cameraScanContinuous")}</span>
            </Checkbox>
          ) : (
            <div />
          )}

          <div className="ms-auto flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              <X className="size-4" />
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
