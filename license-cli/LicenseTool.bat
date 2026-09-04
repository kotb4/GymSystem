@echo off
rem ============================================================
rem  Yassen Mohamed Kotb | 01288536381  -  License Tool shortcut
rem  Opens the License Tools GUI (license-cli\license-cli.bat)
rem ============================================================
setlocal
cd /d "%~dp0"
call "%~dp0license-cli.bat" %*