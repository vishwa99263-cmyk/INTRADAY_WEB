@echo off
color 0A
echo ========================================================
echo       INTRADAY WEB - AUTO GITHUB UPLOAD SYSTEM
echo ========================================================
echo.

echo Exporting Docker PostgreSQL Database...
docker exec -t market_timescaledb pg_dump -U market_analyst -d market_intelligence > server\storage\postgres_backup.sql 2>nul
if errorlevel 1 (
    echo [WARNING] Docker PostgreSQL export failed or container not running.
) else (
    echo Docker PostgreSQL exported successfully.
)
echo.

echo Adding files...
"C:\Program Files\Git\cmd\git.exe" add -f server/storage/indicators.db
"C:\Program Files\Git\cmd\git.exe" add -f server/storage/postgres_backup.sql
"C:\Program Files\Git\cmd\git.exe" add -f server/storage/governor_state.json
"C:\Program Files\Git\cmd\git.exe" add -f server/storage/autotrade_config.json
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
