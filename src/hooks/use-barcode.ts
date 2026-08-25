import { useEffect, useRef } from "react";
import { attachGlobalBarcodeScanner } from "@/core/barcode/barcode-input";

export function useBarcodeScanner(onScan: (barcode: string) => void, enabled = true) {
  const handlerRef = useRef(onScan);
  handlerRef.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    return attachGlobalBarcodeScanner((barcode) => handlerRef.current(barcode));
  }, [enabled]);
}
