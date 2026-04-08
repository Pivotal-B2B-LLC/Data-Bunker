#!/bin/bash

# Import Officers for UK Companies
# This script fetches and imports officer data from Companies House API
# for all companies in the database

set -e

echo "============================================"
echo "UK Company Officers Import Script"
echo "============================================"
echo ""

# Configuration
BATCH_SIZE=${BATCH_SIZE:-100}
MAX_COMPANIES=${MAX_COMPANIES:-0}  # 0 = all companies
RATE_LIMIT_DELAY=${RATE_LIMIT_DELAY:-0.1}  # seconds between requests

# Database connection
DB_CONTAINER="databunker-db"
DB_USER=$(docker exec $DB_CONTAINER printenv POSTGRES_USER)
DB_NAME="databunker"

echo "📊 Configuration:"
echo "   Batch size: $BATCH_SIZE"
echo "   Max companies: ${MAX_COMPANIES:-All}"
echo "   Rate limit delay: ${RATE_LIMIT_DELAY}s"
echo ""

# Check if database is running
if ! docker ps | grep -q $DB_CONTAINER; then
    echo "❌ Database container is not running"
    exit 1
fi

# Check if API key is set
if [ -z "$COMPANIES_HOUSE_API_KEY" ]; then
    echo "❌ COMPANIES_HOUSE_API_KEY environment variable is not set"
    echo "   Export your API key: export COMPANIES_HOUSE_API_KEY=your_key_here"
    exit 1
fi

echo "✅ Database is running"
echo "✅ API key is configured"
echo ""

# Apply officers schema migration
echo "📋 Applying officers database schema..."
docker exec -i $DB_CONTAINER psql -U $DB_USER -d $DB_NAME < migrations/002_officers_schema.sql 2>&1 | grep -v "already exists" || true
echo "✅ Schema applied"
echo ""

# Get statistics
echo "📊 Current Statistics:"
TOTAL_COMPANIES=$(docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM companies;")
COMPANIES_WITH_OFFICERS=$(docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(DISTINCT company_id) FROM officer_appointments;")
COMPANIES_WITHOUT_OFFICERS=$(docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM companies c LEFT JOIN officer_appointments oa ON c.id = oa.company_id WHERE oa.id IS NULL;")

echo "   Total companies: $TOTAL_COMPANIES"
echo "   Companies with officers: $COMPANIES_WITH_OFFICERS"
echo "   Companies without officers: $COMPANIES_WITHOUT_OFFICERS"
echo ""

if [ "$COMPANIES_WITHOUT_OFFICERS" -eq 0 ]; then
    echo "✅ All companies already have officers imported!"
    exit 0
fi

# Ask for confirmation
if [ -z "$AUTO_CONFIRM" ]; then
    echo "⚠️  This will fetch officer data from Companies House API"
    echo "   API rate limit: 600 requests per 5 minutes"
    echo "   Estimated time: $(echo "scale=1; $COMPANIES_WITHOUT_OFFICERS / 600 * 5" | bc) minutes"
    echo ""
    read -p "Continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        echo "Cancelled"
        exit 0
    fi
fi

echo ""
echo "🚀 Starting officer import..."
echo ""

# Start Node.js import process
cd /workspaces/Data-Bunker/backend

# Run the import
node -e "
const officerImportService = require('./src/services/officerImportService');
const db = require('./src/db/database');

async function runImport() {
  try {
    let offset = 0;
    const batchSize = $BATCH_SIZE;
    const maxCompanies = $MAX_COMPANIES;
    let totalProcessed = 0;
    let totalOfficers = 0;
    
    console.log('📥 Fetching companies without officers...');
    
    while (true) {
      // Get batch of companies
      const companies = await officerImportService.getCompaniesWithoutOfficers(batchSize, offset);
      
      if (companies.length === 0) {
        console.log('✅ No more companies to process');
        break;
      }
      
      console.log(\`\nProcessing batch: \${totalProcessed + 1} to \${totalProcessed + companies.length}\`);
      
      // Import officers for this batch
      const results = await officerImportService.batchImportOfficers(
        companies,
        (progress) => {
          process.stdout.write(\`\r   Progress: \${progress.processed}/\${companies.length} | Officers: \${progress.totalOfficers} | Failed: \${progress.failed}\`);
        }
      );
      
      console.log('');
      console.log(\`   ✅ Batch complete: \${results.successful} successful, \${results.failed} failed\`);
      console.log(\`   📊 Officers imported: \${results.totalOfficers}\`);
      
      if (results.errors.length > 0) {
        console.log(\`   ⚠️  \${results.errors.length} errors occurred\`);
        results.errors.slice(0, 5).forEach(err => {
          console.log(\`      - \${err.company}: \${err.error}\`);
        });
      }
      
      totalProcessed += companies.length;
      totalOfficers += results.totalOfficers;
      offset += batchSize;
      
      // Check if we've hit the max
      if (maxCompanies > 0 && totalProcessed >= maxCompanies) {
        console.log(\`\n⚠️  Reached maximum companies limit (\${maxCompanies})\`);
        break;
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('');
    console.log('============================================');
    console.log('📊 Final Statistics:');
    const stats = await officerImportService.getOfficerStats();
    console.log(\`   Total officers: \${stats.totalOfficers}\`);
    console.log(\`   Total appointments: \${stats.totalAppointments}\`);
    console.log(\`   Active appointments: \${stats.activeAppointments}\`);
    console.log(\`   Companies with officers: \${stats.companiesWithOfficers}\`);
    console.log(\`   Companies without officers: \${stats.companiesWithoutOfficers}\`);
    console.log('============================================');
    console.log('✅ Import complete!');
    
    await db.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during import:', error);
    await db.end();
    process.exit(1);
  }
}

runImport();
"

echo ""
echo "✅ Officer import process completed!"
