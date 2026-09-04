@echo off
rem ============================================================
rem  Yassen Mohamed Kotb | 01288536381  -  License Tool menu v3
rem  This is the LICENSE TOOL — NOT dev.bat.
rem  Use this to issue licenses and run the app.
rem ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0..\.."
chcp 65001 >nul
title GymSystem - License Tool v3

:menu
cls
echo.
echo   ============================================
echo     GymSystem - License Tool v3
echo     (this is the LICENSE TOOL, not dev.bat)
echo   ============================================
echo.
echo     [1] عرض رمز الجهاز (HWID)
echo     [2] إصدار رخصة لهذا الجهاز  (يكتب license.lic)
echo     [3] بناء وتشغيل التطبيق
echo     [4] إيقاف التطبيق (يقفل السيرفر)
echo     [5] خروج
echo.
echo   ! اكتب رقما ثم Enter لاختيار العملية !
echo.
set /p choice="  اختر رقم (1-5): "
set "choice=%choice: =%"
if "%choice%"=="1" goto hwid
if "%choice%"=="2" goto issue
if "%choice%"=="3" goto run
if "%choice%"=="4" goto stop
if "%choice%"=="5" exit /b 0
if "%choice%"=="" (
  echo   لم يتم اختيار شيء - ارجع للقائمة ...
  timeout /t 1 /nobreak >nul
  goto menu
)
echo   اختيار غير صالح: "%choice%"
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
set /p confirm="  متأكد؟ اكتب y ثم Enter للمواصلة: "
if /i not "%confirm%"=="y" (
  echo   تم الإلغاء.
  pause
  goto menu
)
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