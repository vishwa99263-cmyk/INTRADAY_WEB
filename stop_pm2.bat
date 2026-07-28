@echo off
title INTRADAY WEB Stop Manager
echo ==============================================
echo       STOPPING INTRADAY WEB TRADING BOT
echo ==============================================
echo.

cd /d "C:\Users\gt\Music\INTRADAY WEB"

echo [1/2] Stopping PM2 process: tradingbot...
call npx pm2 stop tradingbot
call npx pm2 delete tradingbot >nul 2>&1

echo.
echo [2/2] Saving PM2 state...
call npx pm2 save --force >nul 2>&1

echo.
echo ==============================================
echo  SUCCESS: Bot has been stopped and removed.
echo ==============================================
timeout /t 3 /nobreak >nul
