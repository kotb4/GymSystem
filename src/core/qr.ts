import { toDataURL } from "qrcode";
import { PNG } from "pngjs";

export interface QrOptions {
  width?: number;
  margin?: number;
}

const FONT_5X7: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0],
  ":": [0, 0x24, 0, 0, 0],
  "|": [0, 0, 0x7f, 0, 0],
  "-": [0, 0x08, 0x08, 0x08, 0],
  ".": [0, 0x40, 0, 0, 0],
  "/": [0x60, 0x18, 0x06, 0x01, 0],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46],
  "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
  "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
  "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  "A": [0x7e, 0x11, 0x11, 0x11, 0x7e],
  "B": [0x7f, 0x49, 0x49, 0x49, 0x36],
  "C": [0x3e, 0x41, 0x41, 0x41, 0x22],
  "D": [0x7f, 0x41, 0x41, 0x22, 0x1c],
  "E": [0x7f, 0x49, 0x49, 0x49, 0x41],
  "F": [0x7f, 0x09, 0x09, 0x09, 0x01],
  "G": [0x3e, 0x41, 0x49, 0x49, 0x7a],
  "H": [0x7f, 0x08, 0x08, 0x08, 0x7f],
  "I": [0x00, 0x41, 0x7f, 0x41, 0x00],
  "J": [0x20, 0x40, 0x41, 0x3f, 0x01],
  "K": [0x7f, 0x08, 0x14, 0x22, 0x41],
  "L": [0x7f, 0x40, 0x40, 0x40, 0x40],
  "M": [0x7f, 0x02, 0x04, 0x02, 0x7f],
  "N": [0x7f, 0x04, 0x08, 0x10, 0x7f],
  "O": [0x3e, 0x41, 0x41, 0x41, 0x3e],
  "P": [0x7f, 0x09, 0x09, 0x09, 0x06],
  "Q": [0x3e, 0x41, 0x51, 0x21, 0x5e],
  "R": [0x7f, 0x09, 0x19, 0x29, 0x46],
  "S": [0x46, 0x49, 0x49, 0x49, 0x31],
  "T": [0x01, 0x01, 0x7f, 0x01, 0x01],
  "U": [0x3f, 0x40, 0x40, 0x40, 0x3f],
  "V": [0x1f, 0x20, 0x40, 0x20, 0x1f],
  "W": [0x7f, 0x20, 0x18, 0x20, 0x7f],
  "X": [0x63, 0x14, 0x08, 0x14, 0x63],
  "Y": [0x07, 0x08, 0x70, 0x08, 0x07],
  "Z": [0x61, 0x51, 0x49, 0x45, 0x43],
  "a": [0x20, 0x54, 0x54, 0x54, 0x78],
  "b": [0x7f, 0x48, 0x44, 0x44, 0x38],
  "c": [0x38, 0x44, 0x44, 0x44, 0x20],
  "d": [0x38, 0x44, 0x44, 0x48, 0x7f],
  "e": [0x38, 0x54, 0x54, 0x54, 0x18],
  "f": [0x08, 0x7e, 0x09, 0x01, 0x02],
  "g": [0x0c, 0x52, 0x52, 0x52, 0x3e],
  "h": [0x7f, 0x08, 0x04, 0x04, 0x78],
  "i": [0x00, 0x44, 0x7d, 0x40, 0x00],
  "j": [0x20, 0x40, 0x44, 0x3d, 0x00],
  "k": [0x7f, 0x10, 0x28, 0x44, 0x00],
  "l": [0x00, 0x41, 0x7f, 0x40, 0x00],
  "m": [0x7c, 0x04, 0x18, 0x04, 0x78],
  "n": [0x7c, 0x08, 0x04, 0x04, 0x78],
  "o": [0x38, 0x44, 0x44, 0x44, 0x38],
  "p": [0x7c, 0x14, 0x14, 0x14, 0x08],
  "q": [0x08, 0x14, 0x14, 0x18, 0x7c],
  "r": [0x7c, 0x08, 0x04, 0x04, 0x08],
  "s": [0x48, 0x54, 0x54, 0x54, 0x20],
  "t": [0x04, 0x3f, 0x44, 0x40, 0x20],
  "u": [0x3c, 0x40, 0x40, 0x20, 0x7c],
  "v": [0x1c, 0x20, 0x40, 0x20, 0x1c],
  "w": [0x3c, 0x40, 0x30, 0x40, 0x3c],
  "x": [0x44, 0x28, 0x10, 0x28, 0x44],
  "y": [0x0c, 0x50, 0x50, 0x50, 0x3c],
  "z": [0x44, 0x64, 0x54, 0x4c, 0x44]
};

