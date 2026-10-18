'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const log = require('./log');

let _sock = null;
let _connecting = null;
let _reconnectTimer = null;
let _cfg = null;
let _lastQrBase64 = null; // raw PNG base64 (no data: prefix)
let _isPairedState = false;
let _baileysModule = null;
const _lidPhoneMap = new Map();
const _phoneLidMap = new Map();
const _messageStore = new Map();
const MAX_MESSAGE_CACHE = 5000;
let _saveTimeout = null;
let _saveLidTimeout = null;

function getMsgCachePath() {
  const sessionDir = (_cfg && _cfg.sessionDir) || require('./config').config().sessionDir;
  return join(sessionDir, 'messages_cache.json');
}

function getLidCachePath() {
  const sessionDir = (_cfg && _cfg.sessionDir) || require('./config').config().sessionDir;
  return join(sessionDir, 'lid_mappings.json');
}

function loadPersistedLidMappings() {
  try {
    const file = getLidCachePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && data.lidToPhone) {
        for (const [k, v] of Object.entries(data.lidToPhone)) {
          _lidPhoneMap.set(k, v);
        }
      }
      if (data && data.phoneToLid) {
        for (const [k, v] of Object.entries(data.phoneToLid)) {
          _phoneLidMap.set(k, v);
        }
      }
      log.info(`loaded ${_phoneLidMap.size} cached WhatsApp LID mappings`);
    }
  } catch (err) {
    log.warn(`could not load lid_mappings: ${err.message}`);
  }
}

function persistLidMappingsDebounced() {
  if (_saveLidTimeout) return;
  _saveLidTimeout = setTimeout(() => {
    _saveLidTimeout = null;
    try {
      const file = getLidCachePath();
      const obj = {
        lidToPhone: Object.fromEntries(_lidPhoneMap),
        phoneToLid: Object.fromEntries(_phoneLidMap),
      };
      fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
    } catch {}
  }, 1000);
}

function loadPersistedMessages() {
  loadPersistedLidMappings();
  try {
    const file = getMsgCachePath();
    if (fs.existsSync(file)) {
      if (!_baileysModule) {
        try { loadBaileys(); } catch {}
      }
      const reviver = _baileysModule && _baileysModule.BufferJSON ? _baileysModule.BufferJSON.reviver : undefined;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'), reviver);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.key && item.message) {
            _messageStore.set(item.key, item.message);
          }
        }
        log.info(`loaded ${_messageStore.size} cached WhatsApp messages for retry decryption`);
      }
    }
  } catch (err) {
    log.warn(`could not load messages_cache: ${err.message}`);
  }
}

function persistMessagesDebounced() {
  if (_saveTimeout) return;
  _saveTimeout = setTimeout(() => {
    _saveTimeout = null;
    try {
      const file = getMsgCachePath();
      const entries = [];
      const keys = Array.from(_messageStore.keys());
      const recentKeys = keys.slice(-3000);
      for (const k of recentKeys) {
        entries.push({ key: k, message: _messageStore.get(k) });
      }
      if (!_baileysModule) {
        try { loadBaileys(); } catch {}
      }
      const replacer = _baileysModule && _baileysModule.BufferJSON ? _baileysModule.BufferJSON.replacer : undefined;
      fs.writeFileSync(file, JSON.stringify(entries, replacer), 'utf8');
    } catch {}
  }, 2000);
}

function isRichMessage(m) {
  if (!m) return false;
  return Boolean(m.imageMessage || m.documentMessage || m.extendedTextMessage?.text || m.conversation);
}

