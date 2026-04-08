#!/bin/bash

# Data Bunker - Health Check & Auto-Restart Script
# Run this in cron or background to ensure services stay up

check_and_restart() {
    local service=$1
    local check_cmd=$2
    local restart_cmd=$3
    
    if ! eval "$check_cmd" >/dev/null 2>&1; then
        echo "[$(date)] $service is down, restarting..."
        eval "$restart_cmd"
        echo "[$(date)] $service restarted"
        return 1
    fi
    return 0
}

# Check database (most critical!)
check_and_restart "Database" \
    "docker exec data-bunker-db pg_isready -U postgres" \
    "cd /workspaces/Data-Bunker && docker-compose -f docker-compose.simple.yml up -d"

# Check backend
check_and_restart "Backend" \
    "curl -sf http://localhost:5000/health" \
    "cd /workspaces/Data-Bunker && kill $(cat /tmp/data-bunker-backend.pid 2>/dev/null) 2>/dev/null; sleep 2; cd backend && nohup node server.js > /tmp/data-bunker-backend.log 2>&1 & echo \$! > /tmp/data-bunker-backend.pid"

# Check frontend
check_and_restart "Frontend" \
    "curl -sf http://localhost:3000" \
    "cd /workspaces/Data-Bunker && kill $(cat /tmp/data-bunker-frontend.pid 2>/dev/null) 2>/dev/null; sleep 2; cd frontend && nohup npm start > /tmp/data-bunker-frontend.log 2>&1 & echo \$! > /tmp/data-bunker-frontend.pid"

echo "[$(date)] All services healthy ✓"
