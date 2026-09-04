@echo off
rem ============================================================
rem  Yassen Mohamed Kotb | 01288536381  -  License Tool v6
rem  Launches the GUI (WinForms) license tool.
rem  The tool lives in its own folder (license-cli/).
rem  Use it to issue licenses for the app, NOT to run the app.
rem  English-only in the BAT (Arabic lives in the GUI itself).
rem ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0license-tool-gui.ps1"