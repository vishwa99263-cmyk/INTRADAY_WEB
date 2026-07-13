@echo off
title amex_os Stop Manager
echo ==============================================
echo       STOPPING amex_os TRADING BOT
echo ==============================================
echo.

cd /d "C:\Users\gt\Music\amex_os"

echo [1/2] Stopping PM2 process: amex_os...
call npx pm2 stop amex_os
call npx pm2 delete amex_os >nul 2>&1

echo.
echo [2/2] Saving PM2 state...
call npx pm2 save --force >nul 2>&1

echo.
echo ==============================================
echo  SUCCESS: Bot has been stopped and removed.
echo ==============================================
timeout /t 3 /nobreak >nul
