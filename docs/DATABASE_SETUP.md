# Database Setup Guide

## Overview

Data-Bunker now includes a PostgreSQL database for persistent storage, advanced search capabilities, and automated web tracking. The database stores company information, contacts, officers, and tracks web scraping activities.

## Features

✅ **Persistent Storage** - Save companies and search history  
✅ **Full-Text Search** - PostgreSQL tsvector with fuzzy matching  
✅ **Advanced Filters** - Location, industry, status, employee count  
✅ **Contact Management** - Multiple email/phone/social per company  
✅ **Web Tracking** - Automated discovery and updates  
✅ **Analytics** - Popular searches, tracking history, statistics  

## Quick Start

### 1. Install PostgreSQL

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

#### macOS
```bash
brew install postgresql
brew services start postgresql
```

#### Docker (Recommended)
```bash
docker run --name databunker-db \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_USER=databunker_user \
  -e POSTGRES_DB=databunker \
  -p 5432:5432 \
  -d postgres:15
```

### 2. Configure Environment Variables

Add to `backend/.env`:

```env
# Database Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=databunker
POSTGRES_USER=databunker_user
POSTGRES_PASSWORD=your_secure_password

# Tracking Service
AUTO_START_TRACKING=false
TRACKING_INTERVAL=3600000        # 1 hour in ms
TRACKING_BATCH_SIZE=50           # Companies per batch
TRACKING_MAX_AGE=30              # Days before company is stale
```

### 3. Initialize Database

```bash
cd backend
./scripts/init-db.sh
```

This script will:
- Create database user
- Create database
- Run schema (tables, indexes, triggers)
- Display connection details

### 4. Start Server

```bash
npm start
```

The server will:
- Test database connection
- Display connection status
- Optionally start tracking service

## Database Schema

### Tables

#### `companies`
Main company information with 25+ fields:
- Basic: name, company_number, jurisdiction
- Address: full address components
- Contact: website, phone, email
- Business: industry, employee_count, annual_revenue
- Metadata: data_source, last_updated
- Search: search_vector for full-text search

#### `officers`
Company directors and officers:
- name, role, appointed_date
- nationality, date_of_birth
- occupation, address

#### `contacts`
Multiple contact methods per company:
- contact_type: email, phone, social, website
- value, label, source
- verified flag

#### `tracking_history`
Web scraping activity logs:
- url, data_found
- status, error_message
- tracked_at timestamp

#### `search_logs`
User search analytics:
- search_query, filters
- results_count, user_session
- searched_at timestamp

### Indexes

- **Full-text search**: GIN index on `search_vector`
- **Fuzzy matching**: GIN index with `pg_trgm` on name
- **Location filters**: Indexes on country, region, locality
- **Performance**: Indexes on company_number, status, last_updated

### Views

**`companies_with_contacts`**: Joined view of companies with aggregated contacts for easier querying.

## API Endpoints

### Search Companies

```bash
GET /api/db/search?query=tech&country=UK&limit=50
```

**Filters:**
- `query` - Text search (name, description)
- `country` - Country filter
- `region` - Region/state filter
- `locality` - City filter
- `status` - Company status (active, dissolved)
- `industry` - Industry filter
- `jurisdiction` - Jurisdiction code
- `min_employees`, `max_employees` - Size filter
- `limit`, `offset` - Pagination

**Response:**
```json
{
  "companies": [...],
  "total": 1234,
  "limit": 50,
  "offset": 0
}
```

### Get Company Details

```bash
GET /api/db/companies/:companyNumber
```

Returns company with all contacts, officers, and tracking history.

### Add/Update Company

```bash
POST /api/db/companies
Content-Type: application/json

{
  "company_number": "12345678",
  "name": "Tech Corp Ltd",
  "jurisdiction": "gb",
  "country": "United Kingdom",
  "locality": "London",
  ...
}
```

### Discover Companies

Automatically find and add companies from a location:

```bash
POST /api/db/discover
Content-Type: application/json

{
  "country": "United Kingdom",
  "region": "Greater London",
  "locality": "London"
}
```

### Web Tracking

#### Start Tracking
```bash
POST /api/db/tracking/start
Content-Type: application/json

{
  "interval": 3600000,    # 1 hour
  "batchSize": 50,
  "maxAge": 30           # days
}
```

