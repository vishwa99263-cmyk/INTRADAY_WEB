@echo off
title AMEX OS - Trading Server
color 0A

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║          AMEX OS - Starting Server...        ║
echo  ║          http://localhost:3000               ║
echo  ╚══════════════════════════════════════════════╝
echo.

cd /d "C:\Users\vishwa\Music\amex_os"

echo [1/2] Opening browser in 4 seconds...
timeout /t 4 /nobreak >nul
start "" "http://localhost:3000"

echo [2/2] Starting server (DO NOT CLOSE THIS WINDOW)...
echo.
node_modules\.bin\tsx server.ts

echo.
echo Server stopped. Press any key to exit.
pause >nul
