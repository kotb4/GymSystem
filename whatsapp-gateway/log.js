'use strict';

const fs = require('node:fs');
const path = require('node:path');

let logPath = null;
const maxBytes = 512 * 1024;

function init(filePath) {
  logPath = filePath;
  if (logPath) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
    } catch {
      logPath = null;
    }
  }
}

function line(level, args) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${level} ${args
    .map((a) => (typeof a === 'string' ? a : safeJson(a)))
    .join(' ')}`;
  if (level !== 'DEBUG') console.log(msg);
  if (logPath) {
    try {
      fs.appendFileSync(logPath, msg + '\n');
      const stat = fs.statSync(logPath);
      if (stat.size > maxBytes) {
        const rotated = path.join(
          path.dirname(logPath),
          'whatsapp-gateway.old.log',
        );
        fs.renameSync(logPath, rotated);
      }
    } catch {
      /* logging must never crash the gateway */
    }
  }
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

module.exports = {
  init,
  info: (...args) => line('INFO', args),
  warn: (...args) => line('WARN', args),
  error: (...args) => line('ERROR', args),
  debug: (...args) => line('DEBUG', args),
};