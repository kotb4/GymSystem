@echo off
rem Starts a Cloudflare Tunnel for GymSystem pointing to http://127.0.0.1:8890
setlocal enabledelayedexpansion
title Cloudflare Tunnel (GymSystem)

set PORT=%GYMSYSTEM_PORT%
if "%PORT%"=="" set PORT=8890

echo ===================================================
echo   GymSystem - Cloudflare Tunnel Quick Starter
echo ===================================================
echo Target: http://127.0.0.1:%PORT%
echo.

where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" (
        set "CLOUDFLARED_BIN=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
    ) else if exist "%ProgramFiles%\cloudflared\cloudflared.exe" (
        set "CLOUDFLARED_BIN=%ProgramFiles%\cloudflared\cloudflared.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe" (
        set "CLOUDFLARED_BIN=%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe"
    ) else (
        echo [ERROR] cloudflared is not installed or not in PATH.
        echo.
        echo To install it quickly, open PowerShell or Terminal and run:
        echo   winget install Cloudflare.cloudflared
        echo.
        echo After installation, reopen this script.
        echo ===================================================
        pause
        exit /b 1
    )
) else (
    set "CLOUDFLARED_BIN=cloudflared"
)

echo Starting tunnel...
echo Copy the generated https://*.trycloudflare.com URL and save it in Settings -> Network.
echo ===================================================
"%CLOUDFLARED_BIN%" tunnel --url http://127.0.0.1:%PORT%
pause
