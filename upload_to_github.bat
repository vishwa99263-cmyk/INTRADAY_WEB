@echo off
color 0A
echo ========================================================
echo       INTRADAY WEB - AUTO GITHUB UPLOAD SYSTEM
echo ========================================================
echo.

echo Adding new files...
"C:\Program Files\Git\cmd\git.exe" add .
echo.

set /p msg="Update ka naam likhein (Ya enter dabayein default ke liye): "
if "%msg%"=="" set msg=Auto Update %date% %time%

echo.
echo Committing changes...
"C:\Program Files\Git\cmd\git.exe" commit -m "%msg%"
echo.

echo Uploading to GitHub...
"C:\Program Files\Git\cmd\git.exe" push -u origin main
echo.

echo ========================================================
echo       Upload Successfully Completed!
echo ========================================================
pause
