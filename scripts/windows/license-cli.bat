@echo off
rem ============================================================
rem  Yassen Mohamed Kotb | 01288536381  -  License Tool v4
rem  English-only echoes (Arabic in the SPA / i18n, NOT in the BAT).
rem  Double-click this file: shows a small CLI menu for:
rem    [1] Show HWID
rem    [2] Issue a license for THIS machine
rem    [3] Build + run the app
rem    [4] Stop the app
rem    [5] Exit
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."
title GymSystem - License Tool v4

:menu
cls
echo.
echo   ============================================
echo     GymSystem - License Tool v4
echo     (this is the LICENSE TOOL, not dev.bat)
echo   ============================================
echo.
echo     [1] Show HWID
echo     [2] Issue a license for this machine
echo     [3] Build + run the app
echo     [4] Stop the app
echo     [5] Exit
echo.
echo   ! Type a number then Enter !
echo.
set /p choice="  Choose (1-5): "
set "choice=%choice: =%"
if "%choice%"=="1" goto hwid
if "%choice%"=="2" goto issue
if "%choice%"=="3" goto run
if "%choice%"=="4" goto stop
if "%choice%"=="5" exit /b 0
if "%choice%"=="" (
  echo   No choice entered - back to menu ...
  timeout /t 1 /nobreak >nul
  goto menu
)
echo   Invalid choice: "%choice%"
timeout /t 1 /nobreak >nul
goto menu

:hwid
cls
echo.
echo   HWID for this machine:
echo.
call npm run license:hwid
echo.
pause
goto menu

:issue
cls
echo.
echo   Issue a license for THIS machine
echo.
set /p days="  License duration in days (e.g. 365): "
if "%days%"=="" set days=365
set /p gym="  Gym name (e.g. Test Gym): "
if "%gym%"=="" set gym=GymSystem
call npm run license:issue-here -- --gym "%gym%" --days %days%
echo.
echo   Done. Upload / paste the license.lic file in the app activation screen.
echo.
pause
goto menu

:run
cls
echo.
echo   Build project then run the app ...
echo   (will open the server, then the browser at http://localhost:8890)
echo.
set /p confirm="  Sure? Type y then Enter to continue: "
if /i not "%confirm%"=="y" (
  echo   Cancelled.
  pause
  goto menu
)
call npm run build
if errorlevel 1 (
  echo   Build failed. Check the errors above.
  pause
  goto menu
)
echo   Build OK. Starting the server in a separate window ...
start "GymSystem Backend" /min cmd /c "node dist-server\index.cjs"
echo   Waiting for the server to come up ...
set /a tries=0
:wait_run
timeout /t 1 /nobreak >nul
curl -s -o nul http://127.0.0.1:8890/api/ping
if errorlevel 1 (
  set /a tries+=1
  if !tries! lss 15 goto wait_run
  echo   Server did not respond. Check the Backend window.
  pause
  goto menu
)
start "" http://127.0.0.1:8890/
echo   Opening the browser ...
echo.
pause
goto menu

:stop
cls
echo.
echo   Stopping any running GymSystem server (node dist-server\index.cjs) ...
taskkill /f /im node.exe >nul 2>&1
echo   Stopped.
echo.
pause
goto menu