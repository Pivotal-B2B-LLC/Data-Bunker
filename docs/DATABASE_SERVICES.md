# Database Services Module Documentation

## Overview

This module provides a complete abstraction layer for database operations with PostgreSQL. All data access goes through these service classes, providing consistency, error handling, and audit logging.

## Services Architecture

```
API Routes
    ↓
Service Modules (CompanyService, ContactService, LocationService)
    ↓
Database Connection Pool
    ↓
PostgreSQL
```

## Services Included

### 1. Connection Module (`src/db/connection.js`)

Manages PostgreSQL connection pool and initialization.

**Configuration:**
```javascript
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  max: 20,
});
```

**Key Functions:**

| Function | Purpose | Usage |
|----------|---------|-------|
| `query(text, params)` | Execute single query | `await query('SELECT * FROM companies WHERE id = $1', [id])` |
| `transaction(callback)` | Execute multiple queries atomically | `await transaction(async (client) => {...})` |
| `initializeDatabase()` | Run all migration files | `await initializeDatabase()` |
| `checkConnection()` | Test connection health | `await checkConnection()` |
| `getDatabaseStats()` | Get pool statistics | `const stats = await getDatabaseStats()` |
| `closeConnection()` | Graceful shutdown | `await closeConnection()` |

**Usage Examples:**

```javascript
const { query, transaction } = require('../db/connection');

// Simple query
const result = await query(
  'SELECT * FROM companies WHERE status = $1',
  ['active']
);

// Transaction (automatic rollback on error)
const result = await transaction(async (client) => {
  const company = await client.query('INSERT INTO companies ...');
  const contact = await client.query('INSERT INTO contacts ...');
  return { company, contact };
});
```

### 2. Company Service (`src/services/companyService.js`)

All company-related database operations.

**Core Methods:**

#### `createCompany(data)`
Add a new company to the database.

```javascript
const company = await CompanyService.createCompany({
  registrationNumber: 'GB123456',
  name: 'Example Corp',
  countryId: 1,
  stateId: 5,
  cityId: 25,
  districtId: 100,
  industry: 'Technology',
  status: 'active',
  website: 'https://example.com',
  linkedinUrl: 'https://linkedin.com/company/example',
  primaryDataSource: 'manual',
});
```

**Returns:**
```javascript
{
  id: 1,
  name: 'Example Corp',
  registration_number: 'GB123456',
  status: 'active'
}
```

#### `getCompanyById(id)`
Fetch full company details including contacts and sources.

```javascript
const company = await CompanyService.getCompanyById(1);
// Returns: { ...company fields, contacts: [], sources: [] }
```

#### `searchCompanies(searchTerm, countryId, limit)`
Search companies by name or registration number.

```javascript
const results = await CompanyService.searchCompanies('Apple', 1, 50);
// Returns array of matching companies
```

#### `searchByLocation(filters)`
Find companies in specific geographic location.

```javascript
const results = await CompanyService.searchByLocation({
  countryId: 1,
  stateId: 5,
  cityId: 25,
  districtId: null,
  limit: 50
});
```

#### `advancedFilter(filters)`
Multi-criteria filtering of companies.

```javascript
const results = await CompanyService.advancedFilter({
  industry: 'Technology',
  status: 'active',
  createdAfter: '2024-01-01',
  minEmployees: 10,
  maxEmployees: 500,
  countryId: 1,
  limit: 100
});
```

#### `updateCompany(id, updates)`
Modify company data.

```javascript
const updated = await CompanyService.updateCompany(1, {
  industry: 'Finance',
  employee_count: 250,
  status: 'dormant'
});
```

#### Other Methods

```javascript
// Get companies by status
const active = await CompanyService.getCompaniesByStatus('active', 50);

// Get recently added companies
const recent = await CompanyService.getRecentCompanies(30, 50); // Last 30 days

// Get company count by status
const counts = await CompanyService.getCompanyCountByStatus();
// Returns: { active: 1000, inactive: 50, dissolved: 5 }

// Delete company and all related data
await CompanyService.deleteCompany(1);
```

