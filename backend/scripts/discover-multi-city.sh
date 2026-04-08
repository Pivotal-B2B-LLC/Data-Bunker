#!/bin/bash

###############################################################################
# MULTI-CITY DISCOVERY LAUNCHER
# Discovers companies in multiple US cities simultaneously or sequentially
###############################################################################

BACKEND_DIR="/workspaces/Data-Bunker/backend"
LOG_DIR="$BACKEND_DIR/logs"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   MULTI-CITY US COMPANY DISCOVERY                             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# City configurations: "City|State|Limit"
CITIES=(
  "Los Angeles|California|1000"
  "San Francisco|California|500"
  "Chicago|Illinois|800"
  "Houston|Texas|700"
  "Phoenix|Arizona|500"
  "Philadelphia|Pennsylvania|600"
  "Miami|Florida|600"
  "Boston|Massachusetts|500"
  "Seattle|Washington|500"
  "Denver|Colorado|400"
  "Austin|Texas|400"
  "San Diego|California|500"
  "Dallas|Texas|600"
  "Atlanta|Georgia|600"
  "Portland|Oregon|400"
)

echo "Available cities:"
for i in "${!CITIES[@]}"; do
  IFS='|' read -r city state limit <<< "${CITIES[$i]}"
  echo "  $((i+1)). $city, $state (target: $limit companies)"
done
echo ""

echo "Options:"
echo "  1) Discover ALL cities (sequential)"
echo "  2) Discover specific city"
echo "  3) Discover top 5 cities"
echo ""
read -p "Choose option (1-3): " OPTION

case $OPTION in
  1)
    echo -e "\n${BLUE}Starting discovery for ALL ${#CITIES[@]} cities...${NC}\n"
    for city_config in "${CITIES[@]}"; do
      IFS='|' read -r city state limit <<< "$city_config"
      echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      echo -e "${GREEN}Starting: $city, $state (target: $limit)${NC}"
      echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      
      cd "$BACKEND_DIR"
      node scripts/discover-us-companies.js "$city" "$state" "$limit" 2>&1 | tee "$LOG_DIR/${state,,}-${city// /-}.log"
      
      echo -e "\n${GREEN}✅ Completed: $city, $state${NC}\n"
      sleep 5
    done
    ;;
    
  2)
    read -p "Enter city number (1-${#CITIES[@]}): " CITY_NUM
    if [ "$CITY_NUM" -ge 1 ] && [ "$CITY_NUM" -le "${#CITIES[@]}" ]; then
      IFS='|' read -r city state limit <<< "${CITIES[$((CITY_NUM-1))]}"
      echo -e "\n${BLUE}Starting discovery for $city, $state...${NC}\n"
      cd "$BACKEND_DIR"
      node scripts/discover-us-companies.js "$city" "$state" "$limit"
    else
      echo "Invalid city number"
      exit 1
    fi
    ;;
    
  3)
    echo -e "\n${BLUE}Starting discovery for top 5 cities...${NC}\n"
    for i in {0..4}; do
      IFS='|' read -r city state limit <<< "${CITIES[$i]}"
      echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      echo -e "${GREEN}Starting: $city, $state (target: $limit)${NC}"
      echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      
      cd "$BACKEND_DIR"
      node scripts/discover-us-companies.js "$city" "$state" "$limit" 2>&1 | tee "$LOG_DIR/${state,,}-${city// /-}.log"
      
      echo -e "\n${GREEN}✅ Completed: $city, $state${NC}\n"
      sleep 5
    done
    ;;
    
  *)
    echo "Invalid option"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  DISCOVERY COMPLETE!                                          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Check database:"
echo "  docker exec -i data-bunker-db psql -U postgres -d databunker -c 'SELECT jurisdiction, COUNT(*) FROM companies GROUP BY jurisdiction;'"
echo ""
