# US Company Import - Quick Reference

## Setup (One-Time)

```bash
# 1. Get API key from OpenCorporates
# Visit: https://opencorporates.com/api_accounts/new

# 2. Add to .env file
echo "OPENCORPORATES_API_KEY=your_key_here" >> .env

# 3. Restart backend if running
docker-compose restart backend
```

## Import Commands

```bash
cd backend

# California only (1,000 companies)
node scripts/import-us-companies.js --states ca

# Multiple states
node scripts/import-us-companies.js --states ca,ny,tx,fl

# Specific limit
node scripts/import-us-companies.js --states ca --limit 5000

# Top 10 states
node scripts/import-us-companies.js --top10

# All 50 states (requires business plan)
node scripts/import-us-companies.js --all --limit 500
```

## Check Status

```bash
# View import status and enrichment progress
node scripts/check-us-status.js

# Query database directly
docker exec data-bunker-db psql -U postgres -d databunker -c \
  "SELECT jurisdiction, COUNT(*) FROM companies WHERE jurisdiction LIKE 'us_%' GROUP BY jurisdiction;"
```

## Popular State Combinations

```bash
# West Coast
node scripts/import-us-companies.js --states ca,wa,or

# East Coast
node scripts/import-us-companies.js --states ny,ma,pa,nj,ct

# Tech Hubs
node scripts/import-us-companies.js --states ca,wa,tx,ny,ma

# South
node scripts/import-us-companies.js --states tx,fl,ga,nc,va

# Midwest
node scripts/import-us-companies.js --states il,oh,mi,in,wi
```

## API Pricing Guide

| Plan | Cost | Requests | Companies |
|------|------|----------|-----------|
| Free | $0 | 500/month | ~50 |
| Starter | $30/month | 10,000/month | ~1,000 |
| Business | $300/month | 100,000/month | ~10,000 |

**Note**: ~10 API requests per company (search + details + retries)

## What Happens After Import?

1. **Automatic Enrichment**: Your 40 workers immediately start enriching:
   - ✓ Website discovery
   - ✓ Email extraction (smart personal email priority)
   - ✓ Phone number finding

2. **View in UI**: Companies appear in search at http://localhost:3000

3. **Query Database**: All standard queries work with US companies

## State Codes (Most Common)

| Code | State | Code | State | Code | State |
|------|-------|------|-------|------|-------|
| ca | California | ny | New York | tx | Texas |
| fl | Florida | il | Illinois | pa | Pennsylvania |
| oh | Ohio | ga | Georgia | nc | North Carolina |
| mi | Michigan | nj | New Jersey | va | Virginia |
| wa | Washington | az | Arizona | ma | Massachusetts |
| co | Colorado | or | Oregon | mn | Minnesota |

**Full list of all 50 states in docs/US_COMPANIES_IMPORT.md**

## Troubleshooting

**"API key not configured"**
→ Add OPENCORPORATES_API_KEY to .env file

**"Rate limit exceeded"**
→ Reduce --limit or upgrade plan

**"No companies found"**
→ Check state code is lowercase (ca not CA)

## Next Steps

Read full documentation: `docs/US_COMPANIES_IMPORT.md`
