# Data Bunker - Complete API Reference (Phase 3 Updated)

## 🎯 Core Endpoints

### Location Hierarchy APIs

#### Get Regions/States
```
GET /api/accounts/regions/:country
Response: ["California", "New York", "Texas", ...]
```

#### Get Cities
```
GET /api/accounts/cities/:country/:region
Response: ["Los Angeles", "San Francisco", "San Diego", ...]
```

#### Get Districts/Areas
```
GET /api/accounts/districts/:country/:region/:city
Response: ["Downtown", "Hollywood", "Venice Beach", ...]
```

#### Get Wards/Parishes (NEW - Phase 3)
```
GET /api/accounts/wards/:country/:region/:city/:district
Response: ["Ward 1", "Ward 2", "Central Ward", ...]
```

---

### Account/Company APIs

#### List Companies with Filters
```
GET /api/accounts?limit=50&offset=0&country=United States&state_region=New York&city=New York&district=Manhattan&ward=Midtown&industry=Restaurant&search=pizza
Response: {
  success: true,
  data: [
    {
      account_id: 1,
      company_name: "Sample Pizza Co",
      country: "United States",
      state_region: "New York",
      city: "New York",
      district: "Manhattan",
      ward: "Midtown",
      industry: "Restaurant",
      website: "https://example.com",
      phone_number: "212-555-1234",
      email_format: "sales@example.com",
      headquarters_address: "123 Main St, New York, NY 10001",
      linkedin_url: "https://linkedin.com/company/example",
      created_at: "2024-01-15T10:30:00Z"
    },
    ...
  ],
  total: 42
}
```

#### Get Single Company
```
GET /api/accounts/:id
Response: {
  success: true,
  data: { /* full company object */ }
}
```

#### Create Company
```
POST /api/accounts
Body: {
  company_name: "New Company",
  country: "United States",
  state_region: "California",
  city: "San Francisco",
  district: "Downtown",
  ward: "Financial District",
  industry: "Software",
  website: "https://company.com",
  phone_number: "415-555-1234",
  email_format: "info@company.com",
  headquarters_address: "123 Main St",
  linkedin_url: "https://linkedin.com/company/xxx",
  company_size: "100-500",
  revenue_range: "$1M-$10M",
  category: "Technology"
}
Response: { success: true, data: { /* created company */ } }
```

#### Update Company
```
PUT /api/accounts/:id
Body: { /* any fields to update */ }
Response: { success: true, data: { /* updated company */ } }
```

#### Delete Company
```
DELETE /api/accounts/:id
Response: { success: true, data: { deleted: true } }
```

---

### Discovery APIs

#### Start Company Discovery
```
POST /api/discovery/start
Body: {
  country: "United States",
  state_region: "New York",
  city: "New York",
  district: "Manhattan",
  ward: "Midtown",
  industry: "Restaurant",
  limit: 500
}
Response: {
  success: true,
  data: {
    processId: "discovery-123",
    status: "running",
    estimatedTime: "5 minutes"
  }
}
```

#### Get Discovery Status
```
GET /api/discovery/status
Response: {
  running: true,
  discovered: 234,
  total: 500,
  percentComplete: 46.8
}
```

#### Stop Discovery
```
POST /api/discovery/stop
Response: { success: true, data: { stopped: true } }
```

---

### Enrichment APIs (NEW - Phase 3)

#### Enrich All Companies
```
POST /api/enrichment/enrich-all
Response: {
  success: true,
  data: {
    totalQueued: 1234,
    pending: 1200,
    processing: 34,
    completed: 0
  }
}
```

#### Batch Enrich Companies
```
POST /api/enrichment/batch
Body: {
  companyIds: [1, 2, 3, 4, 5]
}
Response: {
  success: true,
  data: {
    queued: 5,
    status: "queued"
  }
}
```

#### Get Enrichment Queue Status
```
GET /api/enrichment/queue-status
Response: {
  success: true,
  data: {
    pending: 1200,
    processing: 34,
    completed: 5000
  }
}
```