function saveMessage(key, message, extraAliases = []) {
  if (!key || !key.id || !message) return;
  const id = String(key.id);
  const remoteJid = key.remoteJid ? String(key.remoteJid) : '';
  const compoundKey = `${remoteJid}_${id}`;
  const rawMsg = message.message || message;

  // Don't overwrite an existing rich message with an empty or non-rich stub
  const existing = _messageStore.get(id);
  if (existing && !isRichMessage(rawMsg) && isRichMessage(existing)) {
    return;
  }

  _messageStore.set(compoundKey, rawMsg);
  _messageStore.set(id, rawMsg);

  if (key.participant) {
    _messageStore.set(`${key.participant}_${id}`, rawMsg);
  }

  const rawId = remoteJid.replace(/@.*$/, '');
  const mappedPhone = _lidPhoneMap.get(rawId);
  if (mappedPhone) {
    _messageStore.set(`${mappedPhone}@s.whatsapp.net_${id}`, rawMsg);
  }
  const mappedLid = _phoneLidMap.get(rawId);
  if (mappedLid) {
    _messageStore.set(`${mappedLid}@lid_${id}`, rawMsg);
  }

  if (Array.isArray(extraAliases)) {
    for (const alias of extraAliases) {
      if (alias) {
        const cleanAlias = String(alias).trim();
        _messageStore.set(`${cleanAlias}_${id}`, rawMsg);
        const withoutDomain = cleanAlias.replace(/@.*$/, '');
        _messageStore.set(`${withoutDomain}_${id}`, rawMsg);
      }
    }
  }

  if (_messageStore.size > MAX_MESSAGE_CACHE) {
    const toDelete = _messageStore.size - MAX_MESSAGE_CACHE;
    let count = 0;
    for (const k of _messageStore.keys()) {
      _messageStore.delete(k);
      if (++count >= toDelete) break;
    }
  }

  persistMessagesDebounced();
}

async function getStoredMessage(key) {
  if (!key || !key.id) return undefined;
  const id = String(key.id);
  const remoteJid = key.remoteJid ? String(key.remoteJid) : '';
  const compoundKey = `${remoteJid}_${id}`;

  let msg = _messageStore.get(compoundKey);
  if (!msg) {
    const rawId = remoteJid.replace(/@.*$/, '');
    const mappedPhone = _lidPhoneMap.get(rawId);
    if (mappedPhone) {
      msg = _messageStore.get(`${mappedPhone}@s.whatsapp.net_${id}`);
    }
  }
  if (!msg) {
    const rawId = remoteJid.replace(/@.*$/, '');
    const mappedLid = _phoneLidMap.get(rawId);
    if (mappedLid) {
      msg = _messageStore.get(`${mappedLid}@lid_${id}`);
    }
  }
  if (!msg) {
    msg = _messageStore.get(id);
  }

  if (msg) {
    log.info(`serving cached message to WhatsApp retry request for msgId=${id} (target=${remoteJid})`);
    return msg;
  }
  log.warn(`retry request for msgId=${id} (${remoteJid}) not found in messageStore`);
  return undefined;
}

function createRetryCounterCache() {
  const map = new Map();
  return {
    get(key) { return map.get(key); },
    set(key, value) { map.set(key, value); },
    del(key) { map.delete(key); },
    flushAll() { map.clear(); }
  };
}
const _msgRetryCounterCache = createRetryCounterCache();

function cacheLidMapping(lid, phone) {
  if (lid && phone) {
    const cleanLid = String(lid).replace(/@.*$/, '');
    const cleanPhone = String(phone).replace(/@.*$/, '');
    _lidPhoneMap.set(cleanLid, cleanPhone);
    _phoneLidMap.set(cleanPhone, cleanLid);
    persistLidMappingsDebounced();
  }
}

function getLidForPhone(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/@.*$/, '');
  return _phoneLidMap.get(clean) || null;
}

function getPhoneForLid(lid) {
  if (!lid) return null;
  const clean = String(lid).replace(/@.*$/, '');
  return _lidPhoneMap.get(clean) || null;
}

function setCfg(cfg) {
  _cfg = cfg;
}

function getEngineDir() {
  return _cfg && _cfg.engineDir ? _cfg.engineDir : join(require('./config').baseDataDir(), 'WhatsAppEngine');
}

/**
 * Loads Baileys, Pino and QRCode modules.
 * Tries the gateway's bundled node_modules first, then falls back to AppData WhatsAppEngine.
 */
