#!/bin/bash

###############################################################################
# REAL-TIME STATUS MONITOR
# Shows live progress of discovery and enrichment
###############################################################################

BACKEND_DIR="/workspaces/Data-Bunker/backend"
LOG_DIR="$BACKEND_DIR/logs"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

clear

while true; do
    # Move cursor to top
    tput cup 0 0
    
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  LIVE STATUS MONITOR - Data Bunker                        ║${NC}"
    echo -e "${BLUE}║  $(date '+%Y-%m-%d %H:%M:%S')                                       ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Database stats
    echo -e "${YELLOW}━━━━ DATABASE STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    docker exec -i data-bunker-db psql -U postgres -d databunker -t -c "
    SELECT 
        '  Total Companies: ' || COUNT(*) || '
  UK Companies: ' || SUM(CASE WHEN jurisdiction='gb' THEN 1 ELSE 0 END) || '
  NY Companies: ' || SUM(CASE WHEN jurisdiction='us_ny' THEN 1 ELSE 0 END) || '
    - With website: ' || SUM(CASE WHEN jurisdiction='us_ny' AND website IS NOT NULL THEN 1 ELSE 0 END) || '
    - With phone: ' || SUM(CASE WHEN jurisdiction='us_ny' AND phone IS NOT NULL THEN 1 ELSE 0 END) || '
    - With email: ' || SUM(CASE WHEN jurisdiction='us_ny' AND email IS NOT NULL THEN 1 ELSE 0 END) || '
    - With address: ' || SUM(CASE WHEN jurisdiction='us_ny' AND address_line_1 IS NOT NULL THEN 1 ELSE 0 END)
    FROM companies;
    " 2>/dev/null | head -8
    
    echo ""
    
    # Discovery progress
    echo -e "${YELLOW}━━━━ DISCOVERY PROGRESS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -f "$BACKEND_DIR/data/ny-discovery-stats.json" ]; then
        cat "$BACKEND_DIR/data/ny-discovery-stats.json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(f\"  Searches: {data.get('totalSearches', 0)}\")
    print(f\"  Companies Found: {data.get('totalCompaniesFound', 0)}\")
    print(f\"  Areas Completed: {data.get('completedAreas', 0)}\")
    print(f\"  Rate: {data.get('companiesPerHour', 0):.1f} companies/hour\")
except:
    print('  Initializing...')
" 2>/dev/null
    else
        echo "  Initializing..."
    fi
    
    echo ""
    
    # Enrichment workers
    echo -e "${YELLOW}━━━━ ENRICHMENT WORKERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -f "$BACKEND_DIR/enrichment-workers.pid" ]; then
        WORKER_COUNT=$(cat "$BACKEND_DIR/enrichment-workers.pid" | grep -o '"numWorkers":[0-9]*' | grep -o '[0-9]*')
        echo -e "  ${GREEN}✅ Active: $WORKER_COUNT workers${NC}"
    else
        echo -e "  ${RED}❌ Not running${NC}"
    fi
    
    echo ""
    
    # Recent discoveries
    echo -e "${YELLOW}━━━━ RECENT DISCOVERIES (last 10) ━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    docker exec -i data-bunker-db psql -U postgres -d databunker -t -c "
    SELECT '  ' || name || ' (' || locality || ')'
    FROM companies 
    WHERE jurisdiction='us_ny' 
    ORDER BY created_at DESC 
    LIMIT 10;
    " 2>/dev/null
    
    echo ""
    echo -e "${BLUE}Press Ctrl+C to exit${NC}"
    
    sleep 5
done
