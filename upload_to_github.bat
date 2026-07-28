@echo off
color 0A
echo ========================================================
echo       AMEX_OS - AUTO GITHUB UPLOAD SYSTEM
echo ========================================================
echo.

echo Exporting Docker PostgreSQL Database...
docker exec -t market_timescaledb pg_dump -U market_analyst -d market_intelligence > server\storage\postgres_backup.sql 2>nul
if errorlevel 1 (
    echo [WARNING] Docker PostgreSQL export failed or container not running.
) else (
    echo Docker PostgreSQL exported successfully.
    echo Compressing PostgreSQL dump...
    powershell -Command "Compress-Archive -Path 'server\storage\postgres_backup.sql' -DestinationPath 'server\storage\postgres_backup.zip' -Force" 2>nul
    if exist "server\storage\postgres_backup.sql" del "server\storage\postgres_backup.sql" 2>nul
)
echo.

if not exist "server\storage\.gitkeep" echo. > "server\storage\.gitkeep"

echo Adding files...
"C:\Program Files\Git\cmd\git.exe" add -f server/storage/.gitkeep
"C:\Program Files\Git\cmd\git.exe" add -f server/storage/postgres_backup.zip
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
