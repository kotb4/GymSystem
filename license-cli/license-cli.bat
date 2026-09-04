@echo off
rem ============================================================
rem  Yassen Mohamed Kotb | 01288536381  -  License Tool v5
rem  Standalone license CLI menu (lives in license-cli/).
rem  Use this to issue licenses for the app, NOT to run the app.
rem  English-only echoes (Arabic in the SPA / i18n, NOT in the BAT).
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
title GymSystem - License Tool v5

:menu
cls
echo.
echo   ============================================
echo     GymSystem - License Tool v5
echo     (Standalone license CLI - in license-cli/)
echo   ============================================
echo.
echo     [1] Show HWID
echo     [2] Issue a license for THIS machine
echo     [3] Show license-tool help
echo     [4] Open license-cli folder
echo     [5] Exit
echo.
echo   ! Type a number then Enter !
echo.
set /p choice="  Choose (1-5): "
set "choice=%choice: =%"
if "%choice%"=="1" goto hwid
if "%choice%"=="2" goto issue
if "%choice%"=="3" goto help
if "%choice%"=="4" goto openfolder
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
call node "%~dp0license-tool.mjs" hwid
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
echo.
call node "%~dp0license-tool.mjs" issue-here --gym "%gym%" --days %days%
echo.
echo   Done. Upload / paste the license.lic file in the app activation screen.
echo.
pause
goto menu

:help
cls
echo.
call node "%~dp0license-tool.mjs" 2>nul
if errorlevel 1 (
  echo   The license tool reported an error. Run "node license-tool.mjs" from license-cli/ to see details.
)
echo.
pause
goto menu

:openfolder
start "" "%~dp0."
echo   Opened license-cli folder in Explorer.
timeout /t 1 /nobreak >nul
goto menu