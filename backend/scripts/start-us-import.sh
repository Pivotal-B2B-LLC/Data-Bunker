#!/bin/bash
# Start US Company Import - Background Worker
# Imports companies from specified US states

echo "═══════════════════════════════════════════════════════════"
echo "           US COMPANY IMPORT SETUP"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check if OpenCorporates API key is set
if [ -z "$OPENCORPORATES_API_KEY" ]; then
  echo "❌ OPENCORPORATES_API_KEY not configured"
  echo ""
  echo "To import US companies, you need an OpenCorporates API key:"
  echo "  1. Sign up at: https://opencorporates.com/api_accounts/new"
  echo "  2. Add to .env file: OPENCORPORATES_API_KEY=your_key_here"
  echo ""
  echo "Pricing:"
  echo "  • Free: 500 requests/month"
  echo "  • Starter: \$30/month (10,000 requests)"
  echo "  • Business: \$300/month (100,000 requests)"
  echo ""
  exit 1
fi

echo "✓ OpenCorporates API key configured"
echo ""

# Parse arguments
STATES="${1:-ca,ny,tx}"
LIMIT="${2:-1000}"

echo "Configuration:"
echo "  States: $STATES"
echo "  Companies per state: $LIMIT"
echo ""

# Confirm
read -p "Start import? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Import cancelled"
  exit 0
fi

echo ""
echo "Starting import..."
echo ""

# Run import
cd "$(dirname "$0")/.."
node scripts/import-us-companies.js --states "$STATES" --limit "$LIMIT"

echo ""
echo "✅ Import complete!"
echo ""
echo "Next steps:"
echo "  1. Check imported companies: docker exec data-bunker-db psql -U postgres -d databunker -c \"SELECT COUNT(*), jurisdiction FROM companies WHERE jurisdiction LIKE 'us_%' GROUP BY jurisdiction;\""
echo "  2. Start enrichment workers to add website/email/phone data"
echo ""
