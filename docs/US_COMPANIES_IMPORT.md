# US Company Data Collection

Comprehensive guide to importing and enriching US company data by state.

## Overview

This system allows you to:
- **Import companies from specific US states** (California, New York, Texas, etc.)
- **Automatically enrich** with website, email, phone data
- **Background workers** continuously discover and enrich new companies
- **Similar to UK Companies House** but for all 50 US states

## Quick Start

### 1. Get OpenCorporates API Key

US company data comes from OpenCorporates API:

```bash
# Sign up at: https://opencorporates.com/api_accounts/new
# Add to .env file:
OPENCORPORATES_API_KEY=your_key_here
```

**Pricing:**
- Free: 500 requests/month (good for testing)
- Starter: $30/month → 10,000 requests (~1,000 companies)
- Business: $300/month → 100,000 requests (~10,000 companies)

### 2. Import Companies by State

#### Import from specific states:
```bash
# California, New York, Texas (default)
cd backend
node scripts/import-us-companies.js --states ca,ny,tx

# Florida and Illinois
node scripts/import-us-companies.js --states fl,il --limit 2000

# Top 10 most populous states
node scripts/import-us-companies.js --top10

# All 50 states (requires business plan)
node scripts/import-us-companies.js --all --limit 500
```

#### Using the shell script (interactive):
```bash
cd backend/scripts
./start-us-import.sh ca,ny,tx 1000
```

### 3. Enrich with Website/Email/Phone

After importing, the existing enrichment workers will automatically:
- Discover company websites
- Extract email addresses (prioritizing personal emails)
- Find phone numbers (formatted with US country code)

```bash
# Workers are already running and will process US companies automatically
# Check progress:
curl http://localhost:5000/api/enrichment/stats
```

## State Codes Reference

| Code | State | Code | State | Code | State |
|------|-------|------|-------|------|-------|
| **ca** | California | **ny** | New York | **tx** | Texas |
| **fl** | Florida | **il** | Illinois | **pa** | Pennsylvania |
| **oh** | Ohio | **ga** | Georgia | **nc** | North Carolina |
| **mi** | Michigan | **nj** | New Jersey | **va** | Virginia |
| **wa** | Washington | **az** | Arizona | **ma** | Massachusetts |
| **tn** | Tennessee | **in** | Indiana | **mo** | Missouri |
| **md** | Maryland | **wi** | Wisconsin | **co** | Colorado |
| **mn** | Minnesota | **sc** | South Carolina | **al** | Alabama |
| **la** | Louisiana | **ky** | Kentucky | **or** | Oregon |
| **ok** | Oklahoma | **ct** | Connecticut | **ut** | Utah |
| **ia** | Iowa | **nv** | Nevada | **ar** | Arkansas |
| **ms** | Mississippi | **ks** | Kansas | **nm** | New Mexico |
| **ne** | Nebraska | **wv** | West Virginia | **id** | Idaho |
| **hi** | Hawaii | **nh** | New Hampshire | **me** | Maine |
| **mt** | Montana | **ri** | Rhode Island | **de** | Delaware |
| **sd** | South Dakota | **nd** | North Dakota | **ak** | Alaska |
| **vt** | Vermont | **wy** | Wyoming | | |

## Usage Examples

### Example 1: California Tech Companies
```bash
# Import 5,000 California companies
node scripts/import-us-companies.js --states ca --limit 5000

# Check results
docker exec data-bunker-db psql -U postgres -d databunker \
  -c "SELECT COUNT(*), status FROM companies WHERE jurisdiction = 'us_ca' GROUP BY status;"
```

### Example 2: Multi-State Import
```bash
# Import from West Coast states
node scripts/import-us-companies.js --states ca,wa,or --limit 2000

# Import from Northeast
node scripts/import-us-companies.js --states ny,ma,pa,nj --limit 1500
```

### Example 3: Nationwide Coverage
```bash
# Import 500 companies from each state (business plan required)
node scripts/import-us-companies.js --all --limit 500

# This will import ~25,000 companies across all 50 states
```

## Data Structure

Companies are stored with:
- `company_number` - State registration number
- `name` - Company name
- `jurisdiction` - State code (e.g., 'us_ca', 'us_ny')
- `company_type` - Business entity type
- `status` - Active, Dissolved, etc.
- `incorporation_date` - When company was formed
- `address_line_1, locality, region, postal_code` - Full address
- `country` - 'United States'
- `website, email, phone` - Enriched data (added by workers)

