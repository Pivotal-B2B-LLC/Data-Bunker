# Data Sources & API Reference

## Overview of Available APIs

### Global Data Sources

#### 1. OpenCorporates API
**Coverage**: 150+ countries  
**Free Plan**: Yes (5 requests/min)  
**Documentation**: https://opencorporates.com/api

```
GET https://api.opencorporates.com/v0.4/companies/search
Parameters:
  - q: company name (required)
  - jurisdiction_code: country code (e.g., "gb" for UK)
  - per_page: results per page (default: 30)
  - page: page number
  - company_type: type of company
```

**Example Request**:
```bash
curl -H "User-Agent: DataBunker" \
  "https://api.opencorporates.com/v0.4/companies/search?q=Apple&jurisdiction_code=us"
```

**Response Sample**:
```json
{
  "companies": [{
    "company": {
      "name": "Apple Inc.",
      "company_number": "942404",
      "jurisdiction_code": "us_ca",
      "status": "Active",
      "incorporation_date": "1977-04-01",
      "type": "Corporation",
      "registered_address": "1 Apple Park Way, Cupertino, CA 95014, USA",
      "url": "https://opencorporates.com/companies/us_ca/942404"
    }
  }]
}
```

---

#### 2. Companies House API (UK)
**Coverage**: United Kingdom only  
**Free Plan**: Yes (API key required, no rate limit on company search)  
**Documentation**: https://developer.companieshouse.gov.uk/

```
GET https://api.companieshouse.gov.uk/search/companies
Headers:
  - Authorization: Bearer YOUR_API_KEY
Parameters:
  - q: company name (required)
  - items_per_page: results per page (default: 20)
  - start_index: pagination start
  - company_status: active|dissolved|liquidation|etc
```

**Example Request**:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://api.companieshouse.gov.uk/search/companies?q=Google&company_status=active"
```

**Response Sample**:
```json
{
  "items": [{
    "company_number": "03404908",
    "company_status": "active",
    "company_type": "private-unlimited-company",
    "kind": "searchresults#company",
    "links": {
      "company_profile": "/company/03404908"
    },
    "matched_header": "GOOGLE UK LIMITED",
    "snippet": "",
    "title": "GOOGLE UK LIMITED"
  }],
  "items_per_page": 20,
  "kind": "search#companies",
  "page_number": 1,
  "start_index": 0,
  "total_results": 1
}
```

**Get Company Details**:
```
GET https://api.companieshouse.gov.uk/company/{company_number}
```

**Response Includes**:
- Company name
- Registration number
- Address
- Status
- Directors
- Officers
- Filing history

---

#### 3. SEC EDGAR (USA)
**Coverage**: US Public Companies  
**Free Plan**: Yes (no API key required)  
**Documentation**: https://www.sec.gov/cgi-bin/browse-edgar

```
GET https://data.sec.gov/submissions/CIK0000001047.json
Parameters: CIK (Central Index Key) - company identifier
```

**Finding CIK**:
```bash
curl "https://www.sec.gov/cgi-bin/browse-edgar?company=Apple&action=getcompany&output=json"
```

**Response Sample**:
```json
{
  "cik_str": 320193,
  "entityType": "operating",
  "name": "Apple Inc.",
  "sic": "3571",
  "sicDescription": "Electronic Computers",
  "insiderTransactionForOwnerExcluded": 0,
  "insiderTransactionForIssuerExcluded": 1,
  "entity_type": "operating",
  "filings": {
    "recent": {
      "form": ["10-K", "10-Q", ...],
      "filingDate": ["2025-11-15", ...],
      "accessionNumber": ["0000320193-25-000119", ...]
    }
  }
}
```

---

### Regional Data Sources

#### UK - Companies House Extended Data
```
GET https://api.companieshouse.gov.uk/officers/{company_number}/appointments
GET https://api.companieshouse.gov.uk/search/officers
GET https://api.companieshouse.gov.uk/company/{company_number}/filing-history
```

#### US - State Business Registries

**Secretary of State Databases**:
- Delaware (most corporations): https://onlineservices.delaware.gov
- California: https://www.sos.ca.gov/business-programs/
- New York: https://www.dos.ny.gov/corps
- Texas: https://www.sos.state.tx.us/

Example (Delaware):
```bash
# No official free API, but data is available as bulk downloads
curl "https://onlineservices.delaware.gov/sos/Investor/PublicSearch"
```

#### EU - GLEIF (Global LEI Registry)
**Coverage**: Legal entity identifiers worldwide  
**Free Plan**: Yes

```
GET https://www.gleif.org/api/v1/lei-records
Parameters:
  - filter[entity.legalName]: company name
  - filter[entity.jurisdiction]: country
