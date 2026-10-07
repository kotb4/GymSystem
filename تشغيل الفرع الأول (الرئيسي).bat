@echo off
rem ============================================================
rem  GymSystem - تشغيل الفرع الأول (الرئيسي) - Port 8890
rem ============================================================
setlocal
cd /d "%~dp0"
if exist "dist-exe\GymSystem.exe" (
  cd dist-exe
  start "" "GymSystem.exe"
  exit /b 0
)
call scripts\windows\start-gymsystem.bat
exit /b 0