function loadBaileys() {
  // 1. Try local node_modules inside whatsapp-gateway
  try {
    const baileys = require('@whiskeysockets/baileys');
    const pino = require('pino');
    const qrcode = require('qrcode');
    _baileysModule = baileys;
    return { baileys, pino, qrcode };
  } catch {}

  // 2. Try engineDir under AppData
  const engineDir = getEngineDir();
  const pkgPath = join(engineDir, 'node_modules', '@whiskeysockets/baileys');
  if (fs.existsSync(pkgPath)) {
    const req = createRequire(join(engineDir, 'package.json'));
    const baileys = req('@whiskeysockets/baileys');
    const pino = req('pino');
    const qrcode = req('qrcode');
    _baileysModule = baileys;
    return {
      baileys,
      pino,
      qrcode,
    };
  }

  throw new Error('محرك الواتساب غير مثبت — يرجى تثبيت المحرك أولاً من الإعدادات');
}

/** True when Baileys packages are available to require. */
function engineReady() {
  try {
    loadBaileys();
    return true;
  } catch {
    return false;
  }
}

const PROFILE_LOCK_FILES = [
  'lockfile',
  'DevToolsActivePort',
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
];

/** Cleans stale lock files if present. Returns removed paths. */
function clearStaleLocks(userDataDir) {
  if (!userDataDir || !fs.existsSync(userDataDir)) return [];
  const locks = PROFILE_LOCK_FILES.map((name) => join(userDataDir, name)).filter((p) => fs.existsSync(p));
  for (const lock of locks) {
    try {
      fs.rmSync(lock, { force: true, recursive: true });
    } catch {}
  }
  return locks;
}

function isSocketOpen() {
  if (!_sock) return false;
  if (_sock.ws && _sock.ws.isOpen) return true;
  if (_sock.ws && _sock.ws.socket && _sock.ws.socket.readyState === 1) return true;
  return false;
}

function isSocketActive() {
  if (!_sock) return false;
  if (isSocketOpen()) return true;
  if (_sock.ws && _sock.ws.socket) {
    const rs = _sock.ws.socket.readyState;
    if (rs === 0 || rs === 1) return true;
  }
  return false;
}

function getAuthDir() {
  const sessionDir = (_cfg && _cfg.sessionDir) || require('./config').config().sessionDir;
  return join(sessionDir, 'baileys_auth');
}

function hasSavedCredentials() {
  try {
    const credsPath = join(getAuthDir(), 'creds.json');
    if (!fs.existsSync(credsPath)) return false;
    const stat = fs.statSync(credsPath);
    if (stat.size < 50) return false;
    const content = fs.readFileSync(credsPath, 'utf8');
    const creds = JSON.parse(content);
    return Boolean(creds && (creds.registered || (creds.me && creds.me.id)));
  } catch {
    return false;
  }
}

let _reconnectAttempts = 0;

/**
 * Connects or returns the active Baileys WebSocket instance.
 * Completely headless, zero-browser, pure protocol.
 */
