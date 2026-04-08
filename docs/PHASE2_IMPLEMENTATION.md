# Phase 2 Implementation Guide - PostgreSQL & Contact Aggregation

## 📋 Overview

This guide walks through implementing the enterprise database features for Data-Bunker. It covers PostgreSQL setup, contact aggregation, automatic company discovery, and data export functionality.

## 🚀 Phase 2A: Database Setup (Week 1)

### Step 1: PostgreSQL Installation

**On Linux/WSL:**
```bash
# Update package manager
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# Start PostgreSQL service
sudo service postgresql start

# Connect to PostgreSQL
sudo -u postgres psql
```

**Create database and user:**
```sql
-- As postgres user in psql:
CREATE DATABASE data_bunker;
CREATE USER app_user WITH PASSWORD 'secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE data_bunker TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;
\q
```

### Step 2: Run Database Migrations

```bash
cd /workspaces/Data-Bunker/backend

# Update .env with PostgreSQL credentials
export DB_HOST=localhost
export DB_USER=app_user
export DB_PASSWORD=your_password
export DB_NAME=data_bunker

# Create tables and schema
psql -U app_user -d data_bunker -f migrations/001_initial_schema.sql
```

### Step 3: Update Backend Dependencies

```bash
cd /workspaces/Data-Bunker/backend

# Add PostgreSQL client library
npm install pg

# Add validation library
npm install joi

# Add job scheduling
npm install node-cron

# Add Excel export
npm install xlsx

# Add CSV export
npm install csv-writer
```

### Step 4: Update Server Configuration

**Update `/backend/server.js`:**

```javascript
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { checkConnection, initializeDatabase } = require('./src/db/connection');

dotenv.config();

const app = express();

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));

// Database initialization
async function startServer() {
  try {
    // Check database connection
    const connected = await checkConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }

    // Initialize schema (runs migrations)
    await initializeDatabase();

    // Import routes
    const companiesRoutes = require('./src/routes/companies');
    const locationsRoutes = require('./src/routes/locations');
    const contactsRoutes = require('./src/routes/contacts');
    const searchRoutes = require('./src/routes/search');

    // Use routes
    app.use('/api/companies', companiesRoutes);
    app.use('/api/locations', locationsRoutes);
    app.use('/api/contacts', contactsRoutes);
    app.use('/api/search', searchRoutes);

    // Health check endpoint
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date() });
    });

    // Start server
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
```

## 🤝 Phase 2B: Contact Integration (Week 2)

### Step 1: Create Contact Routes

**Create `/backend/src/routes/contacts.js`:**

```javascript
const express = require('express');
const ContactService = require('../services/contactService');
const CompanyService = require('../services/companyService');
const validateInput = require('../utils/validators');

const router = express.Router();

// Get all contacts for a company
router.get('/company/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const contacts = await ContactService.getContactsByCompanyId(companyId);
    res.json(contacts);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get primary contact for company
router.get('/company/:companyId/primary', async (req, res) => {
  try {
    const { companyId } = req.params;
    const contact = await ContactService.getPrimaryContact(companyId);
    res.json(contact || { message: 'No primary contact found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new contact
router.post('/', async (req, res) => {
  try {
    const validation = validateInput.validateContact(req.body);
    if (!validation.valid) {
      return res.status(400).json({ errors: validation.errors });
    }

    const contact = await ContactService.createContact(req.body);
    res.status(201).json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update contact
router.put('/:id', async (req, res) => {
  try {
    const contact = await ContactService.updateContact(req.params.id, req.body);
    res.json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Find contact by email
router.get('/email/:email', async (req, res) => {
  try {
    const contacts = await ContactService.findByEmail(req.params.email);
    res.json(contacts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set primary contact
router.post('/:id/set-primary', async (req, res) => {
  try {
    const { companyId } = req.body;
    const contact = await ContactService.setPrimaryContact(companyId, req.params.id);
    res.json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

### Step 2: Create Clearbit Integration Service

**Create `/backend/src/services/clearbitService.js`:**

```javascript
const axios = require('axios');
const ContactService = require('./contactService');
const { query } = require('../db/connection');

