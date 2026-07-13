@echo off
docker exec market_timescaledb psql -U market_analyst -d market_intelligence -c "SELECT relname as table_name, n_live_tup as rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"
