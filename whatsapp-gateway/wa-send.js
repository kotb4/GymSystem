'use strict';

const log = require('./log');
const { normalizeEgyNumber } = require('./numbers');
const wa = require('./wa-session');

/**
 * Sends a WhatsApp message, image (+caption), or both to an Egyptian mobile.
 * Returns { ok:true } or { ok:false, error } — never throws.
 *
 * wppconnect wraps the page and exposes stable, script-injected send APIs
 * (WPP.chat) so no DOM selector dance is needed — unlike the old Playwright
 * composer walk, this survives WhatsApp Web UI changes.
 */
async function send(phone, message, media) {
  try {
    const normalized = normalizeEgyNumber(phone);
    if (!normalized) return { ok: false, error: `invalid Egyptian number: ${phone}` };

    const { ok, client } = await wa.ensureBrowser();
    if (!ok || !client) return { ok: false, error: 'browser unavailable' };

    if (!(await wa.isPaired(client))) {
      // The browser may still be settling after a cold launch — the session
      // often goes in-chat a few seconds after pairing. Give it chances.
      const waited = await wa.waitForPairing(client, 40000);
      if (!waited.paired) return { ok: false, error: 'not paired: run /pair and scan the QR first' };
    }

    const chatId = `${normalized}@c.us`;

    if (media && media.base64) {
      const mime = media.mime || 'image/png';
      const dataUrl = `data:${mime};base64,${media.base64}`;
      const filename = `gym-card-${Date.now()}.${mime.split('/')[1] || 'png'}`;
      const caption = media.caption || message || '';
      await client.sendFileFromBase64(chatId, dataUrl, filename, caption);
    } else if (message) {
      await client.sendText(chatId, message);
    } else {
      return { ok: false, error: 'nothing to send' };
    }

    log.info(`sent to ${normalized}`);
    return { ok: true };
  } catch (err) {
    log.error(`send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { send };