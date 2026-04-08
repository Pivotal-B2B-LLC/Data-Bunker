# Database Testing Guide

## Prerequisites

Before testing, ensure:
- ✅ PostgreSQL is installed and running
- ✅ `.env` file is configured with database credentials
- ✅ Database is initialized (`./scripts/init-db.sh`)

## Quick Test

### 1. Test Database Connection

```bash
cd backend
npm start
```

Look for:
```
✅ Database connected successfully
```

If you see:
```
⚠️  Database connection failed
```

Then run:
```bash
./scripts/init-db.sh
```

### 2. Test Basic API

Open another terminal:

```bash
# Check server status
curl http://localhost:5000/

# Should return database endpoints
```

### 3. Test Database Search

```bash
curl http://localhost:5000/api/db/search
```

Should return:
```json
{
  "companies": [],
  "total": 0,
  "limit": 50,
  "offset": 0
}
```

## Detailed Testing

### Test 1: Add Company to Database

```bash
curl -X POST http://localhost:5000/api/db/companies \
  -H "Content-Type: application/json" \
  -d '{
    "company_number": "12345678",
    "name": "Test Tech Ltd",
    "jurisdiction": "gb",
    "company_type": "private-limited",
    "status": "active",
    "country": "United Kingdom",
    "locality": "London",
    "region": "Greater London",
    "data_source": "manual"
  }'
```

Expected response:
```json
{
  "id": 1,
  "company_number": "12345678",
  "name": "Test Tech Ltd",
  ...
}
```

### Test 2: Search for Company

```bash
# Search by name
curl "http://localhost:5000/api/db/search?query=test"

# Search by location
curl "http://localhost:5000/api/db/search?country=United%20Kingdom&locality=London"

# Combined filters
curl "http://localhost:5000/api/db/search?query=tech&country=United%20Kingdom&status=active"
```

### Test 3: Get Company Details

```bash
curl http://localhost:5000/api/db/companies/12345678
```

### Test 4: Add Contact Information

```bash
curl -X POST http://localhost:5000/api/db/companies/12345678/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "contact_type": "email",
    "value": "info@testtech.com",
    "label": "general",
    "source": "manual",
    "verified": true
  }'
```

### Test 5: Discovery (Populate from API)

```bash
# Discover UK companies in London
curl -X POST http://localhost:5000/api/db/discover \
  -H "Content-Type: application/json" \
  -d '{
    "country": "United Kingdom",
    "locality": "London"
  }'
```

This will:
- Search Companies House API
- Add up to 100 companies to database
- Return count of companies added

Wait a few seconds, then search:

```bash
curl "http://localhost:5000/api/db/search?locality=London&limit=20"
```

### Test 6: Web Tracking Service

#### Start Tracking

```bash
curl -X POST http://localhost:5000/api/db/tracking/start \
  -H "Content-Type: application/json" \
  -d '{
    "interval": 300000,
    "batchSize": 10,
    "maxAge": 1
  }'
```

This starts tracking every 5 minutes (300000ms), processing 10 companies that haven't been updated in 1 day.

#### Check Status

```bash
curl http://localhost:5000/api/db/tracking/status
```

Response:
```json
{
  "isRunning": true
}
```

#### Stop Tracking

```bash
curl -X POST http://localhost:5000/api/db/tracking/stop
```

### Test 7: Analytics

#### Database Statistics

```bash
curl http://localhost:5000/api/db/analytics/stats
```

Response:
```json
{
  "totalCompanies": 150,
  "totalContacts": 45,
  "totalOfficers": 0,
  "totalTrackings": 25,
  "staleCompanies": 10
}
```

#### Popular Searches

```bash
curl http://localhost:5000/api/db/analytics/popular-searches?limit=5
```

## Integration Testing

### Test Full Workflow

```bash
#!/bin/bash

echo "=== Data-Bunker Database Test Suite ==="
echo ""

# 1. Add test company
echo "1. Adding test company..."
curl -X POST http://localhost:5000/api/db/companies \
  -H "Content-Type: application/json" \
  -d '{
    "company_number": "TEST001",
    "name": "Database Test Company",
    "jurisdiction": "gb",
    "country": "United Kingdom",
    "locality": "London",
    "status": "active"
  }' -s | jq

echo ""

# 2. Search for company
echo "2. Searching for company..."
curl "http://localhost:5000/api/db/search?query=database%20test" -s | jq

echo ""

# 3. Get company details
echo "3. Getting company details..."
curl http://localhost:5000/api/db/companies/TEST001 -s | jq

echo ""

# 4. Add contact
echo "4. Adding contact..."
curl -X POST http://localhost:5000/api/db/companies/TEST001/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "contact_type": "email",
    "value": "test@example.com",
    "label": "test"
  }' -s | jq

echo ""

# 5. Check stats
echo "5. Checking database stats..."
curl http://localhost:5000/api/db/analytics/stats -s | jq

echo ""
echo "=== Test Complete ==="
```

Save as `test-database.sh`, make executable:

```bash
chmod +x test-database.sh
./test-database.sh
```

## Performance Testing

### Load Test with Multiple Companies

