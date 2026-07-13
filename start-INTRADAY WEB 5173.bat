@echo off
title INTRADAY WEB - Dev Server
cd /d "C:\Users\vishwa\Music\INTRADAY WEB"
echo.
echo  ╔════════════════════════════════════════╗
echo  ║   INTRADAY WEB - Starting Dev Server...  ║
echo  ║   Open: http://localhost:5173          ║
echo  ╚════════════════════════════════════════╝
echo.
start "" "http://localhost:5173"
npx --yes vite --port 5173
pause
