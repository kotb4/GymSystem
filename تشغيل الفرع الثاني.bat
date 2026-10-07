@echo off
rem ============================================================
rem  GymSystem - تشغيل الفرع الثاني - Port 8895
rem ============================================================
setlocal
cd /d "%~dp0"
if exist "dist-exe\GymSystem-Branch2.exe" (
  cd dist-exe
  start "" "GymSystem-Branch2.exe"
  exit /b 0
)
if exist "dist-exe\GymSystem.exe" (
  set GYMSYSTEM_PORT=8895
  set GYMSYSTEM_DATA_DIR=%LOCALAPPDATA%\GymSystem_Branch2
  cd dist-exe
  start "" "GymSystem.exe"
  exit /b 0
)
call scripts\windows\start-branch2.bat
exit /b 0
