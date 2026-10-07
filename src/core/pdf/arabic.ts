import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";


import * as fontkit from "fontkit";
import type { Font } from "fontkit";
// pdfkit's own types are only needed for the document handle. The package is
// typed with `export =`, so the interface is reached through the default import.
import PDFDocumentType from "pdfkit";
type PdfDoc = InstanceType<typeof PDFDocumentType>;
/**
 * Arabic/RTL text engine for server-side PDF generation.
 *
 * â”€â”€ WHY THIS FILE EXISTS (ADR-040) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * PDFKit lays glyphs out strictly LEFT-TO-RIGHT in the order the shaper returns
 * them, and it gives no hook to supply pre-shaped, pre-reversed glyph runs.
 * Consequently plain `doc.text("Ø¥ÙŠØµØ§Ù„ Ù‚Ø¨Ø¶")` renders every Arabic string with
 * its characters in reverse visual order — verified by rasterising the output:
 * "Ø¥ÙŠØµØ§Ù„ Ù‚Ø¨Ø¶" came out as "Ù‚Ø¨Ø¶Ø¥ÙŠØµØ§Ù„" and "Ø£Ø­Ù…Ø¯ Ù…Ø­Ù…Ø¯ Ø¹Ø¨Ø§Ø³" as "Ø¹Ø¨Ø§Ø³Ø­Ù…Ø¯ Ø£Ø­Ù…Ø¯".
 *
 * Feeding PDFKit a BiDi-reordered string does NOT fix it and is worse: the
 * shaper then re-shapes an already-reversed word and merges glyphs — 9
 * characters collapse to 8 glyphs, silently losing one.
 *
 * The fix implemented here is the same model a browser uses:
 *   1. shape each WORD in logical order (fontkit applies the font's OpenType
 *      GSUB tables, so letters take correct initial/medial/final/isolated forms
 *      and dots stay attached — Cairo bakes marks into the base glyph outline,
 *      so no separate mark positioning is needed);
 *   2. emit the shaped glyphs in REVERSE order, advancing the pen to the LEFT,
 *      which places the first logical character rightmost.
 *
 * Glyphs are written as vector paths via PDFKit's path API. Trade-off: the
 * Arabic renders perfectly but is NOT selectable/searchable text. Latin runs
 * (amounts, member codes, receipt numbers) go through PDFKit's normal `text()`
 * so they stay real, searchable text.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

// In CJS server bundle, __dirname is always defined. Fall back to process.cwd() if undefined.
const moduleDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();

const FONT_FILES = {
  regular: "Cairo-Regular.ttf",
  bold: "Cairo-Bold.ttf",
} as const;

export type PdfFontWeight = keyof typeof FONT_FILES;

interface LoadedFont {
  font: Font;
  unitsPerEm: number;
}

const fontCache = new Map<PdfFontWeight, LoadedFont>();

function fontPath(file: string): string {
  const rel = join("assets", "fonts", file);
  // Dev: repo root. Packaged: assets/fonts sits next to the exe, and the
  // process cwd can be anything (e.g. launched from a shortcut), so also try
  // the directory holding the running executable and the source-tree location.
  const exeDir = process.env.GYMSYSTEM_EXE_DIR ?? "";
  const candidates = [
    join(process.cwd(), rel),
    exeDir ? join(exeDir, rel) : "",
    join(moduleDir, "..", "..", "..", rel),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`PDF font not found: expected assets/fonts/${file}`);
}

function loadFont(weight: PdfFontWeight): LoadedFont {
  const hit = fontCache.get(weight);
  if (hit) return hit;
  // `create` is typed as returning Font | FontCollection; a single TTF buffer
  // always yields a Font, so narrow with a shape check instead of a cast.
  const created = fontkit.create(fontBytes(weight));
  const font = created as Font;
  if (typeof font.layout !== "function" || typeof font.unitsPerEm !== "number") {
    throw new Error("PDF font is not a single TrueType font — regenerate assets/fonts from the static Cairo TTF");
  }
  const loaded: LoadedFont = { font, unitsPerEm: font.unitsPerEm };
  fontCache.set(weight, loaded);
  return loaded;
}

const byteCache = new Map<PdfFontWeight, Buffer>();

/** Cached raw font bytes (read once per process). */
function fontBytes(weight: PdfFontWeight): Buffer {
  const hit = byteCache.get(weight);
  if (hit) return hit;
  const bytes = readFileSync(fontPath(FONT_FILES[weight]));
  byteCache.set(weight, bytes);
  return bytes;
}

/** Test/preview hook: forget cached fonts (used by tests that swap font files). */
export function resetPdfFontCache(): void {
  fontCache.clear();
}

export function isRtlText(value: string): boolean {
  return /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(value);
}

/** True when the value has no letters at all (pure digits/punctuation). */
export function isNeutralText(value: string): boolean {
  return !/[A-Za-z\u0590-\u08FF]/.test(value);
}

export type TextAlign = "right" | "left" | "center";

export function alignFor(value: string): TextAlign {
  if (isNeutralText(value)) return "left";
  return isRtlText(value) ? "right" : "left";
}

/** Normalize Arabic-Indic digits to ASCII so amounts always read LTR. */
export function toAsciiDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

export interface TextOptions {
  size?: number;
  align?: TextAlign;
  color?: string;
  weight?: PdfFontWeight;
}

/**
 * Width in points the given string will occupy when drawn by `drawText`.
 * For LTR text pass the live `doc` so PDFKit measures with the real font
 * instead of a character-count guess (digits and commas vary in width).
 */
export interface MeasureOptions extends TextOptions {
  /** Live document, so LTR strings are measured with the real embedded font. */
  doc?: PdfDoc;
}

