import fs from 'node:fs';

const raw = fs.readFileSync('./scripts/voice_segments.json', 'utf8');
const segs = JSON.parse(raw);

for (const s of segs) {
  console.log(`${s.start.toFixed(1).padStart(5)}s -> ${s.end.toFixed(1).padStart(5)}s: ${s.text}`);
}