### 3. Contact Service (`src/services/contactService.js`)

All contact-related database operations.

**Core Methods:**

#### `createContact(data)`
Add contact information for a company.

```javascript
const contact = await ContactService.createContact({
  companyId: 1,
  email: 'john@example.com',
  phone: '+44-20-7946-0958',
  linkedinProfileUrl: 'https://linkedin.com/in/johnsmith',
  contactName: 'John Smith',
  jobTitle: 'CEO',
  department: 'Executive',
  contactType: 'ceo',
  source: 'linkedin',
  confidenceScore: 0.95,
  isPrimary: true,
});
```

#### `getContactsByCompanyId(companyId)`
Get all contacts for a company with validation status.

```javascript
const contacts = await ContactService.getContactsByCompanyId(1);
```

#### `getPrimaryContact(companyId)`
Get the main contact for a company.

```javascript
const contact = await ContactService.getPrimaryContact(1);
```

#### `updateContact(id, updates)`
Modify contact information.

```javascript
const updated = await ContactService.updateContact(1, {
  phone: '+44-20-7946-0959',
  job_title: 'President'
});
```

#### `setPrimaryContact(companyId, contactId)`
Set which contact is primary (atomic operation).

```javascript
await ContactService.setPrimaryContact(1, 5);
```

#### Search Methods

```javascript
// Find by email
const contacts = await ContactService.findByEmail('john@example.com');

// Find by phone
const contacts = await ContactService.findByPhone('+44-20-7946-0958');

// Get verified contacts only
const verified = await ContactService.getVerifiedContacts(1);

// Get contacts by type
const ctos = await ContactService.getContactsByType(1, 'cto');

// Get contacts by source
const clearbitContacts = await ContactService.getContactsBySource(1, 'clearbit');

// Get contacts needing verification
const needsVerification = await ContactService.getContactsNeedingVerification(100);
```

#### Validation Methods

```javascript
// Validate email
await ContactService.validateEmail(contactId, true, 'hunter');

// Validate phone
await ContactService.validatePhone(contactId, true, 'twilio');

// Get validation summary
const summary = await ContactService.getContactsSummary(1);
// Returns: { total_contacts, verified_emails, verified_phones, linkedin_profiles, avg_confidence }
```

#### Existence Check

```javascript
// Check if email exists for company
const exists = await ContactService.emailExists(1, 'john@example.com');
if (!exists) {
  // Add the contact
}
```

### 4. Location Service (`src/services/locationService.js`)

Geographic hierarchy management.

**Core Methods:**

#### Fetch Methods

```javascript
// Get all countries
const countries = await LocationService.getAllCountries();

// Get country by ID or code
const uk = await LocationService.getCountry('GB');
const uk2 = await LocationService.getCountry(1);

// Get states for country
const states = await LocationService.getStatesByCountry(1);

// Get cities for state
const cities = await LocationService.getCitiesByState(5);

// Get districts for city
const districts = await LocationService.getDistrictsByCity(25);

// Get specific entities
const state = await LocationService.getState(5);
const city = await LocationService.getCity(25);
const district = await LocationService.getDistrict(100);
```

#### Add Methods

```javascript
// Add new country
const country = await LocationService.addCountry('NZ', 'New Zealand', 'Oceania');

// Add new state
const state = await LocationService.addState(1, 'CA', 'California');

// Add new city
const city = await LocationService.addCity(5, 'San Francisco', 37.7749, -122.4194);

// Add new district
const district = await LocationService.addDistrict(25, 'Downtown', '94105');
```

#### Hierarchy & Search

```javascript
// Get complete hierarchy for a country (tree structure)
const hierarchy = await LocationService.getCompleteHierarchy(1);
// Returns: { country, states: [{ name, cities: [{ name, districts }] }] }

// Search locations by name
const results = await LocationService.searchLocations('New York');

// Get location statistics
const stats = await LocationService.getLocationStatistics();
// Returns: { countries, states, cities, districts }

// Get company counts by location
const byCountry = await LocationService.getCompaniesByCountry();
const byState = await LocationService.getCompaniesByState(1);
const byCity = await LocationService.getCompaniesByCity(5);
```

