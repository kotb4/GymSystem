'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { join } = require('node:path');
const log = require('./log');

let _context = null;
let _page = null;
let _launching = null;
let _cfg = null;

function setCfg(cfg) {
  _cfg = cfg;
}

async function ensureBrowser() {
  // Zombie guard: the visible window may have been closed or the context may
  // have died while the gateway kept running — relaunch fresh instead of
  // silently failing every later /pair and /send forever.
  if (_page && _page.isClosed()) {
    try {
      if (_context) await _context.close();
    } catch {
      /* already gone */
    }
    _page = null;
    _context = null;
    _launching = null;
  }
  if (_page) return { ok: true, page: _page };
  if (_launching) return _launching;

  _launching = (async () => {
    const { chromium } = require('playwright');
    fs.mkdirSync(_cfg.sessionDir, { recursive: true });
    log.info(`launching browser (channel=${_cfg.channel}, headless=${_cfg.headless})`);
    _context = await chromium.launchPersistentContext(
      join(_cfg.sessionDir, 'wa-profile'),
      {
        headless: _cfg.headless,
        channel: _cfg.channel === 'chromium' ? undefined : _cfg.channel,
        args: ['--disable-blink-features=AutomationControlled'],
        viewport: { width: 1280, height: 800 },
      },
    );
    const pages = _context.pages();
    _page = pages[0] || (await _context.newPage());
    _page.setDefaultTimeout(30000);
    log.debug('navigating to web.whatsapp.com');
    await _page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded' });
    return true;
  })()
    .then((ok) => {
      _launching = null;
      return ok ? { ok: true, page: _page } : { ok: false };
    })
    .catch((err) => {
      log.error(`browser launch failed: ${err.message}`);
      _launching = null;
      _page = null;
      _context = null;
      return { ok: false };
    });
  return _launching;
}

async function isPaired(page) {
  if (!page) return false;
  try {
    await page.waitForSelector('#side', { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cheap health probe: reports pairing state WITHOUT launching the browser.
 * `browserReady:false` simply means "not launched yet" — /pair launches it.
 * Keeps /health instant so callers (ensure route, pairing modal polling)
 * never time out behind a cold browser launch.
 */
async function healthStatus() {
  if (_page && !_page.isClosed()) {
    // Instant check — never waitForSelector here: /health is polled as a
    // liveness probe and must never lag behind a slow pairing state.
    try {
      const loggedIn = await _page.evaluate(() => !!document.querySelector('#side')).catch(() => false);
      return { browserReady: true, paired: loggedIn };
    } catch {
      return { browserReady: true, paired: false };
    }
  }
  return { browserReady: false, paired: false };
}

async function readQr(page) {
  try {
    // WhatsApp Web changed its DOM more than once: the QR used to be
    // `canvas[data-ref]`, now `[data-ref]` sits on a plain wrapper while the
    // QR itself may be a canvas, an img or anything else. So do NOT assume an
    // element type — locate the QR node in any frame and SCREENSHOT it.
    for (const frame of page.frames()) {
      const handle = await frame
        .evaluateHandle(() => {
          return (
            document.querySelector('canvas[data-ref]') ||
            document.querySelector('[data-ref] canvas') ||
            document.querySelector('[data-ref]') ||
            document.querySelector('canvas')
          );
        })
        .catch(() => null);
      const el = handle ? handle.asElement() : null;
      if (!el) continue;
      // Let the QR re-render for a beat so the latest frame is captured.
      await page.waitForTimeout(250);
      const buf = await el.screenshot({ type: 'png' }).catch(() => null);
      if (buf && buf.length > 500) {
        const base64 = buf.toString('base64');
        const file = join(_cfg.sessionDir, 'pairing-qr.png');
        fs.writeFileSync(file, buf);
        return { pngPath: file, pngBase64: base64 };
      }
    }
    return null;
  } catch (err) {
    log.warn(`qr capture failed: ${err.message}`);
    return null;
  }
}

async function waitForPairing(page, timeoutMs = 180000) {
  const started = Date.now();
  const base64 = await readQr(page);
  while (Date.now() - started < timeoutMs) {
    if (await isPaired(page)) return { paired: true };
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { paired: false };
}

async function openChat(page, phone) {
  // Use the search box; WhatsApp resolves contact chats even when not in the list.
  const search = page.locator('div[contenteditable="true"][data-tab="3"]');
  await search.waitFor({ timeout: 15000 });
  await search.click();
  await search.fill('');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(phone, { delay: 40 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const input = page.locator('div[contenteditable="true"][data-tab="10"]');
  await input.waitFor({ timeout: 10000 });
  return input;
}

async function attachImage(page, caption, pngBytes) {
  const tmp = join(_cfg.sessionDir, `send-${Date.now()}.png`);
  fs.writeFileSync(tmp, pngBytes);
  try {
    const input = page.locator('div[contenteditable="true"][data-tab="10"]');
    await input.waitFor({ timeout: 10000 });
    await input.click();
    await input.fill('');
    if (caption) await input.type(caption, { delay: 5 });
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
    await page.locator('div[data-tab="6"][aria-label="Attach"]').click();
    // First menu item is the immediate "Photos & videos" upload.
    await page.locator('ul[role="menu"] li').first().click();
    const chooser = await chooserPromise;
    await chooser.setFiles(tmp);
    await page.waitForTimeout(1800);
    return null;
  } catch (err) {
    return err.message;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* temp already gone */
    }
  }
}

async function close() {
  try {
    if (_context) {
      await _context.close();
      log.info('browser closed');
    }
  } catch {
    /* best effort */
  }
  _context = null;
  _page = null;
  _launching = null;
}

module.exports = {
  setCfg,
  ensureBrowser,
  healthStatus,
  isPaired,
  readQr,
  waitForPairing,
  openChat,
  attachImage,
  close,
};