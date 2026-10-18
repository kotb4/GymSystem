import { execSync } from 'child_process';

const out = execSync('tasklist', { encoding: 'utf8' });
const lines = out.split('\n').filter(l => l.includes('brave') || l.includes('chrome') || l.includes('msedge'));
console.log(lines.join('\n'));
