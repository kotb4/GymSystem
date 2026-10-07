import { useState } from "react";
import { Camera, ScanLine } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";
import { CameraBarcodeScannerModal } from "./camera-barcode-scanner-modal";
import { useT } from "@/i18n";

export interface BarcodeFieldProps {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  enableCameraScan?: boolean;
  onScanComplete?: (value: string) => void;
}

export function BarcodeField({
  label,
  value,
  onValueChange,
  placeholder,
  disabled,
  autoFocus,
  id,
  enableCameraScan = true,
  onScanComplete,
}: BarcodeFieldProps) {
  const t = useT();
  const [cameraOpen, setCameraOpen] = useState(false);

  const handleScan = (scanned: string) => {
    const val = scanned.toUpperCase();
    onValueChange(val);
    onScanComplete?.(val);
  };

  return (
    <div className="w-full">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            id={id}
            label={label}
            icon={<ScanLine className="size-4" />}
            dir="ltr"
            className="font-mono uppercase tracking-widest"
            placeholder={placeholder ?? "GYM-000000"}
            value={value}
            autoFocus={autoFocus}
            disabled={disabled}
            onChange={(e) => onValueChange(e.target.value.toUpperCase())}
          />
        </div>
        {enableCameraScan && (
          <Button
            type="button"
            variant="secondary"
            className="h-10 px-3"
            onClick={() => setCameraOpen(true)}
            disabled={disabled}
            title={t("reception.cameraScanTitle")}
          >
            <Camera className="size-4 text-neon" />
          </Button>
        )}
      </div>

      {cameraOpen && (
        <CameraBarcodeScannerModal
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onScan={handleScan}
          allowContinuous={false}
        />
      )}
    </div>
  );
}
