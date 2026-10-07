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

const ARABIC_TO_ENGLISH_MAP: Record<string, string> = {
  // Arabic 101/102 keyboard mapping to standard QWERTY
  "ض": "Q", "ص": "W", "ث": "E", "ق": "R", "ف": "T", "غ": "Y", "ع": "U", "ه": "I", "خ": "O", "ح": "P", "ج": "[", "د": "]",
  "ش": "A", "س": "S", "ي": "D", "ب": "F", "ل": "G", "ا": "H", "ت": "J", "ن": "K", "م": "L", "ك": ";", "ط": "'",
  "ئ": "Z", "ء": "X", "ؤ": "C", "ر": "V", "لا": "B", "ى": "N", "ة": "M", "و": ",", "ز": ".", "ظ": "/", "ذ": "`",
  // Shift variants
  "َ": "Q", "ً": "W", "ُ": "E", "ٌ": "R", "لإ": "T", "إ": "Y", "‘": "U", "÷": "I", "×": "O", "؛": "P",
  "ِ": "A", "ٍ": "S", "لأ": "G", "أ": "H", "ـ": "J", "،": "K",
  "~": "Z", "ْ": "X", "}" : "C", "{" : "V", "لآ": "B", "آ": "N", "’": "M",
  // Arabic-Indic digits
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

/**
 * Normalizes a scanned barcode string by converting any Arabic keyboard layout characters
 * to their corresponding English/ASCII keys (e.g., 'لا1-ةثمة-000001' -> 'B1-MEM-000001').
 */
export function normalizeBarcodeString(raw: string): string {
  if (!raw) return "";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const two = raw.slice(i, i + 2);
    if (two === "لا" || two === "لآ") {
      out += "B";
      i++;
      continue;
    }
    if (two === "لأ") {
      out += "G";
      i++;
      continue;
    }
    if (two === "لإ") {
      out += "T";
      i++;
      continue;
    }
    const char = raw[i];
    if (ARABIC_TO_ENGLISH_MAP[char]) {
      out += ARABIC_TO_ENGLISH_MAP[char];
    } else {
      out += char;
    }
  }
  return out.toUpperCase().trim();
}

function resolveScannerChar(event: KeyboardEvent): string | null {
  const code = event.code;
  if (code) {
    if (code.startsWith("Key")) return code.slice(3).toUpperCase();
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad") && code.length === 7 && code[6] >= "0" && code[6] <= "9") {
      return code.slice(6);
    }
    if (code === "Minus" || code === "NumpadSubtract") return "-";
    if (code === "Slash" || code === "NumpadDivide") return "/";
    if (code === "Period" || code === "NumpadDecimal") return ".";
    if (code === "Equal") return "=";
    if (code === "Space") return " ";
  }

  const key = event.key;
  if (!key) return null;
  if (ARABIC_TO_ENGLISH_MAP[key]) return ARABIC_TO_ENGLISH_MAP[key];
  if (PRINTABLE_RE.test(key)) return key.toUpperCase();
  return null;
}

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
  const maxKeyIntervalMs = options.maxKeyIntervalMs ?? 200;
  const prefix = (options.prefix ?? "").trim();
  const suffix = (options.suffix ?? "").trim();
  const scanTimeoutMs = Math.max(200, options.scanTimeoutMs ?? 5000);
  let buffer = "";
  let lastKeyTime = 0;
  let firstKeyTime = 0;

  const isTypingTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    // Allow elements with data-scanner-input="true" to participate in global scan capture
    if (target.dataset.scannerInput === "true") return false;
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
    if (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") {
      const candidate = buffer;
      buffer = "";
      const cleaned = stripAffixes(candidate, prefix, suffix);
      if (cleaned.length >= minLength) {
        event.preventDefault();
        handler(normalizeBarcodeString(cleaned));
      }
      return;
    }

    const char = resolveScannerChar(event);
    if (char) {
      const now = performance.now();
      if (now - lastKeyTime > maxKeyIntervalMs) {
        buffer = "";
        firstKeyTime = now;
      } else if (now - firstKeyTime > scanTimeoutMs) {
        buffer = "";
        firstKeyTime = now;
      }
      lastKeyTime = now;
      buffer += char;
      if (buffer.length > 128) buffer = buffer.slice(-128);
    } else if (
      event.key !== "Shift" &&
      event.key !== "Alt" &&
      event.key !== "Control" &&
      event.key !== "CapsLock"
    ) {
      buffer = "";
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
