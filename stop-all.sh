#!/bin/bash

# Data Bunker - Stop All Services Script

set -e

echo "═══════════════════════════════════════════════════════════"
echo "        STOPPING ALL DATA BUNKER SERVICES"
echo "═══════════════════════════════════════════════════════════"
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Stop enrichment workers
if [ -f /tmp/enrichment-workers.pid ]; then
    echo -e "${YELLOW}🛑 Stopping enrichment workers...${NC}"
    cd "$(dirname "${BASH_SOURCE[0]}")/backend"
    node scripts/stop-enrichment-workers.js || true
    rm -f /tmp/enrichment-workers.pid
    echo -e "${GREEN}✅ Workers stopped${NC}"
fi

# Stop frontend
if [ -f /tmp/data-bunker-frontend.pid ]; then
    echo -e "${YELLOW}🛑 Stopping frontend...${NC}"
    kill $(cat /tmp/data-bunker-frontend.pid) 2>/dev/null || true
    rm -f /tmp/data-bunker-frontend.pid
    echo -e "${GREEN}✅ Frontend stopped${NC}"
fi

# Stop backend
if [ -f /tmp/data-bunker-backend.pid ]; then
    echo -e "${YELLOW}🛑 Stopping backend...${NC}"
    kill $(cat /tmp/data-bunker-backend.pid) 2>/dev/null || true
    rm -f /tmp/data-bunker-backend.pid
    echo -e "${GREEN}✅ Backend stopped${NC}"
fi

# Kill any remaining processes on ports
lsof -ti:5000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Keep database running (never stop it!)
echo -e "${GREEN}✅ Database still running (never stops)${NC}"

echo ""
echo -e "${GREEN}All services stopped (database still running)${NC}"
echo "═══════════════════════════════════════════════════════════"