## Monitoring Progress

### Check import status:
```bash
# Total US companies by state
docker exec data-bunker-db psql -U postgres -d databunker \
  -c "SELECT jurisdiction, COUNT(*) FROM companies WHERE jurisdiction LIKE 'us_%' GROUP BY jurisdiction ORDER BY COUNT(*) DESC;"

# Enrichment progress
curl http://localhost:5000/api/enrichment/stats
```

### Check enrichment for US companies:
```bash
# Companies with websites
docker exec data-bunker-db psql -U postgres -d databunker \
  -c "SELECT COUNT(*) FROM companies WHERE jurisdiction LIKE 'us_%' AND website IS NOT NULL;"

# Companies with emails
docker exec data-bunker-db psql -U postgres -d databunker \
  -c "SELECT COUNT(*) FROM companies WHERE jurisdiction LIKE 'us_%' AND email IS NOT NULL;"
```

## Rate Limits & Best Practices

### OpenCorporates API Limits:
- **Free tier**: 500 requests/month (100 companies)
- **Starter plan**: 10,000 requests/month (~1,000 companies)
- **Business plan**: 100,000 requests/month (~10,000 companies)

### Recommendations:
1. **Start small**: Test with 1-2 states first
2. **Choose strategic states**: California (tech), New York (finance), Texas (energy)
3. **Monitor usage**: Track API calls to avoid overage
4. **Batch imports**: Spread imports over time to stay within limits

### Rate Limit Handling:
The import script automatically:
- Waits 1 second between requests
- Handles 429 rate limit errors (waits 60s)
- Retries failed requests
- Shows progress in real-time

## Advanced Configuration

### Custom Import Script:
```javascript
const USCompanyImporter = require('./scripts/import-us-companies');

const importer = new USCompanyImporter(['ca', 'ny'], {
  companiesPerState: 2000,
  batchSize: 100,
  maxPages: 20,
  delay: 1000 // ms between requests
});

await importer.run();
```

### Filter by Company Type:
Modify the import script to filter specific entity types:
- Corporation
- LLC
- Non-Profit
- Partnership

### State-Specific Queries:
```sql
-- Find tech companies in California
SELECT name, address_line_1, website 
FROM companies 
WHERE jurisdiction = 'us_ca' 
  AND (industry ILIKE '%tech%' OR industry ILIKE '%software%')
  AND website IS NOT NULL
LIMIT 100;

-- Active companies in New York with emails
SELECT name, email, incorporation_date
FROM companies
WHERE jurisdiction = 'us_ny'
  AND status = 'Active'
  AND email IS NOT NULL
ORDER BY incorporation_date DESC
LIMIT 100;
```

## Comparison: UK vs US Data

| Feature | UK (Companies House) | US (OpenCorporates) |
|---------|---------------------|---------------------|
| **API Cost** | Free | $30-300/month |
| **Coverage** | All UK companies | All 50 US states |
| **Data Quality** | Official registry | Aggregated from states |
| **Officers/Directors** | ✅ Included | ❌ Not included |
| **Rate Limits** | 600/5min | Varies by plan |
| **Real-time Updates** | Yes | Yes |
| **Bulk Download** | Yes (large files) | API only |

## Troubleshooting

### "API key not configured"
```bash
# Add to .env file:
echo "OPENCORPORATES_API_KEY=your_key_here" >> .env
# Restart backend
```

### "Rate limit exceeded"
- Upgrade to higher OpenCorporates plan
- Reduce `--limit` parameter
- Spread imports over multiple days

### "No companies found"
- Check state code is valid (lowercase, 2 letters)
- Some states have less data available
- Try different search parameters

## Next Steps

After importing US companies:

1. **View in UI**: Search for companies at http://localhost:3000
2. **Monitor enrichment**: Workers automatically add website/email/phone
3. **Export data**: Use API or direct database queries
4. **Add more states**: Run import script for additional states
5. **Schedule regular imports**: Set up cron job for weekly updates

## Support

- **OpenCorporates Docs**: https://api.opencorporates.com/documentation/API-Reference
- **State Business Registries**: Each state has official registry (varies by state)
- **Data Quality**: OpenCorporates aggregates from official state sources

---

**Pro Tip**: Start with California (ca), New York (ny), and Texas (tx) - these three states contain a large percentage of US businesses and provide excellent coverage for most use cases.