class ClearbitService {
  static async enrichCompany(companyId, companyDomain) {
    try {
      if (!process.env.CLEARBIT_API_KEY) {
        console.warn('❌ Clearbit API key not configured');
        return null;
      }

      const apiUrl = 'https://company-stream.clearbit.com/v2/companies/find';
      
      const response = await axios.get(apiUrl, {
        params: { domain: companyDomain },
        headers: {
          'Authorization': `Bearer ${process.env.CLEARBIT_API_KEY}`,
        },
      });

      const data = response.data;

      // Extract and store contacts
      if (data.people && Array.isArray(data.people)) {
        for (const person of data.people) {
          // Check if contact already exists
          const exists = await ContactService.emailExists(companyId, person.email);
          
          if (!exists && person.email) {
            await ContactService.createContact({
              companyId,
              email: person.email,
              contactName: person.name,
              jobTitle: person.title,
              linkedinProfileUrl: person.linkedin?.handle ? `https://linkedin.com/in/${person.linkedin.handle}` : null,
              source: 'clearbit',
              confidenceScore: person.confidence || 0.8,
            });
          }
        }
      }

      return data;
    } catch (error) {
      console.error('Clearbit enrichment error:', error.message);
      return null;
    }
  }

  static async enrichContact(email) {
    try {
      if (!process.env.CLEARBIT_API_KEY) return null;

      const apiUrl = 'https://person-stream.clearbit.com/v2/people/find';
      
      const response = await axios.get(apiUrl, {
        params: { email },
        headers: {
          'Authorization': `Bearer ${process.env.CLEARBIT_API_KEY}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Clearbit contact enrichment error:', error.message);
      return null;
    }
  }
}

module.exports = ClearbitService;
```

## 🔍 Phase 2C: Automatic Discovery System (Week 3)

### Step 1: Create Discovery Job Scheduler

**Create `/backend/src/jobs/companyDiscoveryJob.js`:**

```javascript
const cron = require('node-cron');
const OpenCorporatesService = require('../services/openCorporates');
const CompanyService = require('../services/companyService');
const LocationService = require('../services/locationService');
const { query } = require('../db/connection');

class CompanyDiscoveryJob {
  static start() {
    console.log('🚀 Starting company discovery job...');
    
    // Run daily at 2 AM
    cron.schedule('0 2 * * *', async () => {
      try {
        console.log('[Job] Starting daily company discovery...');
        await this.runDiscovery();
      } catch (error) {
        console.error('[Job] Discovery job failed:', error);
      }
    });
  }

  static async runDiscovery() {
    const startTime = Date.now();
    let discovered = 0;
    let failed = 0;

    try {
      // Get list of countries to search
      const countries = await LocationService.getAllCountries();

      for (const country of countries) {
        try {
          // Fetch recent companies from OpenCorporates
          const companies = await OpenCorporatesService.getRecentCompanies(
            country.code,
            30 // Last 30 days
          );

          for (const companyData of companies) {
            try {
              // Check if company already exists
              const exists = await query(
                `SELECT id FROM companies 
                 WHERE country_id = $1 AND registration_number = $2`,
                [country.id, companyData.registration_number]
              );

              if (exists.rows.length === 0) {
                // Add new company
                await CompanyService.createCompany({
                  registrationNumber: companyData.registration_number,
                  name: companyData.name,
                  countryId: country.id,
                  status: 'active',
                  primaryDataSource: 'opencorporates',
                });
                discovered++;
              }
            } catch (error) {
              console.error(`Failed to process company: ${error.message}`);
              failed++;
            }
          }
        } catch (error) {
          console.error(`Failed to discover companies in ${country.code}: ${error.message}`);
        }
      }

      const duration = Date.now() - startTime;
      console.log(
        `[Job] Discovery complete: ${discovered} new companies, ${failed} errors in ${duration}ms`
      );

      // Log operation
      await query(
        `INSERT INTO update_log (
          operation_type, entity_type, data_source, status, 
          records_succeeded, records_failed, execution_time_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          'scrape', 'company', 'opencorporates',
          failed === 0 ? 'success' : 'partial',
          discovered, failed, duration
        ]
      );
    } catch (error) {
      console.error('Discovery job error:', error);
      
      // Log failure
      await query(
        `INSERT INTO update_log (
          operation_type, entity_type, data_source, status, error_message
        ) VALUES ($1, $2, $3, $4, $5)`,
        ['scrape', 'company', 'opencorporates', 'failed', error.message]
      );
    }
  }
}

module.exports = CompanyDiscoveryJob;
```

## 📊 Phase 2D: Export Functionality (Week 3-4)

### Step 1: Create Export Service

**Create `/backend/src/services/exportService.js`:**

```javascript
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { createObjectCsvWriter } = require('csv-writer');
const { query } = require('../db/connection');

class ExportService {
  /**
   * Export companies to CSV
   */
  static async exportToCSV(filters = {}, filename = null) {
    try {
      // Get filtered companies
      const companies = await this.getFilteredCompanies(filters);
      
      if (companies.length === 0) {
        throw new Error('No companies matching filters');
      }

      filename = filename || `companies_${Date.now()}.csv`;
      const filepath = path.join(process.env.EXPORT_TEMP_DIR || './exports', filename);

      // Ensure directory exists
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const csvWriter = createObjectCsvWriter({
        path: filepath,
        header: [
          { id: 'id', title: 'Company ID' },
          { id: 'name', title: 'Company Name' },
          { id: 'registration_number', title: 'Registration Number' },
          { id: 'status', title: 'Status' },
          { id: 'industry', title: 'Industry' },
          { id: 'country_name', title: 'Country' },
          { id: 'state_name', title: 'State' },
          { id: 'city_name', title: 'City' },
          { id: 'website', title: 'Website' },
          { id: 'employee_count', title: 'Employees' },
          { id: 'created_date', title: 'Created Date' },
        ],
      });

      await csvWriter.writeRecords(companies);

      return {
        success: true,
        filename,
        filepath,
        recordCount: companies.length,
      };
    } catch (error) {
      console.error('CSV export error:', error);
      throw error;
    }
  }

  /**
   * Export companies to Excel
   */
  static async exportToExcel(filters = {}, filename = null) {
    try {
      const companies = await this.getFilteredCompanies(filters);
      
      if (companies.length === 0) {
        throw new Error('No companies matching filters');
      }

      filename = filename || `companies_${Date.now()}.xlsx`;
      const filepath = path.join(process.env.EXPORT_TEMP_DIR || './exports', filename);

      // Create workbook
      const workbook = xlsx.utils.book_new();
      
      // Add companies sheet
      const companiesSheet = xlsx.utils.json_to_sheet(companies);
      xlsx.utils.book_append_sheet(workbook, companiesSheet, 'Companies');

      // Add summary sheet
      const summary = {
        'Total Companies': companies.length,
        'Export Date': new Date().toISOString(),
        'Filters Applied': JSON.stringify(filters),
      };
      const summarySheet = xlsx.utils.json_to_sheet([summary]);
      xlsx.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      // Write file
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      xlsx.writeFile(workbook, filepath);

      return {
        success: true,
        filename,
        filepath,
        recordCount: companies.length,
      };
    } catch (error) {
      console.error('Excel export error:', error);
      throw error;
    }
  }

  /**
   * Get filtered companies for export
   */
  static async getFilteredCompanies(filters) {
    const {
      countryId = null,
      industry = null,
      status = null,
      limit = 10000,
    } = filters;

    let sql = `
      SELECT c.id, c.name, c.registration_number, c.status, c.industry,
             c.website, c.employee_count, c.created_date,
             co.name as country_name, s.name as state_name, ci.name as city_name
      FROM companies c
      JOIN countries co ON c.country_id = co.id
      LEFT JOIN states s ON c.state_id = s.id
      LEFT JOIN cities ci ON c.city_id = ci.id
      WHERE 1=1
    `;

    const params = [];

    if (countryId) {
      sql += ` AND c.country_id = $${params.length + 1}`;
      params.push(countryId);
    }

    if (industry) {
      sql += ` AND c.industry ILIKE $${params.length + 1}`;
      params.push(`%${industry}%`);
    }

    if (status) {
      sql += ` AND c.status = $${params.length + 1}`;
      params.push(status);
    }

    sql += ` LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    return result.rows;
  }
}

module.exports = ExportService;
```

## ✅ Implementation Checklist

- [ ] PostgreSQL installed and running
- [ ] Database created and user configured
- [ ] Migration script executed successfully
- [ ] Backend dependencies updated
- [ ] Database connection module tested
- [ ] Company service CRUD operations working
- [ ] Contact service endpoints created
- [ ] Clearbit integration configured and tested
- [ ] Discovery job scheduled and running
- [ ] Export to CSV working
- [ ] Export to Excel working
- [ ] Frontend updated with new features
- [ ] Error handling and logging verified
- [ ] Load testing performed

## 🔗 Next Steps

1. Update existing API routes to use new database
2. Migrate data from OpenCorporates API cache to PostgreSQL
3. Implement contact validation service
4. Create frontend pages for contact management
5. Add export functionality to frontend
6. Set up monitoring and alerts