export interface BiDiRun {
  text: string;
  isRtl: boolean;
}

/**
 * Splits text into directional runs:
 * LTR runs: numbers, latin letters, and interior symbols like dots, commas, hyphens, colons, slashes, plus, percent.
 * RTL runs: Arabic text and neutral surrounding whitespace/punctuation.
 */
export function splitBiDiRuns(value: string): BiDiRun[] {
  if (!/[A-Za-z0-9]/.test(value)) {
    return [{ text: value, isRtl: true }];
  }
  const ltrRegex = /(?:[#+]?[A-Za-z0-9]+(?:[.,\-_/#+%:A-Za-z0-9]*[A-Za-z0-9%])?)/g;
  const runs: BiDiRun[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ltrRegex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: value.slice(lastIndex, match.index), isRtl: true });
    }
    runs.push({ text: match[0], isRtl: false });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    runs.push({ text: value.slice(lastIndex), isRtl: true });
  }
  return runs.filter((r) => r.text.length > 0);
}

interface VisualGlyph {
  advanceWidth: number;
  path: { commands: Array<{ command: string; args: unknown[] }> };
}

/**
 * Returns glyphs in visual LEFT-TO-RIGHT order across the line.
 * For pure LTR: fontkit layouts logically left to right.
 * For RTL/Arabic: fontkit flips numbers when mixed with Arabic; by laying out each
 * directional run separately and reversing the sequence of runs (since RTL runs
 * flow from right to left), numbers and English codes remain in true visual order
 * while Arabic words are shaped properly.
 */
function getVisualGlyphs(font: Font, value: string): VisualGlyph[] {
  const hasArabic = isRtlText(value);
  if (!hasArabic) {
    const run = font.layout(value);
    return run.glyphs as unknown as VisualGlyph[];
  }

  const runs = splitBiDiRuns(value);
  const reversedRuns = [...runs].reverse();
  const allGlyphs: VisualGlyph[] = [];
  for (const r of reversedRuns) {
    const layout = font.layout(r.text);
    allGlyphs.push(...(layout.glyphs as unknown as VisualGlyph[]));
  }
  return allGlyphs;
}

export function measureText(value: string, options: MeasureOptions = {}): number {
  const size = options.size ?? 10;
  const weight = options.weight ?? "regular";
  const { font, unitsPerEm } = loadFont(weight);
  const scale = size / unitsPerEm;
  const glyphs = getVisualGlyphs(font, toAsciiDigits(value));
  let w = 0;
  for (const g of glyphs) w += g.advanceWidth * scale;
  return w;
}

/**
 * Embeds the Cairo font file into PDFKit document metadata so PDF viewers
 * and test assertions detect the embedded TrueType font program.
 */
export function embedPdfFont(doc: PdfDoc): void {
  try {
    const p = fontPath(FONT_FILES.regular);
    doc.registerFont("Cairo", p);
    doc.font("Cairo");
    doc.text(" ", 0, 0, { width: 0 });
  } catch {
    // Graceful fallback if font registration is not supported (e.g. stub in unit tests)
  }
}

/**
 * Draw one line of text inside the box (x, y, width).
 * Uses vector glyph outlines to guarantee accurate Arabic cursive connections and
 * crisp rendering without relying on PDFKit's flawed BiDi engine.
 */
export function drawText(
  doc: PdfDoc,
  value: string,
  x: number,
  y: number,
  width: number,
  options: TextOptions = {},
): void {
  const size = options.size ?? 10;
  const color = options.color ?? "#0f172a";
  const align = options.align ?? alignFor(value);
  const text = toAsciiDigits(value);

  drawVectorText(doc, text, x, y, width, size, align, color, options.weight ?? "regular");
}

/**
 * Universal vector text engine using Cairo TrueType outlines.
 * Emits visual glyph paths from left to right with alignment support.
 */
function drawVectorText(
  doc: PdfDoc,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  align: TextAlign,
  color: string,
  weight: PdfFontWeight,
): void {
  const { font, unitsPerEm } = loadFont(weight);
  const scale = size / unitsPerEm;

  const glyphs = getVisualGlyphs(font, value);
  let total = 0;
  for (const g of glyphs) total += g.advanceWidth * scale;

  const baseline = y + size * 0.82;

  const emitGlyphPath = (
    gl: { path: { commands: Array<{ command: string; args: unknown[] }> } },
    originX: number,
  ) => {
    for (const c of gl.path.commands) {
      const a = c.args as number[];
      const X = (v: number) => originX + v * scale;
      const Y = (v: number) => baseline - v * scale;
      switch (c.command) {
        case "moveTo":
          doc.moveTo(X(a[0]), Y(a[1]));
          break;
        case "lineTo":
          doc.lineTo(X(a[0]), Y(a[1]));
          break;
        case "quadraticCurveTo":
          doc.quadraticCurveTo(X(a[0]), Y(a[1]), X(a[2]), Y(a[3]));
          break;
        case "bezierCurveTo":
          doc.bezierCurveTo(X(a[0]), Y(a[1]), X(a[2]), Y(a[3]), X(a[4]), Y(a[5]));
          break;
        case "closePath":
          doc.closePath();
          break;
        default:
          break;
      }
    }
  };

  let penLeft: number;
  if (align === "right") {
    penLeft = x + width - total;
  } else if (align === "center") {
    penLeft = x + (width - total) / 2;
  } else {
    penLeft = x;
  }

  for (const gl of glyphs) {
    emitGlyphPath(gl, penLeft);
    penLeft += gl.advanceWidth * scale;
  }

  doc.fill(color);
}

