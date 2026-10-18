@echo off
rem ============================================================
rem  GymGate — Yassen Mohamed Kotb | 01288536381
rem  One-click launcher for GymGate (port 8890)
rem ============================================================
setlocal
cd /d "%~dp0..\.."

set GYMGATE_PORT=8890
set GYMSYSTEM_PORT=8890

if exist "dist-exe\GymGate.exe" (
  cd dist-exe
  start "" "GymGate.exe"
  exit /b 0
)
if exist "dist-exe\GymSystem.exe" (
  cd dist-exe
  start "" "GymSystem.exe"
  exit /b 0
)

rem start backend minimized; it serves the UI on http://127.0.0.1:8890
start "GymGate - Primary (Port 8890)" /min node dist-server\index.cjs

rem wait for the local API to come up (max ~15s)
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
curl -s -o nul http://127.0.0.1:8890/api/ping
if errorlevel 1 (
  set /a tries+=1
  if %tries% lss 15 goto wait
  echo Backend failed to start. Check Logs folder.
  pause
  exit /b 1
)

rem open the app in default browser
start "" http://127.0.0.1:8890/
exit /b 0