async function ensureBrowser() {
  if (_sock && isSocketOpen()) {
    return { ok: true, client: _sock };
  }
  if (_connecting) return _connecting;

  if (_sock && isSocketActive()) {
    const opened = await waitForOpen(6000);
    if (opened || isSocketActive()) {
      return { ok: true, client: _sock };
    }
  }

  if (_sock) {
    try {
      _sock.ev.removeAllListeners();
      _sock.end(undefined);
    } catch {}
    _sock = null;
  }

  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }

  _connecting = (async () => {
    const { baileys, pino, qrcode } = loadBaileys();
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      makeCacheableSignalKeyStore,
      Browsers,
    } = baileys;

    const authDir = getAuthDir();
    fs.mkdirSync(authDir, { recursive: true });

    log.info(`initializing Baileys Zero-Browser WebSocket (auth=${authDir})`);
    loadPersistedMessages();
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    let version;
    try {
      const v = await fetchLatestBaileysVersion();
      version = v.version;
    } catch {
      version = [2, 3000, 1043857760];
    }

    const pinoLogger = pino({ level: 'silent' });
    const authKeys = makeCacheableSignalKeyStore
      ? makeCacheableSignalKeyStore(state.keys, pinoLogger)
      : state.keys;

    const browserDesc = Browsers && typeof Browsers.ubuntu === 'function'
      ? Browsers.ubuntu('Chrome')
      : (Browsers && typeof Browsers.appropriate === 'function'
        ? Browsers.appropriate('Desktop')
        : ['Ubuntu', 'Chrome', '120.0.6099.115']);

    const sock = makeWASocket({
      version,
      logger: pinoLogger,
      auth: {
        creds: state.creds,
        keys: authKeys,
      },
      msgRetryCounterCache: _msgRetryCounterCache,
      getMessage: getStoredMessage,
      browser: browserDesc,
      printQRInTerminal: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 20000,
      defaultQueryTimeoutMs: 60000,
      markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (!hasSavedCredentials()) {
          try {
            const dataUrl = await qrcode.toDataURL(qr, { margin: 2, scale: 8 });
            _lastQrBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
            log.info('Baileys QR code generated and ready for pairing');
          } catch (err) {
            log.error(`QR generation error: ${err.message}`);
          }
        } else {
          log.info('Ignoring transient QR code because valid saved credentials exist in authDir');
        }
      }

      if (connection === 'open') {
        _isPairedState = true;
        _lastQrBase64 = null;
        _reconnectAttempts = 0;
        if (_reconnectTimer) {
          clearTimeout(_reconnectTimer);
          _reconnectTimer = null;
        }
        log.info('Baileys connected to WhatsApp Multi-Device successfully (No Browser) ✅');
        try {
          await sock.sendPresenceUpdate('available');
        } catch {}
      }

      if (connection === 'close') {
        _lastQrBase64 = null;
        if (_sock) {
          try { _sock.ev.removeAllListeners(); } catch {}
          _sock = null;
        }

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const hasCreds = hasSavedCredentials();
        log.warn(`Baileys connection closed (code=${statusCode}, hasSavedCreds=${hasCreds})`);

        // User explicit instruction:
        // "ربط واتس اب بيخرج كل شويه وانا كل الي طلبته انه يخرج لما اخرجه انا بنفسي"
        // NEVER wipe credentials automatically here under ANY circumstances!
        // Only explicit disconnect() clears credentials.
        // Schedule auto-reconnect with backoff.
        if (!_reconnectTimer) {
          _reconnectAttempts++;
          let delay = 4000;
          if (statusCode === 515) {
            delay = 1500;
          } else if (statusCode === 408) {
            delay = 2000;
          } else if (statusCode === 440) {
            delay = 8000;
          } else if (statusCode === 401) {
            delay = 5000;
          } else {
            delay = Math.min(30000, 3000 * Math.pow(1.3, Math.min(_reconnectAttempts, 8)));
          }
          log.info(`Scheduling auto-reconnect in ${Math.round(delay / 1000)}s (attempt ${_reconnectAttempts}, code=${statusCode})`);
          _reconnectTimer = setTimeout(() => {
            _reconnectTimer = null;
            ensureBrowser().catch((err) => log.warn(`auto-reconnect failed: ${err.message}`));
          }, delay);
        }
      }
    });

    setupInboundListener(sock);

    _sock = sock;
    await waitForOpen(3000).catch(() => {});
    return { ok: true, client: _sock };
  })().catch((err) => {
    log.error(`Baileys socket creation failed: ${err.message}`);
    _sock = null;
    return { ok: false, error: err.message };
  }).finally(() => {
    _connecting = null;
  });

  return _connecting;
}

const _botSentMessageIds = new Set();
function markBotSentMessageId(id) {
  if (!id) return;
  _botSentMessageIds.add(String(id));
  if (_botSentMessageIds.size > 500) {
    const first = _botSentMessageIds.values().next().value;
    if (first) _botSentMessageIds.delete(first);
  }
}

function extractMessageBody(msg) {
  if (!msg) return '';
  const m = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg.documentWithCaptionMessage?.message || msg;
  if (!m) return '';
  if (typeof m.conversation === 'string') return m.conversation;
  if (typeof m.extendedTextMessage?.text === 'string') return m.extendedTextMessage.text;
  if (typeof m.imageMessage?.caption === 'string') return m.imageMessage.caption;
  if (typeof m.videoMessage?.caption === 'string') return m.videoMessage.caption;
  if (typeof m.documentMessage?.caption === 'string') return m.documentMessage.caption;
  if (typeof m.buttonsResponseMessage?.selectedButtonId === 'string') return m.buttonsResponseMessage.selectedButtonId;
  if (typeof m.buttonsResponseMessage?.selectedDisplayText === 'string') return m.buttonsResponseMessage.selectedDisplayText;
  if (typeof m.listResponseMessage?.singleSelectReply?.selectedRowId === 'string') return m.listResponseMessage.singleSelectReply.selectedRowId;
  if (typeof m.templateButtonReplyMessage?.selectedId === 'string') return m.templateButtonReplyMessage.selectedId;
  return '';
}

