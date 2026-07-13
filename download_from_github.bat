@echo off
color 0B
echo ========================================================
echo       INTRADAY WEB - AUTO GITHUB DOWNLOAD SYSTEM
echo ========================================================
echo.

echo Downloading latest updates from GitHub...
"C:\Program Files\Git\cmd\git.exe" pull origin main
echo.

echo ========================================================
echo       Download Successfully Completed!
echo ========================================================
pause
