'use strict';

const { join } = require('node:path');

// All state lives next to the main app data dir; never inside the repo.
function baseDataDir() {
  if (process.env.GYMSYSTEM_DATA_DIR) {
    return process.env.GYMSYSTEM_DATA_DIR;
  }
  const local =
    process.env.LOCALAPPDATA ||
    join(process.env.USERPROFILE || '.', 'AppData', 'Local');
  return join(local, 'GymSystem');
}

function config() {
  return {
    host: process.env.GATEWAY_HOST || '127.0.0.1',
    port: Number(process.env.GATEWAY_PORT || 8891),
    sessionDir: join(baseDataDir(), 'WhatAppGateway'),
    // Headless browsers cannot be scanned by the phone normally; default to a
    // visible browser window so the gym PC shows the QR for pairing.
    headless: process.env.GW_HEADLESS === '1',
    // 'msedge' reuses the installed Edge channel on Windows (no extra download);
    // fall back to bundled chromium with 'chromium'.
    channel: process.env.GW_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'),
    logFile: join(baseDataDir(), 'Logs', 'whatsapp-gateway.log'),
  };
}

module.exports = { config, baseDataDir };