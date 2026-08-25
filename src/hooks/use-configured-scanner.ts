import { useEffect, useRef, useState } from "react";
import { attachGlobalBarcodeScanner } from "@/core/barcode/barcode-input";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/api";

export interface ScannerConfig {
  enabled: boolean;
  prefix: string;
  suffix: string;
  minLength: number;
  timeoutMs: number;
  maxKeyIntervalMs: number;
}

const DEFAULT_CONFIG: ScannerConfig = {
  enabled: true,
  prefix: "",
  suffix: "",
  minLength: 4,
  timeoutMs: 5000,
  maxKeyIntervalMs: 80,
};

export function useBarcodeScanner(onScan: (barcode: string) => void, enabled = true) {
  const handlerRef = useRef(onScan);
  handlerRef.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    return attachGlobalBarcodeScanner((barcode) => handlerRef.current(barcode));
  }, [enabled]);
}

/**
 * Scanner hook driven by the gym's scanner settings served by the local
 * backend (enabled/prefix/suffix/length/timeout).
 */
export function useConfiguredScanner(onScan: (barcode: string) => void): ScannerConfig {
  const { user } = useAuth();
  const handlerRef = useRef(onScan);
  handlerRef.current = onScan;
  const [config, setConfig] = useState<ScannerConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api.settings
      .scannerConfig()
      .then((loaded) => {
        if (alive && loaded?.enabled !== undefined) setConfig(loaded as ScannerConfig);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user]);

  const active = Boolean(user) && config.enabled;

  useEffect(() => {
    if (!active) return;
    return attachGlobalBarcodeScanner(
      (barcode) => handlerRef.current(barcode),
      {
        minLength: config.minLength,
        prefix: config.prefix,
        suffix: config.suffix,
        scanTimeoutMs: config.timeoutMs,
        maxKeyIntervalMs: config.maxKeyIntervalMs,
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, config.minLength, config.prefix, config.suffix, config.timeoutMs]);

  return config;
}
