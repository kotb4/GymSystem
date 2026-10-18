const { execSync } = require('child_process');
try {
  const ps = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize`;
  const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8' });
  console.log(out);
} catch (e) {
  console.error(e.message);
}
