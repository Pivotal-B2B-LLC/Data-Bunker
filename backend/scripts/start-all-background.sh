#!/bin/bash

###############################################################################
# MASTER BACKGROUND SYSTEMS CONTROLLER
# 
# This script starts and monitors ALL background enrichment systems:
# 1. Company Discovery (finds new companies continuously)
# 2. Enrichment Workers (enriches with contacts, officers, etc.)
# 3. Progress Monitoring
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$BACKEND_DIR/logs"
PID_DIR="$BACKEND_DIR"

# Create logs directory
mkdir -p "$LOG_DIR"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   MASTER BACKGROUND SYSTEMS CONTROLLER                        ║"
echo "║   Starting all discovery & enrichment systems                 ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

###############################################################################
# 1. START COMPREHENSIVE DISCOVERY
###############################################################################
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}1. COMPREHENSIVE COMPANY DISCOVERY${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check if already running
if [ -f "$PID_DIR/discovery.pid" ]; then
    DISCOVERY_PID=$(cat "$PID_DIR/discovery.pid")
    if ps -p $DISCOVERY_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Discovery already running (PID: $DISCOVERY_PID)${NC}"
    else
        echo "Removing stale PID file..."
        rm "$PID_DIR/discovery.pid"
    fi
fi

if [ ! -f "$PID_DIR/discovery.pid" ]; then
    echo "Starting comprehensive NY company discovery..."
    cd "$BACKEND_DIR"
    nohup node scripts/comprehensive-ny-discovery.js > "$LOG_DIR/discovery.log" 2>&1 &
    DISCOVERY_PID=$!
    echo $DISCOVERY_PID > "$PID_DIR/discovery.pid"
    echo -e "${GREEN}✅ Discovery started (PID: $DISCOVERY_PID)${NC}"
    echo "   Log: $LOG_DIR/discovery.log"
else
    DISCOVERY_PID=$(cat "$PID_DIR/discovery.pid")
    echo -e "${GREEN}✅ Discovery running (PID: $DISCOVERY_PID)${NC}"
fi

echo ""

###############################################################################
# 2. START ENRICHMENT WORKERS
###############################################################################
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}2. ENRICHMENT WORKERS (40 workers)${NC}"
echo -e "${BLUE}   - Website discovery${NC}"
echo -e "${BLUE}   - Contact info scraping${NC}"
echo -e "${BLUE}   - Search-based phone/email/address discovery${NC}"
echo -e "${BLUE}   - UK Companies House officer enrichment${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check if enrichment workers are running
if [ -f "$PID_DIR/enrichment-workers.pid" ]; then
    MANAGER_PID=$(cat "$PID_DIR/enrichment-workers.pid" | grep -o '"managerPid":[0-9]*' | grep -o '[0-9]*')
    if [ -n "$MANAGER_PID" ] && ps -p $MANAGER_PID > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Enrichment workers already running (Manager PID: $MANAGER_PID)${NC}"
        WORKER_COUNT=$(cat "$PID_DIR/enrichment-workers.pid" | grep -o '"numWorkers":[0-9]*' | grep -o '[0-9]*')
        echo "   Active workers: $WORKER_COUNT"
    else
        echo "Removing stale enrichment PID file..."
        rm "$PID_DIR/enrichment-workers.pid"
    fi
fi

if [ ! -f "$PID_DIR/enrichment-workers.pid" ] || ! ps -p $MANAGER_PID > /dev/null 2>&1; then
    echo "Starting 40 enrichment workers..."
    cd "$BACKEND_DIR"
    nohup node scripts/start-enrichment-workers.js 40 > "$LOG_DIR/enrichment.log" 2>&1 &
    ENRICHMENT_PID=$!
    echo $ENRICHMENT_PID > "$PID_DIR/enrichment-manager.pid"
    sleep 3
    echo -e "${GREEN}✅ Enrichment workers started${NC}"
    echo "   Log: $LOG_DIR/enrichment.log"
else
    echo -e "${GREEN}✅ Enrichment workers running${NC}"
fi

echo ""

