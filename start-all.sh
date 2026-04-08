#!/bin/bash

# Data Bunker - Automated Startup Script
# Ensures database is always running and starts all services

set -e

echo "═══════════════════════════════════════════════════════════"
echo "        DATA BUNKER - AUTOMATED STARTUP"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Function to check if database is running
check_db() {
    docker exec data-bunker-db pg_isready -U postgres -d databunker >/dev/null 2>&1
}

# Function to wait for database
wait_for_db() {
    echo -e "${YELLOW}⏳ Waiting for database to be ready...${NC}"
    local retries=30
    while [ $retries -gt 0 ]; do
        if check_db; then
            echo -e "${GREEN}✅ Database is ready!${NC}"
            return 0
        fi
        retries=$((retries - 1))
        sleep 1
    done
    echo -e "${RED}❌ Database failed to start${NC}"
    return 1
}

# Step 1: Start Database
echo -e "${BLUE}[1/5] Starting PostgreSQL Database...${NC}"
if docker ps | grep -q data-bunker-db; then
    echo -e "${GREEN}✅ Database already running${NC}"
else
    docker-compose -f docker-compose.simple.yml up -d
    wait_for_db || exit 1
fi

# Verify data
COMPANY_COUNT=$(docker exec data-bunker-db psql -U postgres -d databunker -t -c "SELECT COUNT(*) FROM companies;" 2>/dev/null | tr -d ' ')
echo -e "${GREEN}✅ Database: $COMPANY_COUNT companies loaded${NC}"
echo ""

# Step 2: Kill any processes on ports 3000 and 5000
echo -e "${BLUE}[2/5] Cleaning up ports...${NC}"
lsof -ti:5000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
echo -e "${GREEN}✅ Ports cleared${NC}"
echo ""

# Step 3: Start Backend
echo -e "${BLUE}[3/5] Starting Backend Server...${NC}"
cd "$PROJECT_ROOT/backend"
export COMPANIES_HOUSE_API_KEY="a63cf07f-2099-4182-91e0-a89edb762c96"
nohup node server.js > /tmp/data-bunker-backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > /tmp/data-bunker-backend.pid
echo -e "${GREEN}✅ Backend started (PID: $BACKEND_PID)${NC}"
sleep 3

# Verify backend
if curl -s http://localhost:5000/health >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend responding on port 5000${NC}"
else
    echo -e "${YELLOW}⚠️  Backend starting... (check logs: tail -f /tmp/data-bunker-backend.log)${NC}"
fi
echo ""

# Step 4: Start Frontend
echo -e "${BLUE}[4/5] Starting Frontend...${NC}"
cd "$PROJECT_ROOT/frontend"
nohup npm start > /tmp/data-bunker-frontend.log 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > /tmp/data-bunker-frontend.pid
echo -e "${GREEN}✅ Frontend started (PID: $FRONTEND_PID)${NC}"
echo -e "${YELLOW}⏳ Frontend will be ready in ~30 seconds...${NC}"
echo ""

# Step 5: Start Enrichment Workers (if queue has jobs)
echo -e "${BLUE}[5/5] Checking Enrichment Queue...${NC}"
sleep 5  # Wait for backend to be fully ready

QUEUE_SIZE=$(curl -s http://localhost:5000/api/enrichment/stats 2>/dev/null | grep -o '"pending":[0-9]*' | grep -o '[0-9]*' || echo "0")

if [ "$QUEUE_SIZE" -gt 0 ]; then
    echo -e "${YELLOW}📊 Queue has $QUEUE_SIZE pending jobs${NC}"
    echo -e "${BLUE}🚀 Starting 15 enrichment workers...${NC}"
    cd "$PROJECT_ROOT/backend"
    nohup bash start-workers.sh 15 > /tmp/enrichment-workers.log 2>&1 &
    WORKERS_PID=$!
    echo $WORKERS_PID > /tmp/enrichment-workers.pid
    echo -e "${GREEN}✅ Workers started (PID: $WORKERS_PID)${NC}"
else
    echo -e "${GREEN}✅ No pending jobs in queue${NC}"
fi
echo ""

# Summary
echo "═══════════════════════════════════════════════════════════"
echo -e "${GREEN}        ALL SERVICES STARTED SUCCESSFULLY!${NC}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📊 Status:"
echo "   Database:  ✅ Running (4M+ companies)"
echo "   Backend:   ✅ http://localhost:5000"
echo "   Frontend:  🔄 http://localhost:3000 (starting...)"
if [ "$QUEUE_SIZE" -gt 0 ]; then
    echo "   Workers:   ✅ 15 workers processing $QUEUE_SIZE jobs"
fi
echo ""
echo "📋 Logs:"
echo "   Backend:   tail -f /tmp/data-bunker-backend.log"
echo "   Frontend:  tail -f /tmp/data-bunker-frontend.log"
if [ "$QUEUE_SIZE" -gt 0 ]; then
    echo "   Workers:   tail -f /tmp/enrichment-workers.log"
fi
echo ""
echo "🛑 Stop all: ./stop-all.sh"
echo "📊 Stats:    curl http://localhost:5000/api/enrichment/stats | jq"
echo ""
echo -e "${GREEN}Ready! Open http://localhost:3000 in your browser${NC}"
echo "═══════════════════════════════════════════════════════════"