#### Stop Tracking
```bash
POST /api/db/tracking/stop
```

#### Check Status
```bash
GET /api/db/tracking/status
```

### Analytics

#### Database Statistics
```bash
GET /api/db/analytics/stats
```

Returns:
```json
{
  "totalCompanies": 5000,
  "totalContacts": 12000,
  "totalOfficers": 8000,
  "totalTrackings": 1500,
  "staleCompanies": 200
}
```

#### Popular Searches
```bash
GET /api/db/analytics/popular-searches?limit=10
```

## Web Tracking Service

### How It Works

1. **Scheduled Updates**: Runs at configured interval (default: 1 hour)
2. **Finds Stale Companies**: Selects companies not updated in X days
3. **Updates Each Company**:
   - Refreshes from official API (Companies House/OpenCorporates)
   - Enriches with Google Places (website, phone)
   - Scrapes website for emails/phones
   - Saves contacts and tracking logs
4. **Rate Limited**: 1 second delay between companies

### Manual Tracking

Track a specific company:

```javascript
const webTrackingService = require('./src/services/webTrackingService');
const company = await companyRepository.getCompanyByNumber('12345678');
await webTrackingService.updateCompanyData(company);
```

### Discovery

Discover new companies in a location:

```javascript
const count = await webTrackingService.discoverCompaniesInLocation(
  'United Kingdom',
  'Greater London',
  'London'
);
console.log(`Discovered ${count} companies`);
```

## Usage Examples

### Store Search Results

After API search, save to database:

```javascript
const searchResults = await companiesHouse.searchCompanies('tech');

for (const company of searchResults.companies) {
  await companyRepository.upsertCompany({
    company_number: company.company_number,
    name: company.name,
    jurisdiction: 'gb',
    ...company
  });
}
```

### Enrich with Contacts

```javascript
const company = await companyRepository.getCompanyByNumber('12345678');

await companyRepository.addContact(company.id, {
  contact_type: 'email',
  value: 'info@company.com',
  label: 'general',
  source: 'website',
  verified: true
});
```

### Search with Filters

```javascript
const results = await companyRepository.searchCompanies({
  query: 'software',
  country: 'United Kingdom',
  region: 'Greater London',
  status: 'active',
  min_employees: 10,
  max_employees: 100
}, 50, 0);

console.log(`Found ${results.total} companies`);
```

## Maintenance

### Backup Database

```bash
pg_dump -U databunker_user databunker > backup.sql
```

### Restore Database

```bash
psql -U databunker_user databunker < backup.sql
```

### Check Database Size

```sql
SELECT 
  pg_size_pretty(pg_database_size('databunker')) as database_size;
```

### Vacuum (Optimize)

```sql
VACUUM ANALYZE companies;
```

## Troubleshooting

### Connection Refused

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Check if port 5432 is open
sudo netstat -plnt | grep 5432
```

### Authentication Failed

Check `.env` credentials match database user:

```bash
psql -U databunker_user -d databunker
```

### Schema Not Created

Re-run initialization:

```bash
cd backend
./scripts/init-db.sh
```

### Tracking Not Working

Check logs:

```bash
# Server should show:
✅ Database connected successfully
🔍 Starting web tracking service...
```

Enable auto-start in `.env`:

```env
AUTO_START_TRACKING=true
```

## Performance Tips

1. **Indexes**: Already optimized with GIN indexes for search
2. **Batch Updates**: Track in batches (default 50)
3. **Rate Limiting**: Don't lower tracking interval too much
4. **Connection Pool**: Configured to max 20 connections
5. **Vacuum**: Run weekly for large datasets

## Security

- ✅ Use strong passwords
- ✅ Don't commit `.env` file
- ✅ Enable SSL in production
- ✅ Restrict database access by IP
- ✅ Regular backups
- ✅ Update PostgreSQL regularly

## Next Steps

1. ✅ Initialize database
2. ✅ Test API endpoints
3. ⬜ Add companies from search
4. ⬜ Start tracking service
5. ⬜ Build frontend dashboard
6. ⬜ Set up automated backups

For more help, see:
- [API Documentation](../docs/API_SOURCES.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Development Guide](../docs/DEVELOPMENT.md)
