@echo off
setlocal enabledelayedexpansion
title 1688 Invoice Server
cd /d D:\project\1688-invoice
set NODE_ENV=development
set NODE_OPTIONS=--max-old-space-size=4096
echo ========================================
echo   1688 Invoice Server Starting...
echo ========================================
echo.
echo 서버 주소: http://192.168.0.99:3001
echo.
call npm run dev
endlocal