/**
 * Listens for incoming 1-on-1 text messages from members and forwards them to
 * the reception bot webhook (`POST /api/whatsapp/inbound`).
 */
function setupInboundListener(sock) {
  if (!sock || !sock.ev) return;

  sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
    if (lid && jid) {
      cacheLidMapping(lid, jid);
      log.info(`learned phone number share: ${lid} -> ${jid}`);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const message of (messages || [])) {
      if (message?.key?.id && message?.message) {
        saveMessage(message.key, message.message);
      }
    }

    log.info(`messages.upsert received ${messages?.length || 0} message(s), type=${type}`);

    for (const message of (messages || [])) {
      try {
        if (!message || !message.key) continue;
        const msgId = message.key.id;
        if (msgId && _botSentMessageIds.has(String(msgId))) continue;

        const remoteJid = message.key.remoteJid;
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.includes('status@broadcast')) continue;

        // If fromMe is true: only allow if it is a self-chat (testing message to own number)
        if (message.key.fromMe) {
          const myJid = sock.user?.id ? sock.user.id.replace(/:.*@/, '@') : null;
          const myPn = myJid ? myJid.replace(/@.*$/, '') : null;
          const targetPn = remoteJid.replace(/@.*$/, '');
          const isSelfChat = myPn && (targetPn === myPn || (sock.user?.lid && remoteJid === sock.user.lid));
          if (!isSelfChat) continue;
        }

        // Check if message is recent (skip old history sync)
        const msgTime = Number(message.messageTimestamp || 0);
        const isRecent = msgTime > 0 ? (Date.now() / 1000 - msgTime) < 300 : true;
        if (type !== 'notify' && !isRecent) continue;

        const body = extractMessageBody(message.message).trim();
        if (!body) continue;

        const rawId = remoteJid.replace(/@.*$/, '');
        let senderPn = message.key?.senderPn || message.key?.participantPn || null;
        if (senderPn) {
          senderPn = senderPn.replace(/@.*$/, '');
          cacheLidMapping(rawId, senderPn);
        }

        const resolvedPhone = _lidPhoneMap.get(rawId) || senderPn || rawId;
        const backendUrl = (_cfg && _cfg.backendUrl) || process.env.BACKEND_URL || 'http://127.0.0.1:8890';
        log.info(`inbound message from ${remoteJid} (resolved phone: ${resolvedPhone}): "${body.slice(0, 40)}"`);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(`${backendUrl.replace(/\/+$/, '')}/api/whatsapp/inbound`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: resolvedPhone,
            remoteJid,
            senderPn,
            pushName: message.pushName || null,
            body,
            messageId: message.key.id,
          }),
          signal: controller.signal,
        }).catch((e) => {
          log.warn(`inbound webhook error: ${e.message}`);
          return null;
        });
        clearTimeout(timer);

        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          if (data && (data.reply || data.media)) {
            const { send } = require('./wa-send');
            const targetJid = data.replyJid || remoteJid;
            log.info(`sending bot auto-reply to ${targetJid}`);
            const sendRes = await send(targetJid, data.reply || '', data.media || null);
            if (!sendRes || !sendRes.ok) {
              log.error(`bot auto-reply to ${targetJid} failed: ${(sendRes && sendRes.error) || 'unknown error'}`);
            } else {
              if (sendRes.messageId) {
                markBotSentMessageId(sendRes.messageId);
              }
              log.info(`bot auto-reply delivered successfully to ${targetJid}`);
            }
          }
        }
      } catch (err) {
        log.warn(`onMessage error: ${err.message}`);
      }
    }
  });
}

