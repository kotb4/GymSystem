import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, RefreshCw, Video as VideoIcon } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "./button";
import { Modal } from "./modal";
import { Select } from "./select";
import { cn } from "@/utils/cn";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  captureBusy?: boolean;
}

const PREFERRED_CAM_KEY = "gym_preferred_camera_id";

export function CameraCapture({ open, onClose, onCapture, captureBusy }: CameraCaptureProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
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

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
  }, []);

  const startStream = useCallback(async (deviceIdToUse?: string) => {
    setError(null);
    setReady(false);
    stopStream();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t("members.cameraUnavailable"));
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceIdToUse
          ? { deviceId: { exact: deviceIdToUse } }
          : { facingMode: "user" },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        // Fallback to generic video if exact device ID constraint fails
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        setReady(true);
      }

      // Enumerate available devices once permission is granted (to see real labels)
      if (navigator.mediaDevices.enumerateDevices) {
        const all = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = all
          .filter((d) => d.kind === "videoinput")
          .map((d, idx) => ({
            deviceId: d.deviceId,
            label: d.label || `${t("members.cameraDevice")} ${idx + 1}`,
          }));
        setDevices(videoInputs);

        // If no deviceId was preselected, mark current active track's deviceId
        const activeTrack = stream.getVideoTracks()[0];
        const activeDeviceId = activeTrack?.getSettings()?.deviceId;
        if (activeDeviceId && !deviceIdToUse) {
          setSelectedDeviceId(activeDeviceId);
          try {
            localStorage.setItem(PREFERRED_CAM_KEY, activeDeviceId);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      setError(t("members.cameraDenied"));
    }
  }, [stopStream, t]);

  useEffect(() => {
    if (!open) {
      stopStream();
      setReady(false);
      setError(null);
      return;
    }
    void startStream(selectedDeviceId || undefined);
    return () => stopStream();
  }, [open, selectedDeviceId, startStream, stopStream]);

  const handleDeviceChange = (newDeviceId: string) => {
    setSelectedDeviceId(newDeviceId);
    try {
      localStorage.setItem(PREFERRED_CAM_KEY, newDeviceId);
    } catch {
      // ignore
    }
    void startStream(newDeviceId);
  };

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    // Center crop to 1:1 square with max dimension 512
    const minSide = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - minSide) / 2;
    const sy = (video.videoHeight - minSide) / 2;
    const targetSize = Math.min(minSide, 512);

    const canvas = document.createElement("canvas");
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onCapture(file);
      },
      "image/jpeg",
      0.82,
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t("members.cameraTitle")} widthClass="max-w-lg">
      <div className="space-y-4">
        {devices.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-semibold text-subtle">
              {t("members.cameraDevice")}:
            </span>
            <div className="flex-1">
              <Select
                value={selectedDeviceId}
                onChange={(e) => handleDeviceChange(e.target.value)}
                options={devices.map((d) => ({ value: d.deviceId, label: d.label }))}
              />
            </div>
          </div>
        )}

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className={cn("h-full w-full object-cover", ready ? "" : "hidden")}
          />
          {!ready && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-faint">
              <VideoIcon className="size-8 animate-pulse" />
              <span className="text-xs">{t("common.loading")}</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm font-semibold text-red">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/50 pt-3">
          {devices.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const currentIndex = devices.findIndex((d) => d.deviceId === selectedDeviceId);
                const nextIndex = (currentIndex + 1) % devices.length;
                handleDeviceChange(devices[nextIndex].deviceId);
              }}
            >
              <RefreshCw className="size-3.5" />
              {t("members.cameraSwitch")}
            </Button>
          )}
          <div className="ms-auto flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleCapture} disabled={!ready || captureBusy} loading={captureBusy}>
              <Camera className="size-4" />
              {t("members.cameraCapture")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