## Database Views

Pre-built views for common queries:

```sql
-- Company with full location hierarchy
SELECT * FROM vw_companies_with_locations;

-- Contact summary per company
SELECT * FROM vw_company_contacts_summary;

-- Recent updates
SELECT * FROM vw_recent_updates;

-- Companies needing verification
SELECT * FROM vw_companies_needing_verification;
```

## Error Handling

All services throw descriptive errors:

```javascript
try {
  await CompanyService.createCompany(data);
} catch (error) {
  if (error.code === '23505') {
    // Unique constraint violation
    console.error('Company already exists');
  } else {
    console.error('Database error:', error.message);
  }
}
```

## Connection Management

### Connection Pool

Default pool size is 20 connections. Configure via:

```env
DB_POOL_SIZE=20
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=2000
```

### Graceful Shutdown

```javascript
process.on('SIGINT', async () => {
  await closeConnection();
  process.exit(0);
});
```

## Performance Tips

1. **Use Batch Operations** for multiple inserts
2. **Index Usage** - All commonly searched fields have indexes
3. **Connection Pooling** - Reuses connections automatically
4. **Query Timing** - All queries log execution time
5. **Transactions** - Use for multi-step operations

## Common Patterns

### Bulk Insert

```javascript
// Create 100 companies
const companies = [];
for (let i = 0; i < 100; i++) {
  const company = await CompanyService.createCompany({
    registrationNumber: `GB${String(i).padStart(6, '0')}`,
    name: `Company ${i}`,
    countryId: 1,
    // ...
  });
  companies.push(company);
}
```

### Conditional Creation

```javascript
// Only add if not exists
const exists = await ContactService.emailExists(companyId, email);
if (!exists) {
  await ContactService.createContact({
    companyId,
    email,
    // ...
  });
}
```

### Atomic Operations

```javascript
// Set primary contact atomically
await transaction(async (client) => {
  // Clear existing primary
  await client.query(
    'UPDATE contacts SET is_primary = false WHERE company_id = $1',
    [companyId]
  );
  
  // Set new primary
  await client.query(
    'UPDATE contacts SET is_primary = true WHERE id = $1',
    [contactId]
  );
});
```

## Testing

```javascript
// Test database connection
const connected = await checkConnection();
console.log(connected ? '✓ Connected' : '❌ Failed');

// Test operations
const company = await CompanyService.createCompany({...});
console.log(`Company created: ${company.id}`);

const contact = await ContactService.createContact({...});
console.log(`Contact created: ${contact.id}`);

// Verify data
const verified = await CompanyService.getCompanyById(company.id);
console.log(`Retrieved: ${verified.name}`);
```

## API Integration Example

```javascript
// In a route handler
router.get('/api/companies/:id', async (req, res) => {
  try {
    const company = await CompanyService.getCompanyById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    res.json(company);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

## Migration & Seeding

### Run Migrations

```javascript
const { initializeDatabase } = require('./src/db/connection');

await initializeDatabase();
console.log('Database initialized');
```

### Seed Initial Data

```javascript
const LocationService = require('./src/services/locationService');

// Add countries
await LocationService.addCountry('GB', 'United Kingdom');
await LocationService.addCountry('US', 'United States');

// Add states
await LocationService.addState(1, 'ENG', 'England');
await LocationService.addState(2, 'CA', 'California');

// Add cities
await LocationService.addCity(1, 'London', 51.5074, -0.1278);
await LocationService.addCity(2, 'San Francisco', 37.7749, -122.4194);
```

## Summary

The database services module provides:
- ✅ Type-safe database operations
- ✅ Automatic error handling
- ✅ Connection pooling
- ✅ Transaction support
- ✅ Audit logging
- ✅ Performance optimization
- ✅ RESTful API ready

Use these services in your routes for all data access operations.
