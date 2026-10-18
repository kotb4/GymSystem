import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const extractedRoot = 'd:/Systems/Gym/incoming-updates/extracted';
const currentRoot = 'd:/Systems/Gym';

function fileHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

const diffs = {
  modified: [],
  added: [],
  deleted: [],
  identical: 0,
};

function compareDirs(extractedDir, relDir = '') {
  const entries = fs.readdirSync(extractedDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-exe' || entry.name === 'dist-server' || entry.name === 'incoming-updates') {
      continue;
    }

    const relPath = path.join(relDir, entry.name).replace(/\\/g, '/');
    const extFull = path.join(extractedDir, entry.name);
    const curFull = path.join(currentRoot, relPath);

    if (entry.isDirectory()) {
      compareDirs(extFull, relPath);
    } else {
      if (!fs.existsSync(curFull)) {
        diffs.added.push(relPath);
      } else {
        const h1 = fileHash(extFull);
        const h2 = fileHash(curFull);
        if (h1 !== h2) {
          diffs.modified.push(relPath);
        } else {
          diffs.identical++;
        }
      }
    }
  }
}

compareDirs(extractedRoot);

console.log('=== DIFF SUMMARY ===');
console.log(`Identical files: ${diffs.identical}`);
console.log(`Modified files (${diffs.modified.length}):`);
for (const f of diffs.modified) {
  console.log(`  ~ ${f}`);
}
console.log(`\nAdded files (${diffs.added.length}):`);
for (const f of diffs.added) {
  console.log(`  + ${f}`);
}
