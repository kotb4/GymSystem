'use strict';

const log = require('./log');
const { normalizeEgyNumber } = require('./numbers');
const wa = require('./wa-session');

/**
 * Sends a WhatsApp message, image (+caption), or both to an Egyptian mobile.
 * Returns { ok:true } or { ok:false, error } — never throws.
 */
async function send(phone, message, media) {
  try {
    const normalized = normalizeEgyNumber(phone);
    if (!normalized) return { ok: false, error: `invalid Egyptian number: ${phone}` };

    const { ok, page } = await wa.ensureBrowser();
    if (!ok || !page) return { ok: false, error: 'browser unavailable' };

    if (!(await wa.isPaired(page))) {
      return { ok: false, error: 'not paired: run /pair and scan the QR first' };
    }

    await wa.openChat(page, normalized);

    if (media && media.base64) {
      const err = await wa.attachImage(page, media.caption || message || '', Buffer.from(media.base64, 'base64'));
      if (err) return { ok: false, error: err };
    } else if (message) {
      const input = page.locator('div[contenteditable="true"][data-tab="10"]');
      await input.fill('');
      await input.type(message, { delay: 5 });
      await page.waitForTimeout(400);
    } else {
      return { ok: false, error: 'nothing to send' };
    }

    const sendBtn = page.locator('span[data-icon="send"]').first();
    await sendBtn.waitFor({ timeout: 20000 });
    await sendBtn.click();
    await page.waitForTimeout(1200);
    log.info(`sent to ${normalized}`);
    return { ok: true };
  } catch (err) {
    log.error(`send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { send };