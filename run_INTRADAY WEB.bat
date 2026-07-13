@echo off
title amex_os Startup Manager
echo ==============================================
echo       STARTING amex_os TRADING BOT
echo ==============================================
echo.

cd /d "C:\Users\vishwa\Music\amex_os"

echo [1/3] Restarting PM2 process...
call npx --yes pm2 delete amex_os >nul 2>&1
call npx --yes pm2 start ecosystem.config.cjs

echo.
echo [2/3] Waiting for server to start...
timeout /t 3 /nobreak >nul

echo.
echo [3/3] Opening dashboard in browser...
start http://localhost:3000

echo.
echo ==============================================
echo  SUCCESS: Bot is running online in background.
echo  Closing manager window...
echo ==============================================
timeout /t 2 /nobreak >nul