```

---

## API Implementation Strategy

### Phase 1: UK (MVP)
1. **Primary**: Companies House API
2. **Secondary**: OpenCorporates (as fallback)
3. **Additional**: Companies House detailed company data

### Phase 2: Global Expansion
1. **Primary**: OpenCorporates (for 150+ countries)
2. **Secondary**: Country-specific APIs as available
3. **Fallback**: Public company registries (manual or web scraping)

### Phase 3: Advanced
1. **Commercial APIs**: For high accuracy (paid)
   - Clearbit
   - FactoryIP
   - D&B
2. **Bulk data**: Annual exports from official sources

---

## Rate Limiting & Best Practices

### Companies House API
- **Limit**: Effectively unlimited for basic search
- **Recommendation**: 10 requests/second max
- **Cache**: 24 hours

### OpenCorporates API
- **Free Tier**: 5 requests/minute (300/hour)
- **Paid Tier**: Higher limits
- **Recommendation**: Implement queue/caching
- **Cache**: 7 days

### SEC EDGAR
- **Limit**: No strict limit (be respectful)
- **Recommendation**: 1 request/second max
- **Cache**: 30 days
- **Bulk option**: Download full dataset quarterly

### General Best Practices
1. **Cache responses** - Store results locally
2. **Rate limiting** - Implement request queuing
3. **Error handling** - Retry with exponential backoff
4. **User-Agent header** - Identify your application
5. **Legal compliance** - Store only public data
6. **Monitoring** - Track API usage and costs

---

## Sample API Calls

### Search by Company Name (UK)
```javascript
async function searchCompaniesHouse(companyName) {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  const url = `https://api.companieshouse.gov.uk/search/companies?q=${encodeURIComponent(companyName)}&company_status=active`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });
  
  return response.json();
}
```

### Search by Location (Global)
```javascript
async function searchByLocation(country, state, city) {
  const query = `${city}, ${state}, ${country}`;
  const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(query)}&jurisdiction_code=${country}`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'DataBunker/1.0'
    }
  });
  
  return response.json();
}
```

### Get Company Details (UK)
```javascript
async function getCompanyDetails(companyNumber) {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  const url = `https://api.companieshouse.gov.uk/company/${companyNumber}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });
  
  return response.json();
}
```

---

## Jurisdiction Codes Reference

### Common OpenCorporates Jurisdiction Codes
```
gb - United Kingdom
us_ca - California, USA
us_de - Delaware, USA
au - Australia
de - Germany
fr - France
jp - Japan
cn - China
in - India
ca - Canada (federal)
```

See full list: https://opencorporates.com/pages/jurisdictions

---

## Error Handling Strategy

```javascript
const API_ERRORS = {
  'rate_limit': { code: 429, retry: true, delay: 60000 },
  'not_found': { code: 404, retry: false },
  'unauthorized': { code: 401, retry: false },
  'server_error': { code: 500, retry: true, delay: 5000 },
  'timeout': { code: 'TIMEOUT', retry: true, delay: 3000 }
};

