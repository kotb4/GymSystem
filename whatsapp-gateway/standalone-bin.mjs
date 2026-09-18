// Verifies the wppconnect engine this gateway needs is already installed in
// the GymSystem data dir (Settings → «تثبيت محرك الواتساب»). No browser
// download is needed: wppconnect runs on the installed Microsoft Edge.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const baseDataDir = () =>
  join(
    process.env.GYMSYSTEM_DATA_DIR ||
      join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'GymSystem'),
  );

const engineDir = join(baseDataDir(), 'WhatsAppEngine');
const wppPath = join(engineDir, 'node_modules', '@wppconnect-team', 'wppconnect');

if (existsSync(wppPath)) {
  console.log(`wppconnect engine found at ${wppPath}`);
} else {
  console.error('wppconnect engine NOT installed.');
  console.error('Open GymSystem → Settings → WhatsApp and use «تثبيت محرك الواتساب», then retry.');
  process.exit(1);
}

console.log('whatsapp-gateway dependencies ready (uses installed Microsoft Edge — no browser download).');