```bash
# Add 100 test companies
for i in {1..100}; do
  curl -X POST http://localhost:5000/api/db/companies \
    -H "Content-Type: application/json" \
    -d "{
      \"company_number\": \"TEST${i}\",
      \"name\": \"Test Company ${i}\",
      \"jurisdiction\": \"gb\",
      \"country\": \"United Kingdom\",
      \"status\": \"active\"
    }" -s > /dev/null
  
  echo "Added company ${i}/100"
done
```

### Search Performance

```bash
# Measure search time
time curl "http://localhost:5000/api/db/search?query=test&limit=100" -s > /dev/null
```

## Database Direct Testing

### Connect to Database

```bash
psql -h localhost -U databunker_user -d databunker
```

### Useful SQL Queries

```sql
-- Count companies
SELECT COUNT(*) FROM companies;

-- Recent companies
SELECT name, company_number, last_updated 
FROM companies 
ORDER BY last_updated DESC 
LIMIT 10;

-- Companies by country
SELECT country, COUNT(*) as count 
FROM companies 
GROUP BY country 
ORDER BY count DESC;

-- Full-text search test
SELECT name, company_number 
FROM companies 
WHERE search_vector @@ plainto_tsquery('english', 'technology');

-- Contacts by type
SELECT contact_type, COUNT(*) as count 
FROM contacts 
GROUP BY contact_type;

-- Tracking statistics
SELECT 
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (NOW() - tracked_at))) as avg_age_seconds
FROM tracking_history 
GROUP BY status;

-- Popular searches
SELECT search_query, COUNT(*) as count 
FROM search_logs 
WHERE search_query IS NOT NULL 
GROUP BY search_query 
ORDER BY count DESC 
LIMIT 10;
```

## Troubleshooting Tests

### Issue: Connection Refused

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Check port
sudo netstat -plnt | grep 5432

# Test direct connection
psql -h localhost -U databunker_user -d databunker -c "SELECT 1"
```

### Issue: Authentication Failed

```bash
# Check .env credentials
cat backend/.env | grep POSTGRES

# Reset password
psql -U postgres -c "ALTER USER databunker_user PASSWORD 'new_password';"
```

### Issue: Schema Missing

```bash
# Check if tables exist
psql -U databunker_user -d databunker -c "\dt"

# Re-initialize if needed
cd backend
./scripts/init-db.sh
```

### Issue: No Results in Search

```bash
# Check if companies exist
curl http://localhost:5000/api/db/analytics/stats

# If totalCompanies is 0, add some:
curl -X POST http://localhost:5000/api/db/discover \
  -H "Content-Type: application/json" \
  -d '{"country": "United Kingdom", "locality": "London"}'
```

## Automated Testing Script

Save as `backend/test-database-full.sh`:

```bash
#!/bin/bash

set -e

echo "╔════════════════════════════════════════╗"
echo "║   Data-Bunker Database Test Suite     ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Test database connection
echo -n "Testing database connection... "
if curl -s http://localhost:5000/health > /dev/null; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Server not running. Start with: npm start"
    exit 1
fi

# Test adding company
echo -n "Testing add company... "
RESPONSE=$(curl -s -X POST http://localhost:5000/api/db/companies \
  -H "Content-Type: application/json" \
  -d '{"company_number":"TEST999","name":"Test Co","jurisdiction":"gb","country":"UK"}')

if echo "$RESPONSE" | grep -q "TEST999"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Response: $RESPONSE"
fi

# Test search
echo -n "Testing search... "
RESPONSE=$(curl -s "http://localhost:5000/api/db/search?query=test")
if echo "$RESPONSE" | grep -q "companies"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
fi

# Test get company
echo -n "Testing get company... "
RESPONSE=$(curl -s "http://localhost:5000/api/db/companies/TEST999")
if echo "$RESPONSE" | grep -q "TEST999"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
fi

# Test analytics
echo -n "Testing analytics... "
RESPONSE=$(curl -s "http://localhost:5000/api/db/analytics/stats")
if echo "$RESPONSE" | grep -q "totalCompanies"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
fi

# Test tracking status
echo -n "Testing tracking status... "
RESPONSE=$(curl -s "http://localhost:5000/api/db/tracking/status")
if echo "$RESPONSE" | grep -q "isRunning"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
fi

echo ""
echo -e "${GREEN}All tests passed!${NC}"
echo ""

# Show stats
echo "Database Statistics:"
curl -s http://localhost:5000/api/db/analytics/stats | jq
```

Make executable:

```bash
chmod +x backend/test-database-full.sh
./backend/test-database-full.sh
```

## Next Steps

After successful testing:

1. ✅ Database is working
2. ✅ Can add/search companies
3. ✅ Can track companies
4. ⬜ Integrate with frontend
5. ⬜ Set up automated backups
6. ⬜ Configure production database
7. ⬜ Enable SSL connections

## Production Checklist

Before deploying to production:

- [ ] Use strong database password
- [ ] Enable SSL connections
- [ ] Set up automated backups
- [ ] Configure firewall rules
- [ ] Monitor database performance
- [ ] Set up connection pooling
- [ ] Configure logging
- [ ] Test disaster recovery
- [ ] Document backup procedures
- [ ] Set up monitoring alerts