async function retryWithBackoff(fn, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errorConfig = API_ERRORS[error.type];
      if (!errorConfig?.retry || attempt === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, errorConfig.delay * Math.pow(2, attempt)));
    }
  }
}
```

---

## Location Filter Implementation

### Overview

The application provides a global, cascading location filter for company search:
- **Country** → **State/Province/Region** → **City** → **District/Local Area**

#### Data Sources (Free APIs Only)
- **Countries**: [REST Countries API](https://restcountries.com/v3.1/all)
- **States/Provinces, Cities, Districts**: [OpenStreetMap Nominatim API](https://nominatim.openstreetmap.org/)

---

### 1. Countries Dropdown

- **API**: `GET https://restcountries.com/v3.1/all`
- **Fields Used**:
  - `country_name` (from `name.common`)
  - `iso2_code` (from `cca2`)
  - `iso3_code` (from `cca3`, optional)
- **Sorting**: Alphabetically by `country_name`
- **Behavior**:
  - Loads automatically on page load.
  - If API fails, shows a "Retry" button (not an error banner).
  - Searchable, async loading spinner, and "Loading countries..." message.
  - Caches results locally for instant reloads.

---

### 2. State/Province/Region Dropdown

- **API**:  
  `GET https://nominatim.openstreetmap.org/search?country={country_name}&format=json&addressdetails=1&limit=100`
- **Extraction**:
  - Filter results where `address` contains `admin_level` 4–6 (state/province/region).
- **Behavior**:
  - Loads when a country is selected.
  - Searchable, async loading spinner, "Loading states/provinces..." message.
  - Caches per country.
  - If missing data, skips gracefully.

---

### 3. City Dropdown

- **API**:  
  `GET https://nominatim.openstreetmap.org/search?country={country_name}&state={state_name}&format=json&addressdetails=1&limit=100`
- **Extraction**:
  - Filter results for cities within the selected state/province.
- **Behavior**:
  - Loads when a state/province is selected.
  - Searchable, async loading spinner, "Loading cities..." message.
  - Caches per state/province.
  - Skips gracefully if missing.

---

### 4. District/Local Area Dropdown

- **API**:  
  `GET https://nominatim.openstreetmap.org/search?country={country_name}&state={state_name}&city={city_name}&format=json&addressdetails=1&limit=100`
- **Extraction**:
  - Filter for districts or local areas below the city level.
- **Behavior**:
  - Loads when a city is selected.
  - Searchable, async loading spinner, "Loading districts..." message.
  - Caches per city.
  - Skips gracefully if missing.

---

### 5. Error Handling & UX

- **Retries**: Each API call retries up to 3 times on failure.
- **Fallback**: After 3 failures, shows a non-blocking message and a "Retry" button.
- **Validation Messages**:
  - "Loading countries...", "Loading states/provinces...", etc.
  - "No results found"
  - "Retry"
- **Never leaves UI blank**; always shows a message or spinner.
- **Other filters remain usable if one fails.**

---

### 6. Performance & Caching

- **Local cache**: All API results are cached in local storage or memory for instant reloads.
- **Debounce**: Typing in search boxes is debounced for performance.
- **Async loading**: All dropdowns show spinners while loading.

---

### 7. Database Fields Needed

- `country`
- `country_iso2`
- `state_or_province`
- `city`
- `district`
- `latitude` (optional)
- `longitude` (optional)

---

### 8. Example API Calls

#### Get All Countries

```bash
curl "https://restcountries.com/v3.1/all"
```

#### Get States/Provinces for a Country

```bash
curl "https://nominatim.openstreetmap.org/search?country=Canada&format=json&addressdetails=1&limit=100"
```

#### Get Cities for a State

```bash
curl "https://nominatim.openstreetmap.org/search?country=Canada&state=Ontario&format=json&addressdetails=1&limit=100"
```

#### Get Districts for a City

```bash
curl "https://nominatim.openstreetmap.org/search?country=Canada&state=Ontario&city=Toronto&format=json&addressdetails=1&limit=100"
```

---

### 9. UI/UX Requirements

- All dropdowns are searchable, async, and show loading/validation messages.
- Retry button appears on error.
- No paid or rate-limited APIs are used.
- Dropdowns must feel instant, even on slow internet.

---

## Next Steps

1. Get API keys from Companies House and OpenCorporates
2. Set up environment variables
3. Implement API service layer (see backend documentation)
4. Add location filtering
5. Build UI components
6. Test with real data
