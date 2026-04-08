#!/bin/bash

###############################################################################
# STOP ALL BACKGROUND SYSTEMS
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
PID_DIR="$BACKEND_DIR"

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${YELLOW}🛑 Stopping all background systems...${NC}"
echo ""

# Stop discovery
if [ -f "$PID_DIR/discovery.pid" ]; then
    DISCOVERY_PID=$(cat "$PID_DIR/discovery.pid")
    if ps -p $DISCOVERY_PID > /dev/null 2>&1; then
        echo "Stopping discovery (PID: $DISCOVERY_PID)..."
        kill -SIGTERM $DISCOVERY_PID 2>/dev/null
        sleep 2
        if ps -p $DISCOVERY_PID > /dev/null 2>&1; then
            kill -9 $DISCOVERY_PID 2>/dev/null
        fi
        echo -e "${GREEN}✅ Discovery stopped${NC}"
    fi
    rm "$PID_DIR/discovery.pid"
fi

# Stop enrichment workers
if [ -f "$PID_DIR/enrichment-workers.pid" ]; then
    echo "Stopping enrichment workers..."
    MANAGER_PID=$(cat "$PID_DIR/enrichment-workers.pid" | grep -o '"managerPid":[0-9]*' | grep -o '[0-9]*')
    WORKER_PIDS=$(cat "$PID_DIR/enrichment-workers.pid" | grep -o '"workerPids":\[[^]]*\]' | grep -o '[0-9]*')
    
    # Kill manager
    if [ -n "$MANAGER_PID" ] && ps -p $MANAGER_PID > /dev/null 2>&1; then
        kill -SIGTERM $MANAGER_PID 2>/dev/null
    fi
    
    # Kill workers
    for PID in $WORKER_PIDS; do
        if ps -p $PID > /dev/null 2>&1; then
            kill -SIGTERM $PID 2>/dev/null
        fi
    done
    
    sleep 2
    
    # Force kill if still running
    if [ -n "$MANAGER_PID" ] && ps -p $MANAGER_PID > /dev/null 2>&1; then
        kill -9 $MANAGER_PID 2>/dev/null
    fi
    
    for PID in $WORKER_PIDS; do
        if ps -p $PID > /dev/null 2>&1; then
            kill -9 $PID 2>/dev/null
        fi
    done
    
    rm "$PID_DIR/enrichment-workers.pid"
    echo -e "${GREEN}✅ Enrichment workers stopped${NC}"
fi

# Stop enrichment manager if exists
if [ -f "$PID_DIR/enrichment-manager.pid" ]; then
    MANAGER_PID=$(cat "$PID_DIR/enrichment-manager.pid")
    if ps -p $MANAGER_PID > /dev/null 2>&1; then
        kill -SIGTERM $MANAGER_PID 2>/dev/null
        sleep 1
        if ps -p $MANAGER_PID > /dev/null 2>&1; then
            kill -9 $MANAGER_PID 2>/dev/null
        fi
    fi
    rm "$PID_DIR/enrichment-manager.pid"
fi

echo ""
echo -e "${GREEN}✅ All background systems stopped${NC}"
echo ""
