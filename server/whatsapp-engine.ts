import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { resolveAppDirs } from "./config.js";
import { logLine } from "./context.js";

/**
 * In-app WhatsApp engine installer.
 *
 * The gateway (and the in-process server/whatsapp client) are powered by
 * `@wppconnect-team/wppconnect`, which is NOT shipped with the app or the
 * gateway — it is installed ONCE into the GymSystem data dir
 * (`<dataDir>/WhatsAppEngine`) from inside the Settings UI. wppconnect runs
 * puppeteer on the user's installed Microsoft Edge, so the install sets
 * PUPPETEER_SKIP_DOWNLOAD=1 (no ~180MB Chromium download).
 *
 * npm resolution: dev builds use the PATH `npm`; the packaged EXE ships a
 * bundled npm under `runtime/npm` (copied by scripts/build-exe.mjs).
 */

const WPP_PACKAGE = "@wppconnect-team/wppconnect";
const WPP_VERSION = "2.3.3";

export interface EngineStatus {
  engineDir: string;
  installed: boolean;
  version: string | null;
  installing: boolean;
  lastError: string | null;
  logTail: string[];
}

/** Engine lives beside Database/ under the app data root (survives EXE updates). */
export function engineDir(): string {
  return path.join(resolveAppDirs().root, "WhatsAppEngine");
}

function wppPkgPath(dir: string): string {
  return path.join(dir, "node_modules", WPP_PACKAGE);
}

function readInstalledVersion(dir: string): string | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(wppPkgPath(dir), "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function isInstalled(dir: string): boolean {
  return fs.existsSync(path.join(wppPkgPath(dir), "package.json"));
}

/**
 * Load the wppconnect module from the engine install. Throws when the engine
 * has not been installed yet (the Settings UI guides the user to install it).
 * Used by both the in-process WhatsApp client and anything that needs WPP APIs
 * without spawning the gateway process.
 */
export function loadWppconnect(): any {
  const dir = engineDir();
  if (!isInstalled(dir)) {
    throw new Error(
      "whatsapp engine not installed — run «تثبيت محرك الواتساب» from Settings first",
    );
  }
  // Root the require at the engine dir so wppconnect's own deps (puppeteer,
  // sharp, ...) resolve from the engine's node_modules tree.
  const requireFromEngine = createRequire(path.join(dir, "package.json"));
  return requireFromEngine(wppPkgPath(dir));
}

/** Dev → PATH npm. Packaged → bundled `runtime\node.exe runtime\npm\bin\npm-cli.js`. */
function resolveNpmInvocation(packaged: boolean): { file: string; args: string[] } {
  if (packaged) {
    const appDir = path.dirname(process.execPath);
    const nodeBin = path.join(appDir, "runtime", "node.exe");
    const npmCli = path.join(appDir, "runtime", "npm", "bin", "npm-cli.js");
    if (!fs.existsSync(nodeBin) || !fs.existsSync(npmCli)) {
      throw new Error("bundled npm runtime missing (runtime/node.exe + runtime/npm)");
    }
    return { file: nodeBin, args: [npmCli] };
  }
  return { file: process.platform === "win32" ? "npm.cmd" : "npm", args: [] };
}

// ---- install state (single-flight) ----------------------------------------

let installing = false;
let lastError: string | null = null;
let logTail: string[] = [];

function pushLog(line: string): void {
  logTail.push(line);
  if (logTail.length > 200) logTail.splice(0, logTail.length - 200);
}

function cleanState(): void {
  installing = false;
  lastError = null;
}

/** Start the engine install if it is not already running. Returns true when started. */
export async function startEngineInstall(opts: { packaged: boolean }): Promise<boolean> {
  if (installing) return false;
  const dir = engineDir();
  installing = true;
  lastError = null;
  logTail = [];

  try {
    fs.mkdirSync(dir, { recursive: true });
    const pkgFile = path.join(dir, "package.json");
    if (!fs.existsSync(pkgFile)) {
      fs.writeFileSync(pkgFile, JSON.stringify({ name: "gym-whatsapp-engine", private: true, version: "1.0.0" }, null, 2));
    }

    const npmCache = path.join(dir, ".npm-cache");
    fs.mkdirSync(npmCache, { recursive: true });
    // Concise log capture for the progress UI (internal logTail buffered too).
    const logFile = path.join(dir, "install.log");
    const stream = fs.createWriteStream(logFile, { flags: "w" });

    const { file, args } = resolveNpmInvocation(opts.packaged);
    const installArgs = [
      ...args,
      "install",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      `--cache=${npmCache}`,
      WPP_PACKAGE + "@" + WPP_VERSION,
    ];
    pushLog(`running: ${file} ${installArgs.join(" ")}`);
    logLine(`[whatsapp-engine] install start`);

    const child = spawn(file, installArgs, {
      cwd: dir,
      env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1", npm_config_ignore_scripts: "false" },
      shell: file === "npm.cmd",
      windowsHide: true,
    });

    const capture = (chunk: Buffer): void => {
      const text = chunk.toString().replace(/\s+$/, "");
      if (!text) return;
      logTail.push(text);
      if (logTail.length > 200) logTail.splice(0, logTail.length - 200);
      try {
        stream.write(text + "\n");
      } catch {
        /* log best-effort */
      }
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    const code = await new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c ?? null)));
    stream.end();
    logLine(`[whatsapp-engine] install finished (exit=${code})`);

    if (code !== 0) {
      lastError = `npm install exited with code ${code}`;
      pushLog(`ERROR: ${lastError}`);
      return false;
    }
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    logLine(`[whatsapp-engine] install failed: ${lastError}`);
    pushLog(`ERROR: ${lastError}`);
    return false;
  } finally {
    cleanState();
  }
}

export function engineStatus(): EngineStatus {
  const dir = engineDir();
  const version = readInstalledVersion(dir);
  return {
    engineDir: dir,
    installed: isInstalled(dir),
    version,
    installing,
    lastError,
    logTail: [...logTail],
  };
}