#!/bin/bash
echo "========================================================"
echo "      INTRADAY WEB - AUTO GITHUB UPLOAD SYSTEM (LINUX)"
echo "========================================================"
echo

echo "Exporting Docker PostgreSQL Database..."
if sg docker -c "docker ps | grep market_timescaledb" >/dev/null; then
    sg docker -c "docker exec -t market_timescaledb pg_dump -U market_analyst -d market_intelligence" > server/storage/postgres_backup.sql
    echo "Docker PostgreSQL exported successfully."
else
    echo "[WARNING] Docker PostgreSQL container is not running."
fi
echo

echo "Adding files to Git..."
git add -f server/storage/indicators.db
git add -f server/storage/postgres_backup.sql
git add -f server/storage/governor_state.json
git add -f server/storage/autotrade_config.json
git add .
echo

read -p "Update ka naam likhein (Ya enter dabayein default ke liye): " msg
if [ -z "$msg" ]; then
    msg="Auto Update $(date)"
fi
echo

echo "Committing changes..."
git commit -m "$msg"
echo

echo "Uploading to GitHub..."
git push -u origin main
echo

echo "========================================================"
echo "      Upload Successfully Completed!"
echo "========================================================"