/** Health probe reporting pairing state without delay. */
async function healthStatus() {
  const paired = Boolean(_isPairedState || hasSavedCredentials());
  const socketOpen = isSocketOpen();
  const ready = Boolean(_sock && (socketOpen || isSocketActive() || _connecting));
  return { browserReady: ready, paired };
}

/** Check if the session is authenticated and paired. */
async function isPaired(clientOrNull) {
  if (_isPairedState) return true;
  if (hasSavedCredentials()) {
    _isPairedState = true;
    _lastQrBase64 = null;
    return true;
  }
  const sock = clientOrNull || _sock;
  if (!sock) return false;
  if (sock.user && sock.user.id) {
    _isPairedState = true;
    _lastQrBase64 = null;
    return true;
  }
  if (sock.authState && sock.authState.creds) {
    if (sock.authState.creds.me && sock.authState.creds.me.id) {
      _isPairedState = true;
      _lastQrBase64 = null;
      return true;
    }
    if (sock.authState.creds.registered) {
      _isPairedState = true;
      _lastQrBase64 = null;
      return true;
    }
  }
  return false;
}

/** Reads the current QR code frame as raw PNG base64, or null if paired / not generated. */
async function readQr() {
  if (_isPairedState || hasSavedCredentials()) return null;
  if (!_lastQrBase64) return null;
  return { pngBase64: _lastQrBase64 };
}

/** Waits up to timeoutMs for the QR to be scanned and paired. */
async function waitForPairing(client, timeoutMs = 15000) {
  if (_isPairedState || hasSavedCredentials()) return { paired: true };
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (_isPairedState || hasSavedCredentials()) return { paired: true };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { paired: Boolean(_isPairedState || hasSavedCredentials()) };
}

/** Waits up to timeoutMs for the WebSocket connection to be fully open. */
async function waitForOpen(timeoutMs = 20000) {
  if (isSocketOpen()) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isSocketOpen()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return isSocketOpen();
}

/** Disconnects and shuts down the active socket without wiping disk credentials. */
async function close() {
  if (_sock) {
    try {
      _sock.end(undefined);
    } catch {}
    _sock = null;
  }
  _isPairedState = false;
  _lastQrBase64 = null;
}

/**
 * Disconnects the WhatsApp session, logs out from WhatsApp servers,
 * wipes authentication credentials and cache files on disk,
 * and resets pairing state so a fresh QR scan is ready.
 * ONLY called when user explicitly clicks disconnect button in the UI!
 */
async function disconnect() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  _reconnectAttempts = 0;

  if (_sock) {
    try {
      await _sock.logout();
    } catch (e) {
      log.warn(`Baileys logout warning: ${e.message}`);
    }
    try {
      _sock.ev.removeAllListeners();
      _sock.end(undefined);
    } catch {}
    _sock = null;
  }

  const authDir = getAuthDir();

  try {
    fs.rmSync(authDir, { recursive: true, force: true });
    log.info(`cleared credentials at ${authDir}`);
  } catch (err) {
    log.warn(`could not remove authDir: ${err.message}`);
  }

  try {
    const msgCache = getMsgCachePath();
    if (fs.existsSync(msgCache)) fs.unlinkSync(msgCache);
  } catch {}

  try {
    const lidCache = getLidCachePath();
    if (fs.existsSync(lidCache)) fs.unlinkSync(lidCache);
  } catch {}

  _lidPhoneMap.clear();
  _phoneLidMap.clear();
  _messageStore.clear();

  _isPairedState = false;
  _lastQrBase64 = null;
  _connecting = null;

  log.info('WhatsApp account disconnected, unlinked, and credentials cleared successfully ✅');
  return { ok: true, disconnected: true };
}

module.exports = {
  setCfg,
  getEngineDir,
  getAuthDir,
  hasSavedCredentials,
  ensureBrowser,
  engineReady,
  healthStatus,
  isPaired,
  isSocketOpen,
  isSocketActive,
  readQr,
  waitForPairing,
  waitForOpen,
  close,
  disconnect,
  clearStaleLocks,
  cacheLidMapping,
  getLidForPhone,
  getPhoneForLid,
  saveMessage,
  getStoredMessage,
  markBotSentMessageId,
};