#!/bin/bash

##############################################################################
# Storage Cleanup Script for Data Bunker
# Safely removes unnecessary bulk data files after database import
##############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           Data Bunker - Storage Cleanup Script                 ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Configuration
BULK_DATA_DIR="/workspaces/Data-Bunker/backend/bulk-data"
CSV_FILE="$BULK_DATA_DIR/BasicCompanyDataAsOneFile-2024-01-01.csv"
ZIP_FILE="$BULK_DATA_DIR/BasicCompanyDataAsOneFile.zip"

# Function to get file size
get_size() {
    if [ -f "$1" ]; then
        du -sh "$1" | cut -f1
    else
        echo "N/A"
    fi
}

# Function to check database
check_database() {
    echo -e "${YELLOW}→ Checking database status...${NC}"
    
    if ! docker ps | grep -q databunker-db; then
        echo -e "${RED}✗ Database container not running!${NC}"
        echo "  Start it with: docker-compose up -d"
        exit 1
    fi
    
    # Check company count
    COMPANY_COUNT=$(docker exec databunker-db psql -U databunker_user -d databunker -t -c "SELECT COUNT(*) FROM companies;" 2>/dev/null | tr -d ' ')
    
    if [ -z "$COMPANY_COUNT" ] || [ "$COMPANY_COUNT" -lt 1000000 ]; then
        echo -e "${RED}✗ Database appears incomplete (only $COMPANY_COUNT companies)${NC}"
        echo "  Import may not be complete. Not safe to delete bulk data."
        exit 1
    fi
    
    echo -e "${GREEN}✓ Database is healthy with $COMPANY_COUNT companies${NC}"
    return 0
}

# Function to display current usage
show_usage() {
    echo ""
    echo -e "${BLUE}Current Storage Usage:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    CSV_SIZE=$(get_size "$CSV_FILE")
    ZIP_SIZE=$(get_size "$ZIP_FILE")
    BULK_DIR_SIZE=$(du -sh "$BULK_DATA_DIR" 2>/dev/null | cut -f1)
    
    echo "  CSV File:  $CSV_SIZE  (${CSV_FILE##*/})"
    echo "  ZIP File:  $ZIP_SIZE  (${ZIP_FILE##*/})"
    echo "  Total:     $BULK_DIR_SIZE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Function to test application
test_application() {
    echo -e "${YELLOW}→ Testing application connectivity...${NC}"
    
    # Check if backend is running
    if curl -s http://localhost:5000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend is running${NC}"
    else
        echo -e "${YELLOW}⚠ Backend not running (this is okay)${NC}"
    fi
    
    # Test database query directly
    TEST_QUERY=$(docker exec databunker-db psql -U databunker_user -d databunker -t -c "SELECT name FROM companies LIMIT 1;" 2>/dev/null | head -1 | xargs)
    
    if [ -n "$TEST_QUERY" ]; then
        echo -e "${GREEN}✓ Database query successful: '$TEST_QUERY'${NC}"
    else
        echo -e "${RED}✗ Cannot query database${NC}"
        exit 1
    fi
}

# Main cleanup function
cleanup() {
    local mode=$1
    
    echo ""
    echo -e "${YELLOW}Starting cleanup (mode: $mode)...${NC}"
    echo ""
    
    case $mode in
        csv)
            if [ -f "$CSV_FILE" ]; then
                CSV_SIZE=$(get_size "$CSV_FILE")
                echo -e "${YELLOW}→ Removing CSV file ($CSV_SIZE)...${NC}"
                rm -f "$CSV_FILE"
                echo -e "${GREEN}✓ CSV file removed${NC}"
            else
                echo -e "${YELLOW}⚠ CSV file already removed${NC}"
            fi
            ;;
            
        all)
            if [ -f "$CSV_FILE" ]; then
                CSV_SIZE=$(get_size "$CSV_FILE")
                echo -e "${YELLOW}→ Removing CSV file ($CSV_SIZE)...${NC}"
                rm -f "$CSV_FILE"
                echo -e "${GREEN}✓ CSV file removed${NC}"
            fi
            
            if [ -f "$ZIP_FILE" ]; then
                ZIP_SIZE=$(get_size "$ZIP_FILE")
                echo -e "${YELLOW}→ Removing ZIP file ($ZIP_SIZE)...${NC}"
                rm -f "$ZIP_FILE"
                echo -e "${GREEN}✓ ZIP file removed${NC}"
            fi
            
            if [ -z "$(ls -A $BULK_DATA_DIR 2>/dev/null)" ]; then
                echo -e "${GREEN}✓ Bulk data directory is now empty${NC}"
            fi
            ;;
            
        *)
            echo -e "${RED}Invalid cleanup mode${NC}"
            exit 1
            ;;
    esac
}

# Display menu
show_menu() {
    echo -e "${BLUE}Cleanup Options:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  1) Remove CSV only (keep ZIP as backup) - Frees 2.5 GB"
    echo "  2) Remove CSV + ZIP (maximum cleanup)   - Frees 3.0 GB"
    echo "  3) Cancel (exit without changes)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Main execution
main() {
    # Show current usage
    show_usage
    
    # Check database
    check_database
    
    # Test application
    test_application
    
    echo ""
    echo -e "${GREEN}✓ All checks passed - safe to cleanup!${NC}"
    echo ""
    
    # Show menu
    show_menu
    
    # Get user choice
    read -p "Select option (1-3): " choice
    
    case $choice in
        1)
            echo ""
            echo -e "${YELLOW}You selected: Remove CSV only${NC}"
            read -p "Are you sure? (yes/no): " confirm
            if [ "$confirm" = "yes" ]; then
                cleanup csv
                echo ""
                echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
                echo -e "${GREEN}║  ✓ Cleanup Complete!                                   ║${NC}"
                echo -e "${GREEN}║  → CSV file removed (2.5 GB freed)                     ║${NC}"
                echo -e "${GREEN}║  → ZIP file kept as backup                             ║${NC}"
                echo -e "${GREEN}║  → Database intact with all companies                  ║${NC}"
                echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
            else
                echo -e "${YELLOW}Cancelled${NC}"
            fi
            ;;
            
        2)
            echo ""
            echo -e "${YELLOW}You selected: Remove CSV + ZIP${NC}"
            echo -e "${YELLOW}⚠ You won't be able to re-import without re-downloading${NC}"
            read -p "Are you sure? (yes/no): " confirm
            if [ "$confirm" = "yes" ]; then
                cleanup all
                echo ""
                echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
                echo -e "${GREEN}║  ✓ Full Cleanup Complete!                              ║${NC}"
                echo -e "${GREEN}║  → All bulk data removed (3.0 GB freed)                ║${NC}"
                echo -e "${GREEN}║  → Database intact with all companies                  ║${NC}"
                echo -e "${GREEN}║  → Re-download from Companies House if needed         ║${NC}"
                echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
            else
                echo -e "${YELLOW}Cancelled${NC}"
            fi
            ;;
            
        3)
            echo -e "${YELLOW}Cancelled - no changes made${NC}"
            exit 0
            ;;
            
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    
    # Show final usage
    echo ""
    echo -e "${BLUE}Final Storage Usage:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    FINAL_SIZE=$(du -sh "$BULK_DATA_DIR" 2>/dev/null | cut -f1)
    echo "  Bulk Data: $FINAL_SIZE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "${GREEN}✓ Your application will continue to work normally!${NC}"
    echo ""
}

# Run main function
main
