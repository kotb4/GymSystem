@echo off
chcp 65001 >nul
title GymGate - Automated Showcase Video Recorder

echo =======================================================
echo   GymGate Automated Showcase Video Recorder (1080p)
echo   Powered by KOTB Digital Solutions
echo =======================================================
echo.

node scripts/record-demo.mjs

echo.
echo =======================================================
echo   Recording finished. Check folder: recordings/
echo =======================================================
pause
