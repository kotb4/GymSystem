#!/usr/bin/env node
// Compile scripts/installer.iss into dist-exe/GymSystem-Setup-<ver>.exe.
// Locates ISCC.exe: env ISCC_PATH, common per-user install, ProgramFiles(x86),
// then bare `iscc` on PATH. Fails with a helpful message if none is found.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const iss = path.join(root, "scripts", "installer.iss");

const candidates = [
  process.env.ISCC_PATH,
  path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
  path.join(process.env.ProgramFiles ?? "", "Inno Setup 6", "ISCC.exe"),
  path.join(process.env["ProgramFiles(x86)"] ?? "", "Inno Setup 6", "ISCC.exe"),
  process.platform === "win32" ? "iscc.exe" : "iscc",
].filter(Boolean);

const iscc = candidates.find((c) => fs.existsSync(c) || c === "iscc.exe" || c === "iscc");
if (!iscc) {
  console.error(
    "[build-installer] Inno Setup ISCC.exe was not found.\n" +
      "  Install Inno Setup 6 (winget: JRSoftware.InnoSetup) or set ISCC_PATH to ISCC.exe.",
  );
  process.exit(1);
}

const result = spawnSync(iscc, [iss], { stdio: "inherit", shell: false });
if (result.error) {
  console.error(`[build-installer] failed to run ${iscc}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);