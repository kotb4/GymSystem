@echo off
rem ============================================================
rem  Yassen Mohamed Kotb | 01288536381  -  License Tool shortcut
rem  Opens the License Tools menu in scripts\windows\license-cli.bat
rem ============================================================
setlocal
cd /d "%~dp0"
call "scripts\windows\license-cli.bat" %*