###############################################################################
# 3. SYSTEM STATUS
###############################################################################
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}3. CURRENT STATUS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Get database stats
echo "Querying database..."
cd "$BACKEND_DIR"
DB_STATS=$(docker exec -i data-bunker-db psql -U postgres -d databunker -t -c "
SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN jurisdiction='us_ny' THEN 1 ELSE 0 END) as ny_companies,
    SUM(CASE WHEN jurisdiction='us_ny' AND website IS NOT NULL THEN 1 ELSE 0 END) as ny_with_website,
    SUM(CASE WHEN jurisdiction='us_ny' AND phone IS NOT NULL THEN 1 ELSE 0 END) as ny_with_phone,
    SUM(CASE WHEN jurisdiction='us_ny' AND email IS NOT NULL THEN 1 ELSE 0 END) as ny_with_email,
    SUM(CASE WHEN jurisdiction='us_ny' AND address_line_1 IS NOT NULL THEN 1 ELSE 0 END) as ny_with_address
FROM companies;
" 2>/dev/null)

if [ -n "$DB_STATS" ]; then
    TOTAL=$(echo "$DB_STATS" | awk '{print $1}')
    NY_TOTAL=$(echo "$DB_STATS" | awk '{print $3}')
    NY_WEB=$(echo "$DB_STATS" | awk '{print $5}')
    NY_PHONE=$(echo "$DB_STATS" | awk '{print $7}')
    NY_EMAIL=$(echo "$DB_STATS" | awk '{print $9}')
    NY_ADDR=$(echo "$DB_STATS" | awk '{print $11}')
    
    echo -e "${GREEN}📊 Database Status:${NC}"
    echo "   Total companies: $TOTAL"
    echo "   NY companies: $NY_TOTAL"
    echo "   - With website: $NY_WEB"
    echo "   - With phone: $NY_PHONE"
    echo "   - With email: $NY_EMAIL"
    echo "   - With address: $NY_ADDR"
fi

# Check discovery progress
if [ -f "$BACKEND_DIR/data/ny-discovery-stats.json" ]; then
    echo ""
    echo -e "${GREEN}🔍 Discovery Progress:${NC}"
    DISC_STATS=$(cat "$BACKEND_DIR/data/ny-discovery-stats.json" 2>/dev/null)
    if [ -n "$DISC_STATS" ]; then
        SEARCHES=$(echo "$DISC_STATS" | grep -o '"totalSearches":[0-9]*' | grep -o '[0-9]*')
        FOUND=$(echo "$DISC_STATS" | grep -o '"totalCompaniesFound":[0-9]*' | grep -o '[0-9]*')
        AREAS=$(echo "$DISC_STATS" | grep -o '"completedAreas":[0-9]*' | grep -o '[0-9]*')
        echo "   Searches completed: $SEARCHES"
        echo "   Companies discovered: $FOUND"
        echo "   Areas completed: $AREAS"
    fi
fi

echo ""

###############################################################################
# 4. MONITORING COMMANDS
###############################################################################
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}4. MONITORING COMMANDS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo ""
echo "Watch discovery log:"
echo "  tail -f $LOG_DIR/discovery.log"
echo ""
echo "Watch enrichment log:"
echo "  tail -f $LOG_DIR/enrichment.log"
echo ""
echo "Check database stats:"
echo "  docker exec -i data-bunker-db psql -U postgres -d databunker -c \"SELECT COUNT(*), jurisdiction, COUNT(phone) as phones, COUNT(email) as emails FROM companies GROUP BY jurisdiction;\""
echo ""
echo "View completed areas:"
echo "  cat $BACKEND_DIR/data/ny-completed-areas.json | grep -o '\"' | wc -l"
echo ""
echo "Stop all systems:"
echo "  bash $SCRIPT_DIR/stop-all-background.sh"
echo ""
echo "Clean storage:"
echo "  bash $SCRIPT_DIR/auto-cleanup.sh"
echo ""

###############################################################################
# 5. RUN AUTO CLEANUP
###############################################################################
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}5. STORAGE CLEANUP${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo "Running automatic cleanup..."
bash "$SCRIPT_DIR/auto-cleanup.sh"

echo ""

###############################################################################
# 6. SUCCESS MESSAGE
###############################################################################
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ ALL SYSTEMS RUNNING IN BACKGROUND                         ║${NC}"
echo -e "${GREEN}║                                                               ║${NC}"
echo -e "${GREEN}║  🔍 Discovery: Finding ALL NY companies                       ║${NC}"
echo -e "${GREEN}║  💼 Enrichment: Adding contacts, officers, addresses          ║${NC}"
echo -e "${GREEN}║  📊 Progress: Saved continuously to data/ folder              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
