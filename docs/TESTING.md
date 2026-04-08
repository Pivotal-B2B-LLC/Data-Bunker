# Testing Guide & API Examples

## Quick API Testing

### Using cURL (Command Line)

#### 1. Search for Companies (UK)

```bash
# Search by name
curl -X GET "http://localhost:5000/api/search?query=Google&country=gb&limit=10"

# Expected response:
{
  "success": true,
  "query": "Google",
  "country": "gb",
  "data": {
    "companies": [
      {
        "id": "03404908",
        "name": "GOOGLE UK LIMITED",
        "registrationNumber": "03404908",
        "status": "active",
        "type": "private-unlimited-company",
        "matched": "GOOGLE UK LIMITED",
        "url": "https://beta.companieshouse.gov.uk/company/03404908",
        "source": "Companies House"
      }
    ],
    "total": 5,
    "pageSize": 20
  }
}
```

#### 2. Get Company Details

```bash
curl -X GET "http://localhost:5000/api/companies/03404908?country=gb"

# Expected response:
{
  "success": true,
  "data": {
    "id": "03404908",
    "name": "GOOGLE UK LIMITED",
    "registrationNumber": "03404908",
    "status": "active",
    "type": "private-unlimited-company",
    "incorporationDate": "1997-05-09",
    "jurisdiction": "United Kingdom (England)",
    "registeredOffice": {
      "full": "1 St Pancras Square, London, N1C 4AG, United Kingdom",
      "line1": "1 St Pancras Square",
      "city": "London",
      "state": "London",
      "postalCode": "N1C 4AG",
      "country": "United Kingdom"
    },
    "sicCodes": ["62090"],
    "sicDescription": "Other professional, scientific and technical activities not elsewhere classified",
    "countOfOfficers": 8,
    "url": "https://beta.companieshouse.gov.uk/company/03404908",
    "source": "Companies House"
  }
}
```

#### 3. Get Company Officers

```bash
curl -X GET "http://localhost:5000/api/companies/03404908/officers?country=gb"

# Expected response:
{
  "success": true,
  "data": {
    "officers": [
      {
        "name": "SMITH, John",
        "position": "Director",
        "appointmentDate": "2020-01-15",
        "resignationDate": null,
        "nationality": "British",
        "occupation": "Company Director",
        "address": {
          "full": "1 St Pancras Square, London, N1C 4AG",
          "line1": "1 St Pancras Square",
          "city": "London",
          "state": "London",
          "postalCode": "N1C 4AG",
          "country": "United Kingdom"
        }
      }
    ]
  }
}
```

#### 4. Get All Countries

```bash
curl -X GET "http://localhost:5000/api/locations/countries"

# Expected response:
{
  "success": true,
  "data": [
    {
      "code": "gb",
      "name": "United Kingdom",
      "region": "Europe",
      "dataSource": "companieshouse"
    },
    {
      "code": "us",
      "name": "United States",
      "region": "North America",
      "dataSource": "opencorporates"
    }
  ]
}
```

#### 5. Get States in Country

```bash
curl -X GET "http://localhost:5000/api/locations/countries/gb/states"

# Expected response:
{
  "success": true,
  "country": "United Kingdom",
  "data": [
    {
      "code": "eng",
      "name": "England"
    },
    {
      "code": "sco",
      "name": "Scotland"
    }
  ]
}
```

#### 6. Get Cities in State

```bash
curl -X GET "http://localhost:5000/api/locations/countries/gb/states/eng/cities"

# Expected response:
{
  "success": true,
  "country": "United Kingdom",
  "state": "England",
  "data": ["London", "Manchester", "Birmingham", "Leeds", "Bristol"]
}
```

#### 7. Get Industries

```bash
curl -X GET "http://localhost:5000/api/locations/industries"

# Expected response:
{
  "success": true,
  "data": [
    "Technology",
    "Finance & Banking",
    "Healthcare",
    "Retail",
    "Manufacturing"
  ]
}
```

### Using JavaScript/Axios

```javascript
import axios from 'axios';

const API_URL = 'http://localhost:5000/api';

// Search companies
async function searchCompanies() {
  try {
    const response = await axios.get(`${API_URL}/search`, {
      params: {
        query: 'Google',
        country: 'gb',
        limit: 10
      }
    });
    console.log(response.data);
  } catch (error) {
    console.error('Error:', error.response?.data?.error);
  }
}

// Get company details
async function getCompanyDetails() {
  try {
    const response = await axios.get(
      `${API_URL}/companies/03404908`,
      { params: { country: 'gb' } }
    );
    console.log(response.data);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

searchCompanies();
getCompanyDetails();
```

### Using Postman

1. Import Postman collection (create manually or paste below)

**Postman Collection JSON**:
```json
{
  "info": {
    "name": "Data Bunker API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Search Companies",
      "request": {
        "method": "GET",
        "url": {
          "raw": "http://localhost:5000/api/search?query=Google&country=gb&limit=10",
          "protocol": "http",
          "host": ["localhost"],
          "port": "5000",
          "path": ["api", "search"],
          "query": [
            {"key": "query", "value": "Google"},
            {"key": "country", "value": "gb"},
            {"key": "limit", "value": "10"}
          ]
        }
      }
    }
  ]
}
```

## Error Response Examples

### Invalid Input

```bash
curl -X GET "http://localhost:5000/api/search?query=&country=invalid"

# Response:
{
  "error": "Validation error",
  "details": "\"query\" is not allowed to be empty"
}
```

