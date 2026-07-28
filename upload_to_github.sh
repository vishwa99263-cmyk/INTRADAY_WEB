#!/bin/bash
echo "========================================================"
echo "      AMEX_OS - AUTO GITHUB UPLOAD SYSTEM (LINUX)"
echo "========================================================"
echo

echo "Exporting Docker PostgreSQL Database..."
if sg docker -c "docker ps | grep market_timescaledb" >/dev/null 2>&1; then
    sg docker -c "docker exec -t market_timescaledb pg_dump -U market_analyst -d market_intelligence" > server/storage/postgres_backup.sql
    echo "Docker PostgreSQL exported successfully."
    echo "Compressing PostgreSQL dump..."
    if command -v zip >/dev/null 2>&1; then
        zip -q -j server/storage/postgres_backup.zip server/storage/postgres_backup.sql
        rm -f server/storage/postgres_backup.sql
    elif command -v gzip >/dev/null 2>&1; then
        gzip -f server/storage/postgres_backup.sql
    fi
else
    echo "[WARNING] Docker PostgreSQL container is not running."
fi
echo

touch server/storage/.gitkeep

echo "Adding files to Git..."
git add -f server/storage/.gitkeep
git add -f server/storage/postgres_backup.zip 2>/dev/null || git add -f server/storage/postgres_backup.sql.gz 2>/dev/null
git add -f server/storage/governor_state.json 2>/dev/null
git add -f server/storage/autotrade_config.json 2>/dev/null
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
