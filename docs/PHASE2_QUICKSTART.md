# Phase 2 Quick Start - PostgreSQL & Contact Management

## Prerequisites

- PostgreSQL 12+ installed and running
- Node.js 16+
- Existing Data-Bunker installation from Phase 1

## Step-by-Step Setup (15 minutes)

### Step 1: Install PostgreSQL (if not already installed)

**Linux/WSL:**
```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL
sudo service postgresql start

# Verify installation
psql --version
```

**macOS (using Homebrew):**
```bash
brew install postgresql

# Start PostgreSQL
brew services start postgresql

# Verify
psql --version
```

**Windows:**
Download and install from https://www.postgresql.org/download/windows/

### Step 2: Create Database and User

```bash
# Login to PostgreSQL
sudo -u postgres psql

# In the psql prompt, run:
CREATE DATABASE data_bunker;
CREATE USER app_user WITH PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE data_bunker TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;
\q
```

### Step 3: Initialize Database Schema

```bash
cd /workspaces/Data-Bunker/backend

# Run migration script
PGPASSWORD='your_secure_password_here' psql \
  -U app_user \
  -d data_bunker \
  -h localhost \
  -f migrations/001_initial_schema.sql

# Verify tables were created
PGPASSWORD='your_secure_password_here' psql \
  -U app_user \
  -d data_bunker \
  -h localhost \
  -c "\dt"
```

Expected output should show tables like:
```
countries, states, cities, districts, companies, contacts, etc.
```

### Step 4: Update Backend Dependencies

```bash
cd /workspaces/Data-Bunker/backend

# Install new packages
npm install pg node-cron xlsx csv-writer dotenv joi express-rate-limit

# Verify installation
npm list pg node-cron xlsx
```

### Step 5: Configure Environment Variables

```bash
# Copy the environment template
cp .env.database .env

# Edit with your settings
nano .env
```

Update these key values:
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=app_user
DB_PASSWORD=your_secure_password_here
DB_NAME=data_bunker

# API Keys (optional)
COMPANIES_HOUSE_API_KEY=your_key
OPENCORPORATES_API_KEY=your_key
CLEARBIT_API_KEY=your_key
```

### Step 6: Update Server Entry Point

Update `/backend/server.js` to initialize database:

```javascript
const express = require('express');
const { checkConnection } = require('./src/db/connection');

const app = express();

app.use(express.json());

// Initialize on startup
checkConnection().then(() => {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
```

### Step 7: Test Database Connection

```bash
cd /workspaces/Data-Bunker/backend

# Start the server
npm start
```

You should see:
```
✓ Database connection verified
🚀 Server running on http://localhost:5000
```

## Verification

### Test Database Connection

```bash
# Create a test file
cat > test-db.js << 'EOF'
const { query } = require('./src/db/connection');

async function test() {
  try {
    const result = await query('SELECT COUNT(*) as count FROM countries');
    console.log('✓ Database connected. Countries:', result.rows[0].count);
  } catch (error) {
    console.error('❌ Database error:', error.message);
  }
}

test();
EOF

# Run the test
node test-db.js

# Clean up
rm test-db.js
```

### Test API Endpoints

```bash
# Get countries
curl -X GET http://localhost:5000/api/locations/countries

# Create a company (example)
curl -X POST http://localhost:5000/api/companies \
  -H "Content-Type: application/json" \
  -d '{
    "registrationNumber": "00000001",
    "name": "Test Company",
    "countryId": 1,
    "industry": "Technology"
  }'
```

## Troubleshooting

### Issue: "Connection refused"

**Solution:** PostgreSQL is not running
```bash
# Start PostgreSQL
sudo service postgresql start

# Or on macOS
brew services start postgresql
```

### Issue: "Invalid username/password"

**Solution:** Check credentials in `.env`
```bash
# Test directly
psql -U app_user -d data_bunker -h localhost
```

### Issue: "Database does not exist"

**Solution:** Create the database
```bash
sudo -u postgres psql -c "CREATE DATABASE data_bunker;"
sudo -u postgres psql -d data_bunker -f migrations/001_initial_schema.sql
```

### Issue: "Permission denied"

**Solution:** Set user permissions
```bash
sudo -u postgres psql << EOF
GRANT ALL PRIVILEGES ON DATABASE data_bunker TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
EOF
```

## Next Steps

1. **Populate Initial Data**
   ```bash
   npm run seed:locations
   ```

2. **Import Companies** (from existing APIs)
   ```bash
   npm run import:opencorporates
   ```

3. **Set up Contact Enrichment**
   - Configure Clearbit API key in .env
   - Run: `npm run enrich:contacts`

4. **Enable Automatic Discovery**
   - Add to startup: `CompanyDiscoveryJob.start()`

5. **Test Export Features**
   ```bash
   curl -X POST http://localhost:5000/api/export/csv \
     -H "Content-Type: application/json" \
     -d '{"countryId": 1}'
   ```

## Summary

✅ PostgreSQL installed and running
✅ Database created and configured
✅ Schema initialized with all tables
✅ Backend connected to database
✅ API endpoints ready for data operations

You're now ready to:
- Add companies to the database
- Manage contact information
- Run automatic discovery jobs
- Export data to CSV/Excel

For more details, see [PHASE2_IMPLEMENTATION.md](PHASE2_IMPLEMENTATION.md)
