#!/bin/bash
echo "========================================================"
echo "      INTRADAY WEB - AUTO GITHUB DOWNLOAD SYSTEM (LINUX)"
echo "========================================================"
echo

echo "Downloading latest updates from GitHub..."
git pull origin main
echo

if [ -f server/storage/postgres_backup.sql ]; then
    echo "Importing Docker PostgreSQL Database..."
    if sg docker -c "docker ps | grep market_timescaledb" >/dev/null; then
        sg docker -c "docker exec -i market_timescaledb psql -U market_analyst -d market_intelligence" < server/storage/postgres_backup.sql
        echo "Docker PostgreSQL imported successfully."
    else
        echo "[WARNING] Docker PostgreSQL container is not running."
    fi
fi
echo

echo "========================================================"
echo "      Download Successfully Completed!"
echo "========================================================"
