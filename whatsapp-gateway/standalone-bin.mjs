// Installs the Playwright browser binaries this gateway needs.
// 'msedge' (Windows default) reuses the installed Edge and needs no download;
// chromium is installed as a fallback for non-Windows machines.
import { spawnSync } from 'node:child_process';

const which = process.platform === 'win32' ? 'msedge' : 'chromium';
const needsBrowser = process.env.GW_CHANNEL
  ? !process.env.GW_CHANNEL.includes('msedge')
  : which !== 'msedge';

if (needsBrowser) {
  const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status || 1);
} else {
  console.log('Using the installed Microsoft Edge channel — no browser download needed.');
}

console.log('whatsapp-gateway dependencies ready.');