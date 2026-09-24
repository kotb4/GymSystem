'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const log = require('./log');

let _client = null;
let _pairing = null;
let _cfg = null;
let _lastQrBase64 = null; // raw PNG base64 (no data: prefix) for the last catchQR frame

function setCfg(cfg) {
  _cfg = cfg;
}

function getEngineDir() {
  return _cfg && _cfg.engineDir ? _cfg.engineDir : join(require('./config').baseDataDir(), 'WhatsAppEngine');
}

/**
 * Load wppconnect from the in-app engine (installed into the GymSystem data
 * dir by the backend /api/system/gateway/install-engine flow). The packaged
 * gateway carries NO node_modules — the engine is fetched once into the data
 * dir, then shared by every future launch.
 */
function loadWpp() {
  const engineDir = getEngineDir();
  const pkgPath = join(engineDir, 'node_modules', '@wppconnect-team', 'wppconnect');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      'engine not installed: run "تثبيت محرك الواتساب" from Settings first (expected wppconnect under the data dir).',
    );
  }
  // createRequire keeps the resolution rooted at the engine dir so wppconnect's
  // own requires (puppeteer, sharp, ...) resolve from the engine's node_modules.
  const requireFromEngine = createRequire(join(engineDir, 'package.json'));
  return requireFromEngine(pkgPath);
}

/** Resolve the installed Microsoft Edge executable (Windows-first). */
function resolveBrowserPath() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Strip a `data:image/png;base64,` prefix into plain base64, if present. */
function toRawBase64(value) {
  if (!value) return null;
  const idx = value.indexOf(',');
  return idx >= 0 ? value.slice(idx + 1) : value;
}

// Chromium-scoped profile litter that survives a killed/crashed gateway launch
// and then blocks the NEXT cold start with "The browser is already running for
// <userDataDir> … use a different userDataDir" until removed by hand.
const PROFILE_LOCK_FILES = [
  'lockfile',
  'DevToolsActivePort',
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
];

function killOrphanedBrowserProcesses(userDataDir) {
  if (process.platform !== 'win32' || !userDataDir) return;
  try {
    // eslint-disable-next-line global-require
    const { execSync } = require('node:child_process');
    const out = execSync('wmic process where "name=\'msedge.exe\' or name=\'chrome.exe\'" get ProcessId,CommandLine /format:csv', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(userDataDir) || line.includes('wpp-profile') || line.includes('WhatAppGateway')) {
        const parts = line.split(',');
        const pid = parts[parts.length - 1].trim();
        if (pid && !isNaN(Number(pid))) {
          try {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
            log.warn(`terminated orphaned browser process PID ${pid}`);
          } catch {}
        }
      }
    }
  } catch (err) {
    log.warn(`could not inspect/kill orphaned browser processes: ${err.message}`);
  }
}

/**
 * True when any running Edge/Chrome process has `profileDir` in its command
 * line. Guards deleteStaleProfileLocks: locks of a LIVE browser must never be
 * removed, only the litter left behind by a crashed launch.
 */
