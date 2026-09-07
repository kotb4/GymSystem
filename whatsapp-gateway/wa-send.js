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
      // The browser may still be settling after a cold launch — the session
      // (#side) often appears a few seconds after the first probe. Give it a
      // few chances before declaring it unpaired.
      let paired = false;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        paired = await wa.isPaired(page);
        if (paired) break;
      }
      if (!paired) return { ok: false, error: 'not paired: run /pair and scan the QR first' };
    }

    const composer = await wa.openChat(page, normalized);

    if (media && media.base64) {
      const err = await wa.attachImage(page, media.caption || message || '', Buffer.from(media.base64, 'base64'));
      if (err) return { ok: false, error: err };
    } else if (message) {
      await composer.click();
      await composer.press('ControlOrMeta+a');
      await composer.type(message, { delay: 5 });
      await page.waitForTimeout(300);
    } else {
      return { ok: false, error: 'nothing to send' };
    }

    // Resilient send-button chain (WhatsApp renamed it before).
    const sendBtn = page
      .locator(
        [
          'span[data-icon="send"]',
          'button[aria-label="Send"]',
          'button[aria-label="إرسال"]',
          '[data-testid="send"]',
        ].join(','),
      )
      .first();
    await sendBtn.waitFor({ timeout: 15000 });
    await sendBtn.click();
    await page.waitForTimeout(900);
    log.info(`sent to ${normalized}`);
    return { ok: true };
  } catch (err) {
    log.error(`send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { send };