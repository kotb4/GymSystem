import { useEffect, useRef, useState } from "react";
import { Camera, Video as VideoIcon } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "./button";
import { Modal } from "./modal";
import { cn } from "@/utils/cn";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  captureBusy?: boolean;
}

export function CameraCapture({ open, onClose, onCapture, captureBusy }: CameraCaptureProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) {
      stopStream();
      setReady(false);
      setError(null);
      return;
    }
    start();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function stopStream() {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }

  async function start() {
    setError(null);
    setReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t("members.cameraUnavailable"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        setReady(true);
      }
    } catch {
      setError(t("members.cameraDenied"));
    }
  }

  function handleCapture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        onCapture(file);
      },
      "image/jpeg",
      0.92
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={t("members.cameraTitle")} widthClass="max-w-lg">
      <div className="space-y-4">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-line bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className={cn("h-full w-full object-cover", ready ? "" : "hidden")}
          />
          {!ready && !error && (
            <div className="absolute inset-0 grid place-items-center text-faint">
              <VideoIcon className="size-8" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-red">
              {error}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleCapture} disabled={!ready || captureBusy} loading={captureBusy}>
            <Camera className="size-4" />
            {t("members.cameraCapture")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