function drawChar(outPng: PNG, ch: string, startX: number, startY: number, scale: number, r: number, g: number, b: number, a = 255): void {
  const glyph = FONT_5X7[ch] || FONT_5X7[" "];
  for (let col = 0; col < 5; col++) {
    const colBits = glyph[col] || 0;
    for (let row = 0; row < 7; row++) {
      if ((colBits & (1 << row)) !== 0) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = startX + col * scale + dx;
            const py = startY + row * scale + dy;
            if (px >= 0 && px < outPng.width && py >= 0 && py < outPng.height) {
              const idx = (outPng.width * py + px) << 2;
              outPng.data[idx] = r;
              outPng.data[idx + 1] = g;
              outPng.data[idx + 2] = b;
              outPng.data[idx + 3] = a;
            }
          }
        }
      }
    }
  }
}

function drawString(outPng: PNG, text: string, startX: number, startY: number, scale: number, r: number, g: number, b: number, a = 255): void {
  const charAdvance = 6 * scale;
  for (let i = 0; i < text.length; i++) {
    drawChar(outPng, text[i], startX + i * charAdvance, startY, scale, r, g, b, a);
  }
}

/**
 * Server-side QR PNG renderer.
 * Produces a complete card visual with the barcode and developer credit line
 * embedded into the image itself, matching what staff download or WhatsApp sends.
 */
export async function renderQrPngBase64(value: string, opts: QrOptions = {}): Promise<string> {
  const qrWidth = opts.width ?? 480;
  const dataUrl = await toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: opts.margin ?? 2,
    width: qrWidth,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("QR renderer returned an unexpected format");
  const rawQrBuf = Buffer.from(dataUrl.slice(comma + 1), "base64");
  const qrPng = PNG.sync.read(rawQrBuf);

  const barcodeText = value.trim().toUpperCase();
  const creditLabel = "Powered by ";
  const creditName = "GymGate — KOTB Digital Solutions";

  // Barcode scale 2 (12px per char, 14px high)
  const barcodeW = barcodeText.length * 12;
  const barcodeX = Math.floor((qrWidth - barcodeW) / 2);

  // Credit scale 1 (6px per char, 7px high)
  const totalCreditLen = (creditLabel + creditName).length;
  const creditW = totalCreditLen * 6;
  const creditX = Math.floor((qrWidth - creditW) / 2);

  const barcodeY = qrWidth + 8;
  const creditY = barcodeY + 14 + 10;
  const totalHeight = creditY + 7 + 16;

  const out = new PNG({ width: qrWidth, height: totalHeight });
  out.data.fill(255); // White canvas

  // Copy QR
  for (let y = 0; y < qrWidth; y++) {
    for (let x = 0; x < qrWidth; x++) {
      const srcIdx = (qrWidth * y + x) << 2;
      const dstIdx = (qrWidth * y + x) << 2;
      out.data[dstIdx] = qrPng.data[srcIdx];
      out.data[dstIdx + 1] = qrPng.data[srcIdx + 1];
      out.data[dstIdx + 2] = qrPng.data[srcIdx + 2];
      out.data[dstIdx + 3] = qrPng.data[srcIdx + 3];
    }
  }

  // Draw barcode text (slate 900: #0f172a)
  drawString(out, barcodeText, barcodeX, barcodeY, 2, 15, 23, 42);

  // Draw credit label (slate 500: #64748b)
  drawString(out, creditLabel, creditX, creditY, 1, 100, 116, 139);

  // Draw credit name (black: #000000)
  const creditNameX = creditX + creditLabel.length * 6;
  drawString(out, creditName, creditNameX, creditY, 1, 0, 0, 0);

  const compositePng = PNG.sync.write(out);
  return compositePng.toString("base64");
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}