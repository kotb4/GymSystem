'use strict';

const http = require('node:http');
const log = require('./log');
const wa = require('./wa-session');
const { send } = require('./wa-send');

const MAX_BODY = 8 * 1024 * 1024;

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = req.url || '/';
  const path = url.split('?')[0];
  const started = Date.now();
  let status = 200;

  try {
    if (req.method === 'GET' && path === '/health') {
      const { ok, page } = await wa.ensureBrowser();
      const paired = ok ? await wa.isPaired(page) : false;
      return json(res, 200, {
        ok: true,
        service: 'whatsapp-gateway',
        paired,
        sessionDir: waSessionDir(),
      });
    }

    if (req.method === 'POST' && path === '/pair') {
      const { ok, page } = await wa.ensureBrowser();
      if (!ok) return json(res, 503, { ok: false, error: 'browser unavailable' });
      if (await wa.isPaired(page)) {
        return json(res, 200, { ok: true, paired: true });
      }
      const qr = await wa.readQr(page);
      return json(res, 200, {
        ok: true,
        paired: false,
        qrPngBase64: qr ? qr.pngBase64 : null,
        hint: 'scan with WhatsApp > Linked devices',
      });
    }

    if (req.method === 'POST' && path === '/send') {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return json(res, 400, { ok: false, error: 'invalid JSON body' });
      }
      if (!body.phone) return json(res, 400, { ok: false, error: 'missing phone' });
      const result = await send(body.phone, body.message || '', body.media || null);
      status = result.ok ? 200 : 502;
      return json(res, status, result.ok ? { ok: true } : { ok: false, error: result.error });
    }

    if (req.method === 'GET' && path === '/pair') {
      const { ok, page } = await wa.ensureBrowser();
      if (ok && !(await wa.isPaired(page))) {
        const qr = await wa.readQr(page);
        const html = qr
          ? `<img src="data:image/png;base64,${qr.pngBase64}" alt="pairing qr" style="width:256px;height:256px;image-rendering:pixelated"/>
             <p>افتح واتساب على جوالك > الأجهزة المرتبطة > ربط جهاز.</p>`
          : '<p>لا يوجد QR بعد — أعد تحميل الصفحة.</p>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><html dir="rtl"><meta charset="utf-8"><body style="font-family:sans-serif">${html}</body></html>`);
      }
      if (ok) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><html dir="rtl"><meta charset="utf-8"><body style="font-family:sans-serif"><h2>الجهاز مرتبط بنجاح ✅</h2></body></html>');
      }
      return json(res, 503, { ok: false, error: 'browser unavailable' });
    }

    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><html dir="rtl"><meta charset="utf-8"><body style="font-family:sans-serif"><h2>واتساب جيت وي</h2><p>بوابة محلية على 127.0.0.1:8891 للطبقة الخلفية فقط.</p></body></html>');
    }

    return json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    log.error(`request ${req.method} ${path} failed: ${err.message}`);
    return json(res, 500, { ok: false, error: err.message });
  } finally {
    log.debug(`${req.method} ${path} -> ${status} (${Date.now() - started}ms)`);
  }
}

function waSessionDir() {
  // eslint-disable-next-line global-require
  return require('./config').config().sessionDir;
}

function createServer(port, host) {
  const server = http.createServer(handle);
  server.on('clientError', (_err, socket) => {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  });
  server.listen(port, host);
  return server;
}

module.exports = { createServer };