import fs from 'fs';
import path from 'path';

const srcRoot = 'd:/Systems/Gym/incoming-updates/extracted';
const dstRoot = 'd:/Systems/Gym';

function copyRecursive(srcDir, relDir = '') {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-exe' || entry.name === 'incoming-updates') {
      continue;
    }
    const rel = path.join(relDir, entry.name);
    const srcFull = path.join(srcDir, entry.name);
    const dstFull = path.join(dstRoot, rel);

    if (entry.isDirectory()) {
      if (!fs.existsSync(dstFull)) {
        fs.mkdirSync(dstFull, { recursive: true });
      }
      copyRecursive(srcFull, rel);
    } else {
      fs.copyFileSync(srcFull, dstFull);
    }
  }
}

console.log('Copying extracted files to workspace...');
copyRecursive(srcRoot);
console.log('Copy complete!');
