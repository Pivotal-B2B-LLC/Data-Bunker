#!/bin/bash

###############################################################################
# CALIFORNIA CITIES DISCOVERY
# Discovers companies in all major California cities
###############################################################################

BACKEND_DIR="/workspaces/Data-Bunker/backend"
LOG_DIR="$BACKEND_DIR/logs"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   CALIFORNIA CITIES - COMPANY DISCOVERY                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# California cities with target company counts
CITIES=(
  "Los Angeles|1500"
  "San Francisco|1000"
  "San Diego|800"
  "San Jose|800"
  "Sacramento|500"
  "Fresno|400"
  "Oakland|600"
  "Long Beach|500"
  "Bakersfield|300"
  "Anaheim|400"
  "Santa Clara|500"
  "Riverside|400"
  "Stockton|300"
  "Irvine|600"
  "San Bernardino|300"
  "Fremont|400"
  "Modesto|300"
  "Santa Ana|400"
  "Pasadena|500"
  "Sunnyvale|500"
  "Berkeley|400"
  "Palo Alto|600"
  "Mountain View|500"
  "Santa Monica|500"
  "Beverly Hills|400"
  "Burbank|400"
  "Glendale|400"
  "Torrance|400"
  "Newport Beach|500"
  "Huntington Beach|400"
)

TOTAL_CITIES=${#CITIES[@]}
TOTAL_TARGET=0

for city_config in "${CITIES[@]}"; do
  IFS='|' read -r city limit <<< "$city_config"
  TOTAL_TARGET=$((TOTAL_TARGET + limit))
done

echo -e "${BLUE}Total Cities: $TOTAL_CITIES${NC}"
echo -e "${BLUE}Target Companies: $TOTAL_TARGET${NC}"
echo ""

START_TIME=$(date +%s)
COMPLETED=0
FAILED=0
TOTAL_DISCOVERED=0

# Process each city
for city_config in "${CITIES[@]}"; do
  IFS='|' read -r city limit <<< "$city_config"
  
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}[$((COMPLETED+1))/$TOTAL_CITIES] $city, California${NC}"
  echo -e "${GREEN}Target: $limit companies${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  cd "$BACKEND_DIR"
  
  # Run discovery using the better script
  LOG_FILE="$LOG_DIR/ca-${city// /-}-discovery.log"
  node scripts/discover-us-companies.js "$city" "California" "$limit" 2>&1 | tee "$LOG_FILE"
  
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo -e "${GREEN}✅ Completed: $city${NC}"
    COMPLETED=$((COMPLETED+1))
    
    # Extract discovered count from log
    DISCOVERED=$(grep -oP 'Saved: \K\d+' "$LOG_FILE" | tail -1)
    if [ -n "$DISCOVERED" ]; then
      TOTAL_DISCOVERED=$((TOTAL_DISCOVERED + DISCOVERED))
    fi
  else
    echo -e "${RED}❌ Failed: $city${NC}"
    FAILED=$((FAILED+1))
  fi
  
  # Progress update
  ELAPSED=$(($(date +%s) - START_TIME))
  ELAPSED_MIN=$((ELAPSED / 60))
  
  echo ""
  echo -e "${BLUE}Progress: $COMPLETED/$TOTAL_CITIES cities | Discovered: $TOTAL_DISCOVERED companies | Time: ${ELAPSED_MIN}m${NC}"
  
  # Brief pause between cities
  sleep 3
done

# Final summary
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
TOTAL_MIN=$((TOTAL_TIME / 60))

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   CALIFORNIA DISCOVERY COMPLETE                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}✅ Successful: $COMPLETED cities${NC}"
echo -e "${RED}❌ Failed: $FAILED cities${NC}"
echo -e "${BLUE}📊 Total Discovered: $TOTAL_DISCOVERED companies${NC}"
echo -e "${BLUE}⏱️  Total Time: ${TOTAL_MIN} minutes${NC}"
echo ""
echo "Next steps:"
echo "  1. Enrichment workers will automatically process all companies"
echo "  2. Monitor: curl http://localhost:5000/api/enrichment/stats | jq"
echo "  3. View logs: ls -lh $LOG_DIR/ca-*.log"
echo ""
