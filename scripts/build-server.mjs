import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url)) + "/..";

/**
 * Bundles the local backend (server/index.ts + shared src/core services)
 * into a single CommonJS file runnable with plain `node dist-server/index.cjs`.
 * No native modules — node:sqlite is built into Node 24.
 */
mkdirSync("dist-server", { recursive: true });

await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist-server/index.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: true,
  legalComments: "none",
  // The WhatsApp wppconnect engine is loaded at runtime from the in-app
  // install (data dir) via createRequire — never bundled, never external.
  //
  // pdfkit evaluates `new URL('./data/sRGB_IEC61966_2_1.icc', import.meta.url)`
  // at MODULE SCOPE. In a CJS bundle esbuild rewrites `import.meta` to an empty
  // object, so that call throws `ERR_INVALID_URL` at import time and the whole
  // server refuses to boot — before serving a single request. Only the PDF/A
  // output path uses the ICC profile (receipts do not), but the throw happens
  // on import so it must be neutralised regardless.
  //
  // `define` cannot help (esbuild only accepts literals there) and a banner is
  // shadowed by esbuild's own `var import_meta = {}` in the same scope, so
  // rewrite the pdfkit source at load time instead.
  plugins: [
    {
      name: "pdfkit-cjs-compat",
      setup(pluginBuild) {
        // pdfkit lazily requires its 14 standard AFM fonts through the
        // package.json "imports" alias `#standard-fonts/*`. esbuild does not
        // resolve that alias inside a CJS bundle, so the runtime require()
        // throws `Cannot find module '#standard-fonts/Helvetica'` the first
        // time PDFKit touches a standard font. Rewrite the alias to the real
        // on-disk path in the source text.
        pluginBuild.onLoad({ filter: /pdfkit[\\/].*\.(mjs|cjs|js)$/ }, (args) => {
          let code = readFileSync(args.path, "utf8");
          const original = code;
          // 1. Usable base URL for data-file lookups (PDF/A ICC profile).
          code = code.replace(
            /import\.meta\.url/g,
            'require("node:url").pathToFileURL(__filename).href',
          );
          // 2. Resolve the `#standard-fonts/*` import alias to real files.
          const stdFontsDir = join(
            rootDir,
            "node_modules",
            "pdfkit",
            "js",
            "standard-fonts",
          ).split("\\").join("/");
          code = code.replace(
            /require\$?\w*\(\s*['"]#standard-fonts\/([A-Za-z-]+)['"]\s*\)/g,
            (_m, name) => `require(${JSON.stringify(`${stdFontsDir}/${name}.cjs`)})`,
          );
          if (code === original) return null;
          return { contents: code, loader: "js" };
        });
      },
    },
  ],
});

console.log("server bundle written to dist-server/index.cjs");
