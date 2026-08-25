@echo off
>nul chcp 65001
title GymSystem - Dev
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo [X] Node.js غير مثبت على الجهاز - نصبه من nodejs.com
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [..] أول تشغيل: جار تثبيت الحزم، انتظر...
    call npm install
    if errorlevel 1 (
        echo [X] فشل تثبيت الحزم
        pause
        exit /b 1
    )
)

echo ================================================
echo   GymSystem - بيئة التطوير
echo   الواجهة : http://localhost:5173
echo   الـ API  : http://127.0.0.1:8890/api/ping
echo   للإيقاف : أغلق نافذتي الباك-اند والفرونت-اند
echo ================================================

rem 1) build + run the local backend (owns SQLite in %LOCALAPPDATA%\GymSystem)
start "GymSystem Backend" cmd /k "npm run dev:server"

rem 2) wait a bit for the API, then run vite with proxy /api -> backend
timeout /t 4 /nobreak >nul
call npm run dev -- --open
pause
