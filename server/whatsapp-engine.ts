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

const BAILEYS_PACKAGE = "@whiskeysockets/baileys";
const BAILEYS_VERSION = "^6.7.24";
const EXTRA_PACKAGES = ["pino@^8.21.0", "qrcode@^1.5.4", "@hapi/boom@^10.0.1"];

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

function baileysPkgPath(dir: string): string {
  return path.join(dir, "node_modules", BAILEYS_PACKAGE);
}

function readInstalledVersion(dir: string): string | null {
  try {
    const localPkg = path.join(process.cwd(), "whatsapp-gateway", "node_modules", BAILEYS_PACKAGE, "package.json");
    if (fs.existsSync(localPkg)) {
      return JSON.parse(fs.readFileSync(localPkg, "utf8")).version ?? null;
    }
    return JSON.parse(fs.readFileSync(path.join(baileysPkgPath(dir), "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function isInstalled(dir: string): boolean {
  const localPkg = path.join(process.cwd(), "whatsapp-gateway", "node_modules", BAILEYS_PACKAGE, "package.json");
  if (fs.existsSync(localPkg)) return true;
  return fs.existsSync(path.join(baileysPkgPath(dir), "package.json"));
}

/**
 * Load the wppconnect module from the engine install. Throws when the engine
 * has not been installed yet (the Settings UI guides the user to install it).
 * Used by both the in-process WhatsApp client and anything that needs WPP APIs
 * without spawning the gateway process.
 */
export function loadWppconnect(): unknown {
  const localPkg = path.join(process.cwd(), "whatsapp-gateway", "node_modules", BAILEYS_PACKAGE);
  if (fs.existsSync(localPkg)) {
    const req = createRequire(path.join(process.cwd(), "whatsapp-gateway", "package.json"));
    return req(BAILEYS_PACKAGE);
  }
  const dir = engineDir();
  if (!isInstalled(dir)) {
    throw new Error(
      "whatsapp engine not installed — run «تثبيت محرك الواتساب» from Settings first",
    );
  }
  const requireFromEngine = createRequire(path.join(dir, "package.json"));
  return requireFromEngine(baileysPkgPath(dir));
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
    try {
      const { terminateGatewayProcessOnPort } = await import("./gateway-spawn.js");
      terminateGatewayProcessOnPort(8891, (msg) => logLine(`[whatsapp-engine] pre-install: ${msg}`));
    } catch {}

    fs.mkdirSync(dir, { recursive: true });
    const pkgFile = path.join(dir, "package.json");
    let rewritePkg = !fs.existsSync(pkgFile);
    if (fs.existsSync(pkgFile)) {
      try {
        JSON.parse(fs.readFileSync(pkgFile, "utf8"));
      } catch {
        rewritePkg = true;
      }
    }
    if (rewritePkg) {
      fs.writeFileSync(
        pkgFile,
        JSON.stringify(
          {
            name: "gym-whatsapp-engine",
            private: true,
            version: "1.0.0",
            dependencies: {
              [BAILEYS_PACKAGE]: BAILEYS_VERSION,
              pino: "^8.21.0",
              qrcode: "^1.5.4",
              "@hapi/boom": "^10.0.1",
            },
          },
          null,
          2,
        ),
      );
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
      "--save",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      `--cache=${npmCache}`,
      BAILEYS_PACKAGE + "@" + BAILEYS_VERSION,
      ...EXTRA_PACKAGES,
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

    try {
      const { ensureGateway, probeGateway } = await import("./gateway-spawn.js");
      const url = "http://127.0.0.1:8891";
      if (await probeGateway(url, 400)) {
        logLine("[whatsapp-engine] restarting gateway to load newly installed engine");
        await ensureGateway(url, { packaged: opts.packaged, log: logLine, forceRestart: true });
      }
    } catch (e: any) {
      logLine(`[whatsapp-engine] post-install gateway restart notice: ${e?.message || e}`);
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