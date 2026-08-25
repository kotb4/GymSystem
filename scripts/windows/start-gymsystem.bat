@echo off
rem ============================================================
rem  GymSystem - one-click launcher
rem  Starts the local backend (which owns the SQLite database in
rem  %LOCALAPPDATA%\GymSystem) and opens the app window.
rem  No internet required. Data survives restarts.
rem ============================================================
setlocal
cd /d "%~dp0.."

set GYMSYSTEM_PORT=8890

rem start backend minimized; it serves the UI on http://127.0.0.1:8890
start "GymSystem Backend" /min node dist-server\index.cjs

rem wait for the local API to come up (max ~15s)
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
curl -s -o nul http://127.0.0.1:%GYMSYSTEM_PORT%/api/ping
if errorlevel 1 (
  set /a tries+=1
  if %tries% lss 15 goto wait
  echo Backend failed to start. Check Logs folder.
  pause
  exit /b 1
)

rem open the app window (Edge app mode = standalone window, no browser chrome)
start "" msedge --app=http://127.0.0.1:%GYMSYSTEM_PORT%/ || start "" http://127.0.0.1:%GYMSYSTEM_PORT%/
exit /b 0
