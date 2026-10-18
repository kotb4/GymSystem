import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const zipPath = 'd:/Systems/Gym/incoming-updates/GymSystem-Fixed-Pro.zip';
const outDir = 'd:/Systems/Gym/incoming-updates/extracted';

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });

console.log('Extracting zip...');
execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir}' -Force"`);
console.log('Extracted successfully!');

// Scan directory structure
function scanDir(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      console.log(`${prefix}📁 ${entry.name}/`);
      if (prefix.length < 8) {
        scanDir(full, prefix + '  ');
      }
    } else {
      console.log(`${prefix}📄 ${entry.name}`);
    }
  }
}

console.log('\nTop-level extracted structure:');
scanDir(outDir);
