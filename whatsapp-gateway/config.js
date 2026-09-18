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
    // The wppconnect "engine" is installed once by the backend into the data
    // dir (Settings → «تثبيت محرك الواتساب»); this gateway requires it.
    engineDir: join(baseDataDir(), 'WhatsAppEngine'),
    // Headless browsers cannot be scanned by the phone normally; default to a
    // visible browser window so the gym PC shows the QR for pairing.
    headless: process.env.GW_HEADLESS === '1',
    logFile: join(baseDataDir(), 'Logs', 'whatsapp-gateway.log'),
  };
}

module.exports = { config, baseDataDir };