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
    if (!executablePath) {
      log.error('no Edge/Chrome browser found on this machine');
      throw new Error('no compatible browser installed (Microsoft Edge required)');
    }

    const sessionDir = _cfg.sessionDir;
    // Profile (tokens + WhatsApp session data) must live in the app data dir so
    // pairing survives restarts just like the old wa-profile folder. Pass it as
    // puppeteerOptions.userDataDir — wppconnect otherwise defaults to
    // cwd/folderNameToken/session which would scatter state under the repo.
    const puppeteerOptions = {
      executablePath,
      userDataDir: join(sessionDir, 'wpp-profile'),
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    };

    log.info(`launching browser (headless=${_cfg.headless})`);
    const client = await wpp.create({
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
    });
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
};