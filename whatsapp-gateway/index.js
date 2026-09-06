'use strict';

const log = require('./log');
const { config } = require('./config');
const { createServer } = require('./http');
const wa = require('./wa-session');

function main() {
  const cfg = config();
  log.init(cfg.logFile);
  wa.setCfg(cfg);

  log.info('==========================================');
  log.info('whatsapp-gateway starting (local only)');
  log.info(`binding  ${cfg.host}:${cfg.port}`);
  log.info(`session  ${cfg.sessionDir}`);
  log.info(`browser  channel=${cfg.channel} headless=${cfg.headless}`);
  log.info('==========================================');

  const server = createServer(cfg.port, cfg.host);

  server.on('listening', () => {
    log.info(`ready at http://${cfg.host}:${cfg.port}  (/health /pair /send)`);
  });
  server.on('error', (err) => {
    log.error(`server error: ${err.message}`);
    process.exitCode = 1;
  });

  const shutdown = async () => {
    log.info('shutting down…');
    await wa.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();