### Missing Required Parameter

```bash
curl -X GET "http://localhost:5000/api/search"

# Response:
{
  "error": "Validation error",
  "details": "\"query\" is required"
}
```

### Invalid API Key

```bash
# (when API key is wrong/expired)
{
  "error": "Unauthorized - API key invalid"
}
```

### Rate Limit Exceeded

```bash
{
  "error": "Rate limit exceeded for OpenCorporates API (5 req/min)"
}
```

### Company Not Found

```bash
curl -X GET "http://localhost:5000/api/companies/INVALID123?country=gb"

# Response:
{
  "error": "Company not found",
  "type": "not_found"
}
```

## Pre-Deployment Checklist

### Backend Setup
- [ ] Node.js 16+ installed
- [ ] `.env` file created with API keys
- [ ] All npm dependencies installed (`npm install`)
- [ ] No console errors on startup
- [ ] Server runs on correct port

### Backend Testing
- [ ] Health check endpoint works: `GET /health`
- [ ] Search endpoint returns results: `GET /api/search`
- [ ] Company details endpoint works: `GET /api/companies/:id`
- [ ] Location endpoints return data: `GET /api/locations/*`
- [ ] Rate limiting works: Multiple rapid requests return 429
- [ ] Caching works: Identical requests show [CACHE HIT]
- [ ] Error handling: Invalid inputs return appropriate errors

### Frontend Setup
- [ ] React dependencies installed (`npm install`)
- [ ] `.env.local` file created
- [ ] `REACT_APP_API_URL` points to backend
- [ ] No console errors on startup
- [ ] UI renders without errors

### Frontend Testing
- [ ] App loads and displays search interface
- [ ] Location selector works (country → state → city)
- [ ] Search button submits query
- [ ] Results display company cards
- [ ] Company card shows name, registration, status
- [ ] "View Details" button opens modal
- [ ] Modal shows company information
- [ ] Modal closes properly
- [ ] Error messages display for failed requests
- [ ] Loading spinner shows during search

### Integration Testing
- [ ] Backend running on correct port
- [ ] Frontend configured to correct backend URL
- [ ] End-to-end search: Select location → Search → View results
- [ ] Network tab shows API requests
- [ ] Cache is working (same search twice loads faster)
- [ ] No CORS errors

### Browser Compatibility
- [ ] Chrome/Chromium latest
- [ ] Firefox latest
- [ ] Safari latest
- [ ] Mobile Chrome (responsive)

### API Key Verification
- [ ] Companies House API key valid
- [ ] OpenCorporates API key valid (or test without)
- [ ] API keys have no special characters needing escaping
- [ ] API keys not exposed in frontend code

### Security Checklist
- [ ] No API keys in frontend code
- [ ] API keys stored in environment variables only
- [ ] CORS properly configured
- [ ] Input validation working
- [ ] No console errors or warnings

### Performance Checklist
- [ ] First search completes within 5 seconds
- [ ] Repeat search completes within 1 second (cached)
- [ ] UI responsive while loading
- [ ] No memory leaks (check DevTools)
- [ ] Pagination works for large result sets

### Code Quality
- [ ] No console.log statements left (except important ones)
- [ ] No commented-out code
- [ ] No TypeScript errors
- [ ] Consistent formatting
- [ ] Comments where needed

## Test Data

### UK Companies to Search
- **Google UK Limited** (Company #03404908)
- **Apple UK Holdings Limited** (Company #03342314)
- **Microsoft UK Limited** (Company #02882670)
- **Amazon UK Services Limited** (Company #07978629)

### US Companies to Search (OpenCorporates)
- **Apple Inc** (CA: 942404)
- **Google LLC** (CA: C3877698)
- **Microsoft Corp** (WA: 601-144-164)

### Test Queries
- Valid: "Google", "Apple", "Microsoft"
- Partial: "Goog", "Micr"
- Not found: "ZZZZZZZZ", "NonExistentCorp123"
- Special chars: "AT&T", "Johnson&Johnson"

## Monitoring & Logging

### Check Backend Logs

```bash
# Watch backend logs in real-time
npm start | grep -E "\[API\]|\[CACHE\]|\[ERROR\]"

# Count cache hits
npm start 2>&1 | grep "CACHE HIT" | wc -l
```

### Monitor API Performance

```bash
# Log response times
curl -w "Time: %{time_total}s\n" \
  "http://localhost:5000/api/search?query=Google&country=gb"
```

### Check Memory Usage

```javascript
// Add to backend route
router.get('/debug/memory', (req, res) => {
  const usage = process.memoryUsage();
  res.json({
    rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`
  });
});
```

## Performance Benchmarks

### Expected Response Times

| Endpoint | First Call | Cached Call | Notes |
|----------|-----------|-----------|-------|
| `/search` | 500-2000ms | 50-100ms | API dependent |
| `/companies/:id` | 300-1000ms | 30-50ms | Usually faster |
| `/locations/*` | 100-500ms | 10-20ms | Static data |
| `/officers` | 400-1500ms | 30-50ms | Additional API call |

### Load Testing

```bash
# Using Apache Bench (ab)
ab -n 100 -c 10 "http://localhost:5000/health"

# Using wrk (better)
wrk -t4 -c100 -d30s http://localhost:5000/health
```

---

**Run through this checklist before deploying to production!** ✅