#### Get Enrichment Statistics
```
GET /api/enrichment/stats
Response: {
  totalCompanies: 6234,
  withWebsite: 5900,
  withEmail: 5200,
  withPhone: 4800,
  withLinkedin: 3400,
  queue: {
    pending: 1200,
    processing: 34,
    completed: 5000
  }
}
```

#### Enrich Single Company
```
POST /api/enrichment/enrich/:companyId
Response: {
  success: true,
  data: {
    companyId: 1,
    enrichedFields: ["website", "email_format", "linkedin_url"]
  }
}
```

#### Queue Companies
```
POST /api/enrichment/queue
Body: {
  limit: 100,
  priority: 0
}
Response: {
  success: true,
  data: { queued: 87 }
}
```

#### Process Queue
```
POST /api/enrichment/process
Body: {
  limit: 10
}
Response: {
  success: true,
  data: {
    processed: 10,
    failed: 0
  }
}
```

#### Clear Completed/Failed Jobs
```
DELETE /api/enrichment/queue/clear
Response: {
  success: true,
  cleared: {
    completed: 5000,
    failed: 45
  },
  total: 5045
}
```

---

### Analytics APIs (NEW - Phase 3)

#### Get Location Analytics
```
GET /api/analytics/locations
Response: {
  success: true,
  data: {
    "New York, New York": 234,
    "Los Angeles, California": 187,
    "Chicago, Illinois": 156,
    ...
  }
}
```

#### Get Industry Analytics
```
GET /api/analytics/industries
Response: {
  success: true,
  data: {
    "Restaurant": 245,
    "Retail": 198,
    "Healthcare": 167,
    "Software": 145,
    ...
  }
}
```

#### Get Enrichment Status
```
GET /api/analytics/enrichment-status
Response: {
  success: true,
  data: {
    total: 6234,
    withWebsite: 5900,
    withEmail: 5200,
    withPhone: 4800,
    withLinkedin: 3400
  }
}
```

#### Get Analytics Summary
```
GET /api/analytics/summary
Response: {
  success: true,
  data: {
    totalCompanies: 6234,
    withWebsite: 5900,
    withEmail: 5200,
    withPhone: 4800,
    withLinkedin: 3400,
    uniqueIndustries: 25,
    uniqueLocations: 487,
    addedThisWeek: 234,
    enrichmentRate: 94
  }
}
```

---

## 📊 Filter Options

### Supported Industries (25 total)
```
Restaurant, Retail, Healthcare, Legal Services, Accounting,
Real Estate, Construction, IT Services, Consulting, Manufacturing,
Software, Education, Finance, Insurance, Transportation,
Energy, Telecommunications, Media, Entertainment, Tourism,
Agriculture, Mining, Utilities, Government, Other
```

### Location Hierarchy Parameters
```
country: "United States" | "United Kingdom" | "Canada" | ...
state_region: Any state/province name
city: Any city name
district: Any district/area/neighborhood name
ward: Any ward/parish/hamlet name
```

### Query Parameters for GET /api/accounts
```
limit: 1-1000 (default: 50)
offset: 0+ (default: 0)
country: string
state_region: string
city: string
district: string
ward: string
industry: string
search: string (searches company_name)
orderBy: "created_at" | "company_name" | "industry" (default: created_at)
orderDirection: "ASC" | "DESC" (default: DESC)
```

---

## 🔐 Response Format

All API responses follow this format:

### Success Response
```json
{
  "success": true,
  "data": { /* response data */ },
  "total": 42,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error description",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## 🎯 Common Use Cases

### Use Case 1: Discover and Export Companies
```
1. POST /api/discovery/start (with filters)
   → Gets processId
2. Poll GET /api/discovery/status until complete
3. GET /api/accounts (with same filters)
   → Gets all discovered companies
4. Frontend: Click "Export to CSV"
   → Downloads filtered companies as CSV
