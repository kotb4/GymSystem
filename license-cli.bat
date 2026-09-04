@echo off
rem ============================================================
rem  Yassen Mohamed Kotb | 01288536381  -  License CLI menu
rem  Double-click me: opens a small command-line menu for the
rem  offline-license workflow (show HWID, issue a license,
rem  build + start the app, stop the app).
rem  No typing of HWID needed - "issue-here" reads it for you.
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul
title GymSystem - License & Dev Tools

:menu
cls
echo.
echo   ============================================
echo     GymSystem - أدوات الترخيص والتطوير
echo   ============================================
echo.
echo     [1] عرض رمز الجهاز (HWID)
echo     [2] إصدار رخصة لهذا الجهاز  (يكتب license.lic)
echo     [3] بناء وتشغيل التطبيق
echo     [4] إيقاف التطبيق (يقفل السيرفر)
echo     [5] خروج
echo.
choice /C 12345 /N /M "  اختر رقم: "
if errorlevel 5 exit /b 0
if errorlevel 4 goto stop
if errorlevel 3 goto run
if errorlevel 2 goto issue
if errorlevel 1 goto hwid
echo   اختيار غير صالح
timeout /t 1 /nobreak >nul
goto menu

:hwid
cls
echo.
echo   رمز الجهاز (HWID):
echo.
call npm run license:hwid
echo.
pause
goto menu

:issue
cls
echo.
echo   إصدار رخصة لهذا الجهاز
echo.
set /p days="  عدد أيام الرخصة (مثال: 365): "
if "%days%"=="" set days=365
set /p gym="  اسم النادي (مثال: نادي التجربة): "
if "%gym%"=="" set gym=GymSystem
call npm run license:issue-here -- --gym "%gym%" --days %days%
echo.
echo   تم إصدار الرخصة - ارفع/الصق ملف license.lic في شاشة التفعيل داخل التطبيق.
echo.
pause
goto menu

:run
cls
echo.
echo   بناء المشروع ثم تشغيل التطبيق ...
echo   (سيفتح السيرفر ثم المتصفح على http://localhost:8890)
echo.
call npm run build
if errorlevel 1 (
  echo   فشل البناء. تحقق من الأخطاء أعلاه.
  pause
  goto menu
)
echo   تم البناء بنجاح. جاري تشغيل السيرفر في نافذة منفصلة ...
start "GymSystem Backend" /min cmd /c "node dist-server\index.cjs"
echo   انتظار الجاهزية ...
set /a tries=0
:wait_run
timeout /t 1 /nobreak >nul
curl -s -o nul http://127.0.0.1:8890/api/ping
if errorlevel 1 (
  set /a tries+=1
  if !tries! lss 15 goto wait_run
  echo   السيرفر لم يستجب. تحقق من نافذة الـ Backend.
  pause
  goto menu
)
start "" http://127.0.0.1:8890/
echo   جارٍ فتح المتصفح ...
echo.
pause
goto menu

:stop
cls
echo.
echo   إيقاف أي عملية سيرفر (node dist-server\index.cjs) ...
taskkill /f /im node.exe >nul 2>&1
echo   تم الإيقاف.
echo.
pause
goto menu