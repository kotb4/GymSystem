import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates the static Arabic PDF fonts from the Cairo variable font.
 *
 * Why this exists: PDFKit's font subsetter mangles a VARIABLE font — it emits a
 * font program that viewers cannot shape, so the PDF renders blank (ADR-040).
 * The app therefore ships two STATIC instances, produced here by fontTools
 * (`fontTools.varLib.instancer`), and `scripts/build-exe.mjs` refuses to
 * package if they are missing.
 *
 * Usage:  npm run build:fonts
 * Source: assets/fonts/Cairo-Variable.ttf  (OFL, from google/fonts)
 * Output: assets/fonts/Cairo-{Regular,Bold}.ttf
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fontsDir = join(root, "assets", "fonts");
const variable = join(fontsDir, "Cairo-Variable.ttf");

if (!existsSync(variable)) {
  console.error(
    "Missing assets/fonts/Cairo-Variable.ttf — download it from google/fonts (ofl/cairo) first.",
  );
  process.exit(1);
}

try {
  execFileSync("python", ["-c", "import fontTools"], { stdio: "ignore" });
} catch {
  console.error("Python with fontTools is required: pip install fonttools");
  process.exit(1);
}

const outRegular = join(fontsDir, "Cairo-Regular.ttf");
const outBold = join(fontsDir, "Cairo-Bold.ttf");

const script = `
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
for wght, out in [(400, r'${outRegular}'), (700, r'${outBold}')]:
    f = TTFont(r'${variable}')
    instantiateVariableFont(f, {'wght': wght, 'slnt': 0}, inplace=True, updateFontNames=True)
    f.save(out)
    g = TTFont(out)
    assert 'fvar' not in g, 'still a variable font'
    assert 'GSUB' in g, 'lost Arabic shaping tables'
    print(out, 'glyphs=', g['maxp'].numGlyphs)
`;

execFileSync("python", ["-c", script], { stdio: "inherit" });

// Sanity: both files must be real TrueType programs, not woff2 in disguise.
for (const name of ["Cairo-Regular.ttf", "Cairo-Bold.ttf"]) {
  const buf = readFileSync(join(fontsDir, name));
  const isTtf =
    (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) ||
    buf.subarray(0, 4).toString("latin1") === "true" ||
    buf.subarray(0, 4).toString("latin1") === "OTTO";
  if (!isTtf) {
    console.error(`${name} is not a TrueType/OpenType program — refusing to continue`);
    process.exit(1);
  }
  console.log(`verified ${name} (${buf.length} bytes)`);
}