```

### Use Case 2: Bulk Enrich Recently Discovered
```
1. GET /api/accounts?orderBy=created_at (get recent)
2. Frontend: Select companies with checkboxes
3. POST /api/enrichment/batch with selected IDs
   → Queues for background enrichment
4. Poll GET /api/enrichment/queue-status
   → Monitor progress
5. Check GET /api/enrichment/stats
   → Verify enrichment completion
```

### Use Case 3: Enrich Everything
```
1. POST /api/enrichment/enrich-all
   → Queues all incomplete companies
2. Frontend: EnrichAllModal shows progress
3. Poll via GET /api/enrichment/queue-status
   → Real-time progress tracking
4. Receives rate and ETA calculations
```

### Use Case 4: Analyze Data
```
1. GET /api/analytics/summary
   → Get overall statistics
2. GET /api/analytics/locations
   → See distribution by city
3. GET /api/analytics/industries
   → See distribution by industry
4. Frontend: AnalyticsDashboard renders charts
```

### Use Case 5: Filter by Deep Location
```
1. GET /api/accounts/regions/United%20States
   → ["California", "New York", ...]
2. GET /api/accounts/cities/United%20States/New%20York
   → ["New York", "Buffalo", ...]
3. GET /api/accounts/districts/.../New%20York/New%20York
   → ["Manhattan", "Brooklyn", ...]
4. GET /api/accounts/wards/.../New%20York/Manhattan
   → ["Midtown", "Greenwich Village", ...]
5. GET /api/accounts?...&ward=Midtown&industry=Restaurant
   → Gets exact results
```

---

## ⚙️ Backend Integration

### Environment Variables
```
REACT_APP_API_URL=http://localhost:5000
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
```

### Database Tables
- `accounts` - Main company data (6234 records)
- `enrichment_queue` - Background enrichment jobs
- `contacts` - Associated contact information
- `locations` - Cached location hierarchies

### Required Node Packages
- express
- pg (PostgreSQL)
- dotenv
- cors
- node-cron (for background jobs)

---

## 🚀 Performance Notes

### Query Optimization
- Indexed on: country, state_region, city, district, ward, industry
- Pagination handled server-side
- Group queries use efficient aggregation
- Location cascades cached

### Bulk Operations
- Enrich-all queues in batches
- Background workers process 10 at a time
- Rate limiting: 100 requests/hour per IP

### Caching
- Location hierarchies cached in memory
- Stats refresh every 30 seconds
- Queue status updated in real-time

---

## 📱 Frontend Integration Examples

### React Component Usage

```javascript
// Load with filters
const response = await fetch(
  `${API_BASE_URL}/api/accounts?country=United%20States&state_region=New%20York`
);
const data = await response.json();
setCompanies(data.data);

// Bulk enrich
const enrichResponse = await fetch(`${API_BASE_URL}/api/enrichment/batch`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ companyIds: [1, 2, 3] })
});

// Enrich all
const enrichAllResponse = await fetch(`${API_BASE_URL}/api/enrichment/enrich-all`, {
  method: 'POST'
});

// Export to CSV
const csvResponse = await fetch(`${API_BASE_URL}/api/accounts?limit=10000`);
const csvData = await csvResponse.json();
// Convert to CSV and download
```

---

## 🧪 Testing Endpoints

Use with curl or Postman:

```bash
# Test location cascade
curl http://localhost:5000/api/accounts/regions/United%20States

# Test discovery
curl -X POST http://localhost:5000/api/discovery/start \
  -H "Content-Type: application/json" \
  -d '{"country":"United States","state_region":"New York"}'

# Test enrich-all
curl -X POST http://localhost:5000/api/enrichment/enrich-all \
  -H "Content-Type: application/json"

# Test analytics
curl http://localhost:5000/api/analytics/summary
```

---

**Last Updated**: Phase 3 Implementation
**API Version**: 2.0.0
**Status**: Production Ready
