'use strict';

const log = require('./log');
const { normalizeEgyNumber } = require('./numbers');
const wa = require('./wa-session');

/**
 * Sends a WhatsApp text message, media image, or document to an Egyptian mobile via Baileys WebSocket.
 * Returns { ok:true, messageId?:string } or { ok:false, error:string } — never throws.
 */
async function send(phone, message, media) {
  try {
    const target = String(phone || '').trim();
    if (!target) return { ok: false, error: 'لم يتم تحديد رقم المستلم' };

    let jid;
    if (target.includes('@s.whatsapp.net') || target.includes('@lid')) {
      jid = target;
    } else if (target.includes('@c.us')) {
      jid = target.replace(/@c\.us$/, '@s.whatsapp.net');
    } else {
      const normalized = normalizeEgyNumber(target);
      if (normalized) {
        jid = `${normalized}@s.whatsapp.net`;
      } else {
        const digits = target.replace(/[^\d]/g, '');
        if (digits.length >= 8 && digits.length <= 16) {
          jid = `${digits}@s.whatsapp.net`;
        } else {
          const err = `invalid phone number or recipient JID: ${target}`;
          log.warn(`send rejected invalid target: ${target}`);
          return { ok: false, error: err };
        }
      }
    }

    const { ok, client: sock } = await wa.ensureBrowser();
    if (!ok || !sock) return { ok: false, error: 'محرك الواتساب غير متصل' };

    let paired = await wa.isPaired();
    if (!paired) {
      const waited = await wa.waitForPairing(sock, 15000);
      paired = waited.paired;
    }
    if (!paired) {
      return { ok: false, error: 'لم يتم ربط واتساب بعد — يرجى مسح رمز QR من البرنامج أولاً' };
    }

    const isOpen = await wa.waitForOpen(20000);
    if (!isOpen) {
      return { ok: false, error: 'محرك الواتساب غير متصل حالياً بالإنترنت — يرجى التأكد من اتصال الهاتف بالإنترنت والمحاولة ثانية' };
    }

    let resolvedJid = jid;
    let registeredLid = null;
    let registeredPnJid = null;

    if (!jid.includes('@lid')) {
      const cleanPn = jid.replace(/@.*$/, '');
      const cachedLid = wa.getLidForPhone(cleanPn);
      if (cachedLid) {
        registeredLid = cachedLid.includes('@lid') ? cachedLid : `${cachedLid}@lid`;
      }

      if (sock.onWhatsApp) {
        try {
          const results = await sock.onWhatsApp(jid);
          if (Array.isArray(results)) {
            if (results.length === 0) {
              log.warn(`onWhatsApp reported ${jid} is not on WhatsApp (empty list)`);
              return { ok: false, error: 'الرقم غير مسجل في خدمة واتساب' };
            }
            const contact = results[0];
            if (contact && contact.exists) {
              registeredPnJid = contact.jid || jid;
              if (contact.lid) {
                registeredLid = contact.lid.includes('@lid') ? contact.lid : `${contact.lid}@lid`;
                wa.cacheLidMapping(contact.lid, registeredPnJid);
              }
            } else if (contact && contact.exists === false) {
              log.warn(`onWhatsApp reported ${jid} does not exist`);
              return { ok: false, error: 'الرقم غير مسجل في خدمة واتساب' };
            }
          }
        } catch (err) {
          log.warn(`onWhatsApp query error for ${jid}: ${err.message}`);
        }
      }

      // Modern WhatsApp Multi-Device uses @lid for companion client encryption.
      // Targeting @lid directly ensures the phone client's active Signal ratchet matches the ciphertext,
      // avoiding "Waiting for this message" decryption delay.
      // Fallback to registeredPnJid or jid if LID is not available.
      resolvedJid = registeredLid || registeredPnJid || jid;
    }

    // Pre-warm the session and typing presence to wake recipient device
    try {
      await sock.presenceSubscribe(resolvedJid).catch(() => {});
      await sock.sendPresenceUpdate('composing', resolvedJid).catch(() => {});
      await new Promise((r) => setTimeout(r, 200));
    } catch {}

    const sendTask = (async () => {
      try {
        const extraAliases = [jid, registeredPnJid, registeredLid].filter(Boolean);

        if (media && (media.base64 || media.data)) {
          const rawBase64 = media.base64 || media.data;
          const cleanBase64 = String(rawBase64).replace(/^data:[^;]+;base64,/, '');
          const buffer = Buffer.from(cleanBase64, 'base64');
          const mime = media.mime || media.mimetype || 'image/png';
          const caption = (message && message.trim()) ? message : (media.caption || '');

          const payload = mime.startsWith('image/')
            ? { image: buffer, mimetype: mime, caption: caption || undefined }
            : { document: buffer, mimetype: mime, fileName: media.filename || 'card.png', caption: caption || undefined };

          let sent;
          try {
            sent = await sock.sendMessage(resolvedJid, payload);
          } catch (firstErr) {
            const fallbackJid = (resolvedJid === registeredLid) ? (registeredPnJid || jid) : registeredLid;
            if (fallbackJid && resolvedJid !== fallbackJid) {
              log.warn(`send media to ${resolvedJid} failed (${firstErr.message}), falling back to ${fallbackJid}`);
              sent = await sock.sendMessage(fallbackJid, payload);
              resolvedJid = fallbackJid;
            } else {
              throw firstErr;
            }
          }

          if (sent && sent.key && sent.message) {
            wa.saveMessage(sent.key, sent.message, extraAliases);
            if (wa.markBotSentMessageId && sent.key.id) {
              wa.markBotSentMessageId(sent.key.id);
            }
          }
          log.info(`sent media message to ${resolvedJid} (mime=${mime}, id=${sent?.key?.id})`);
          return { ok: true, messageId: sent?.key?.id };
        }

        if (message && message.trim()) {
          const payload = { text: message.trim() };
          let sent;
          try {
            sent = await sock.sendMessage(resolvedJid, payload);
          } catch (firstErr) {
            const fallbackJid = (resolvedJid === registeredLid) ? (registeredPnJid || jid) : registeredLid;
            if (fallbackJid && resolvedJid !== fallbackJid) {
              log.warn(`send text to ${resolvedJid} failed (${firstErr.message}), falling back to ${fallbackJid}`);
              sent = await sock.sendMessage(fallbackJid, payload);
              resolvedJid = fallbackJid;
            } else {
              throw firstErr;
            }
          }

          if (sent && sent.key && sent.message) {
            wa.saveMessage(sent.key, sent.message, extraAliases);
            if (wa.markBotSentMessageId && sent.key.id) {
              wa.markBotSentMessageId(sent.key.id);
            }
          }
          log.info(`sent text message to ${resolvedJid} (id=${sent?.key?.id})`);
          return { ok: true, messageId: sent?.key?.id };
        }

        return { ok: true };
      } finally {
        try {
          await sock.sendPresenceUpdate('paused', resolvedJid).catch(() => {});
        } catch {}
      }
    })();

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('انتهت مهلة إرسال رسالة الواتساب (60 ثانية)')), 60000);
    });

    return await Promise.race([sendTask, timeoutPromise]);
  } catch (err) {
    const rawMsg = String((err && err.message) || err);
    log.error(`send to ${phone} failed: ${rawMsg}`);
    return { ok: false, error: rawMsg };
  }
}

module.exports = { send };