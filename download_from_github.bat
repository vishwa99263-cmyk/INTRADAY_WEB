@echo off
color 0B
echo ========================================================
echo       INTRADAY WEB - AUTO GITHUB DOWNLOAD SYSTEM
echo ========================================================
echo.

echo Downloading latest updates from GitHub...
"C:\Program Files\Git\cmd\git.exe" pull origin main
echo.

if exist server\storage\postgres_backup.sql (
    echo Importing Docker PostgreSQL Database...
    docker exec -i market_timescaledb psql -U market_analyst -d market_intelligence < server\storage\postgres_backup.sql 2>nul
    if errorlevel 1 (
        echo [WARNING] Docker PostgreSQL import failed. Make sure Docker container is running.
    ) else (
        echo Docker PostgreSQL imported successfully.
    )
)
echo.

echo ========================================================
echo       Download Successfully Completed!
echo ========================================================
pause
