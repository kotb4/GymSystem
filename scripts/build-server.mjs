import { build } from "esbuild";
import { mkdirSync } from "node:fs";

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
});

console.log("server bundle written to dist-server/index.cjs");
