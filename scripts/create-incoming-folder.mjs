import fs from 'fs';
import { exec } from 'child_process';

const targetDir = 'd:/Systems/Gym/incoming-updates';
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}
exec(`explorer.exe "d:\\Systems\\Gym\\incoming-updates"`);
console.log('READY: d:/Systems/Gym/incoming-updates');