function browserProcessHolds(profileDir) {
  try {
    // eslint-disable-next-line global-require
    const { execFileSync } = require('node:child_process');
    const needle = String(profileDir).replace(/'/g, "''");
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | ` +
      `Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf('${needle}', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | ` +
      `Measure-Object | Select-Object -ExpandProperty Count`;
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 4000, windowsHide: true },
    );
    return String(out).trim() !== '0';
  } catch {
    // Cannot inspect (PowerShell unavailable) → assume the profile is in use so
    // we never delete a live browser's locks by mistake.
    return true;
  }
}

/**
 * Cold-start hardening: remove Chromium singleton/devtools lock litter from the
 * profile dir. Terminates orphaned browser processes when force=true or when
 * no active gateway client owns the browser.
 */
function clearStaleLocks(userDataDir, { force = false } = {}) {
  if (!userDataDir) return [];
  if (!fs.existsSync(userDataDir)) return [];
  if (force) {
    killOrphanedBrowserProcesses(userDataDir);
  } else if (browserProcessHolds(userDataDir)) {
    log.warn('orphaned browser process holds the profile — terminating before launch');
    killOrphanedBrowserProcesses(userDataDir);
  }
  const locks = PROFILE_LOCK_FILES.map((name) => join(userDataDir, name)).filter((p) => fs.existsSync(p));
  if (!locks.length) return [];
  for (const lock of locks) {
    try {
      fs.rmSync(lock, { force: true, recursive: true });
      log.warn(`removed stale browser lock: ${lock}`);
    } catch (err) {
      log.warn(`could not remove stale lock ${lock}: ${err.message}`);
    }
  }
  return locks;
}

async function ensureBrowser() {
  // Zombie guard: if the previous client closed its page (browser killed,
  // session logged out on the phone, etc.), drop it and relaunch fresh.
  if (_client) {
    const page = _client.waPage;
    if (page && page.isClosed()) {
      try {
        await _client.close();
      } catch {
        /* already gone */
      }
      _client = null;
    }
  }
  if (_client) return { ok: true, client: _client };
  if (_pairing) return _pairing;

  _pairing = (async () => {
    fs.mkdirSync(_cfg.sessionDir, { recursive: true });
    const wpp = loadWpp();
    const executablePath = resolveBrowserPath();
    const sessionDir = _cfg.sessionDir;
    const profileDir = join(sessionDir, 'wpp-profile');
    // Cold-start hardening: a gateway killed mid-launch (app force-quit,
    // session cleanup, machine shutdown) leaves Chromium singleton/devtools
    // litter in the profile that makes the NEXT launch fail with "The browser
    // is already running for … use a different userDataDir". Clear it first —
    // safely (only when no live Edge/Chrome holds the profile).
    clearStaleLocks(profileDir);

    // Profile (tokens + WhatsApp session data) must live in the app data dir so
    // pairing survives restarts just like the old wa-profile folder. Pass it as
    // puppeteerOptions.userDataDir — wppconnect otherwise defaults to
    // cwd/folderNameToken/session which would scatter state under the repo.
    const puppeteerOptions = {
      userDataDir: profileDir,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    };
    if (executablePath) {
      puppeteerOptions.executablePath = executablePath;
    }

    log.info(`launching browser (headless=${_cfg.headless})`);
    const options = {
      session: 'gym-gateway',
      headless: _cfg.headless,
      // useChrome:false + our own executablePath = Edge wins; without this
      // wppconnect overwrites the path with its chrome-launcher lookup.
      useChrome: false,
      waitForLogin: false, // return fast; pairing/QR come via catchQR/statusFind
      autoClose: false, // default 60000 would kill the session browser
      logQR: false,
      updatesLog: false,
      disableWelcome: true,
      puppeteerOptions,
      catchQR: (base64Image, _asciiQR, attempt, _urlCode) => {
        _lastQrBase64 = toRawBase64(base64Image);
        log.info(`QR captured (attempt ${attempt})`);
      },
      statusFind: (status, session) => {
        log.debug(`status: ${status} (${session})`);
        if (status === 'inChat') _lastQrBase64 = null;
      },
    };

    let client;
    try {
      client = await wpp.create(options);
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/already running|userDataDir|DevToolsActivePort|SingletonLock|Failed to launch/i.test(msg)) {
        // Same class of failure as above, surfacing through the real launch —
        // force-clear (the failed launch itself proves nothing alive owns the
        // profile) and retry exactly once.
        log.warn(`launch failed on stale profile locks — clearing and retrying once: ${msg}`);
        clearStaleLocks(profileDir, { force: true });
        client = await wpp.create(options);
      } else {
        throw err;
      }
    }

    _client = client;
    log.info('browser session connected to WhatsApp Web');
    return { ok: true, client: _client };
  })().catch((err) => {
    log.error(`browser launch failed: ${err.message}`);
    _client = null;
    return { ok: false, error: err.message };
  }).finally(() => {
    _pairing = null;
  });
  return _pairing;
}

/**
 * Cheap health probe: reports pairing state WITHOUT launching the browser.
 * `browserReady:false` simply means "not launched yet" — /pair launches it.
 * Keeps /health instant so callers (ensure route, pairing modal polling)
 * never time out behind a cold browser launch.
 */
/** True when the wppconnect engine is installed in the data dir (no launch). */
function engineReady() {
  try {
    loadWpp();
    return true;
  } catch {
    return false;
  }
}

async function healthStatus() {
  if (_client) {
    try {
      const page = _client.waPage;
      if (page && page.isClosed()) {
        _client = null;
        return { browserReady: false, paired: false };
      }
      return { browserReady: true, paired: _client.isInChat === true };
    } catch {
      return { browserReady: true, paired: false };
    }
  }
  return { browserReady: false, paired: false };
}

async function isPaired(clientOrNull) {
  const client = clientOrNull || _client;
  if (!client) return false;
  try {
    const page = client.waPage;
    if (page && page.isClosed()) return false;
    return client.isInChat === true;
  } catch {
    return false;
  }
}

/**
 * Return the latest QR frame as { pngBase64 } (plain base64, no data: prefix),
 * or null while no QR is on screen. The in-gateway client renders the QR into
 * a canvas and wppconnect surfaces it via catchQR — we snapshot the latest one.
 */
async function readQr(clientOrNull) {
  const client = clientOrNull || _client;
  if (!client) return null;
  try {
    // Refresh attempt from the live page when possible (the QR rotates every
    // ~20s; grabbing the current frame keeps the pairing modal accurate).
    const fresh = await client.getQrCode().catch(() => null);
    const raw = toRawBase64(fresh && fresh.base64Image ? fresh.base64Image : _lastQrBase64);
    if (raw) {
      const file = join(_cfg.sessionDir, 'pairing-qr.png');
      try {
        fs.writeFileSync(file, Buffer.from(raw, 'base64'));
      } catch {
        /* stale path is fine */
      }
      return { pngBase64: raw };
    }
    return null;
  } catch (err) {
    log.warn(`qr capture failed: ${err.message}`);
    return null;
  }
}

async function waitForPairing(client, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isPaired(client)) return { paired: true };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { paired: false };
}

async function close() {
  try {
    if (_client) {
      await _client.close();
      log.info('browser closed');
    }
  } catch {
    /* best effort */
  }
  _client = null;
  _lastQrBase64 = null;
}

module.exports = {
  setCfg,
  getEngineDir,
  ensureBrowser,
  engineReady,
  healthStatus,
  isPaired,
  readQr,
  waitForPairing,
  close,
  clearStaleLocks,
};