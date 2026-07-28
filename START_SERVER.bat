@echo off
echo ============================================
echo  AMEX OS - Starting Trading Server
echo ============================================
echo.

REM Kill any existing node processes on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo Stopping existing server on port 3000 (PID: %%a)
    taskkill /F /PID %%a 2>nul
)

timeout /t 2 /nobreak >nul

echo Starting AMEX OS server...
echo.
node node_modules/tsx/dist/cli.mjs server.ts

pause
