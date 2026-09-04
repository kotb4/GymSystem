@echo off
rem ============================================================
rem  Yassen Mohamed Kotb | 01288536381  -  License Tool menu
rem  Convenience entry point: opens the License Tools menu
rem  (scripts\windows\license-cli.bat).
rem  Use this to:
rem    [1] Print the machine HWID
rem    [2] Issue a license for this machine
rem    [3] Build + run the app
rem    [4] Stop the app
rem    [5] Exit
rem ============================================================
setlocal
cd /d "%~dp0"
call "scripts\windows\license-cli.bat" %*