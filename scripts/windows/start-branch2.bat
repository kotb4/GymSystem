@echo off
rem ============================================================
rem  GymSystem - Branch 2 Simulator (Port 8895)
rem  Runs an isolated 2nd branch on port 8895 with separate DB
rem  in %LOCALAPPDATA%\GymSystem_Branch2
rem ============================================================
setlocal
cd /d "%~dp0..\.."

set GYMSYSTEM_PORT=8895
set GYMSYSTEM_DATA_DIR=%LOCALAPPDATA%\GymSystem_Branch2

if exist "dist-exe\GymSystem-Branch2.exe" (
  cd dist-exe
  start "" "GymSystem-Branch2.exe"
  exit /b 0
)
if exist "dist-exe\GymSystem.exe" (
  cd dist-exe
  start "" "GymSystem.exe"
  exit /b 0
)

echo Starting Branch 2 backend on http://127.0.0.1:8895 ...
start "GymSystem - Branch 2 (Port 8895)" /min node dist-server\index.cjs

set /a tries=0
:wait
timeout /t 1 /nobreak >nul
curl -s -o nul http://127.0.0.1:%GYMSYSTEM_PORT%/api/ping
if errorlevel 1 (
  set /a tries+=1
  if %tries% lss 15 goto wait
  echo Branch 2 failed to start.
  pause
  exit /b 1
)

echo Branch 2 is ready! Opening browser at http://127.0.0.1:8895/ ...
start "" http://127.0.0.1:8895/
exit /b 0
