@echo off
rem Starts the local WhatsApp gateway (bound to 127.0.0.1:8891) for QR card delivery.
rem It opens a visible WhatsApp Web window for first-time pairing; session persists.
setlocal
cd /d "%~dp0..\..\whatsapp-gateway"
title WhatsApp Gateway (127.0.0.1:8891)
node index.js
pause