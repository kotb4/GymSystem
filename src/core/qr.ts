import { toDataURL } from "qrcode";

export interface QrOptions {
  width?: number;
  margin?: number;
}

/**
 * Server-side QR PNG renderer (backend-only; bundle-free pure JS `qrcode`).
 * Returns a base64 string WITHOUT the data-URL prefix so it can be embedded in
 * a media payload or turned into a PNG response by the HTTP layer.
 */
export async function renderQrPngBase64(value: string, opts: QrOptions = {}): Promise<string> {
  const dataUrl = await toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: opts.margin ?? 2,
    width: opts.width ?? 480,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("QR renderer returned an unexpected format");
  return dataUrl.slice(comma + 1);
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}