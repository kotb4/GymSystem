param(
  [switch]$SkipInstall
)
# One-off setup for the local WhatsApp gateway (TASK-044).
# The gateway itself ships with no npm deps; the wppconnect engine is installed
# into the GymSystem data dir from inside the app (Settings → «تثبيت محرك
# الواتساب»). This script verifies the engine is present and prints usage.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "whatsapp-gateway setup ($root)" -ForegroundColor Cyan

if (-not $SkipInstall) {
  Write-Host "Verifying the wppconnect engine (data dir)…" -ForegroundColor Cyan
  Set-Location -LiteralPath (Join-Path $root 'whatsapp-gateway')
  & node standalone-bin.mjs
  if ($LASTEXITCODE -ne 0) { throw "wppconnect engine not installed — start GymSystem and use Settings → «تثبيت محرك الواتساب»" }
} else {
  Write-Host "Skipping engine check (already done)." -ForegroundColor Yellow
}

Write-Host @"

==========================================================
  WhatsApp gateway for QR card delivery (local only)
==========================================================
  URL:      http://127.0.0.1:8891   (bound to loopback only)
  Health:   GET  http://127.0.0.1:8891/health
  Pair QR:  GET  http://127.0.0.1:8891/pair   (open in a browser on the PC)
  Pair API: POST http://127.0.0.1:8891/pair
  Send API: POST http://127.0.0.1:8891/send
            { "phone": "01012345678", "message": "…",
              "media": { "base64": "…", "mime": "image/png", "caption": "…" } }

  Start it with:  scripts\windows\start-whatsapp-gateway.bat
  In Settings → رسائل واتساب enter  http://127.0.0.1:8891  and enable delivery.
  Session/profile persists under  %LOCALAPPDATA%\GymSystem\WhatAppGateway

  NOTE: pairing your WhatsApp account automates sending on that account.
  Understand WhatsApp's Terms of Service and ban-risk before enabling.
==========================================================
"@ -ForegroundColor Green