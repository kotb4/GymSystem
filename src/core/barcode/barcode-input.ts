export interface BarcodeScannerOptions {
  minLength?: number;
  maxKeyIntervalMs?: number;
  /** Literal text scanners may send before the code (stripped before handling). */
  prefix?: string;
  /** Literal terminator some scanners append after Enter (e.g. CR handled natively). */
  suffix?: string;
  /** Maximum duration between the first and last key of a single scan. */
  scanTimeoutMs?: number;
}

const PRINTABLE_RE = /^[\x20-\x7e]$/;

function stripAffixes(candidate: string, prefix: string, suffix: string): string {
  let value = candidate;
  if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length);
  if (suffix && value.endsWith(suffix)) value = value.slice(0, value.length - suffix.length);
  return value.trim();
}

export function attachGlobalBarcodeScanner(
  handler: (barcode: string) => void,
  options: BarcodeScannerOptions = {},
): () => void {
  const minLength = Math.max(1, options.minLength ?? 4);
  const maxKeyIntervalMs = options.maxKeyIntervalMs ?? 80;
  const prefix = (options.prefix ?? "").trim();
  const suffix = (options.suffix ?? "").trim();
  const scanTimeoutMs = Math.max(200, options.scanTimeoutMs ?? 5000);
  let buffer = "";
  let lastKeyTime = 0;
  let firstKeyTime = 0;

  const isTypingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) {
      buffer = "";
      return;
    }
    if (event.key === "Enter") {
      const candidate = buffer;
      buffer = "";
      const cleaned = stripAffixes(candidate, prefix, suffix);
      if (cleaned.length >= minLength) {
        event.preventDefault();
        handler(cleaned);
      }
      return;
    }
    if (event.key.length === 1 && PRINTABLE_RE.test(event.key)) {
      const now = performance.now();
      if (now - lastKeyTime > maxKeyIntervalMs) {
        buffer = "";
        firstKeyTime = now;
      } else if (now - firstKeyTime > scanTimeoutMs) {
        buffer = "";
        firstKeyTime = now;
      }
      lastKeyTime = now;
      buffer += event.key;
      if (buffer.length > 128) buffer = buffer.slice(-128);
    } else if (event.key !== "Shift") {
      buffer = "";
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
