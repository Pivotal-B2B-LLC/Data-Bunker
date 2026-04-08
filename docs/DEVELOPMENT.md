# Development Guide

## Adding New Countries

To add support for a new country, follow these steps:

### 1. Update Location Data

Edit `/data/locations/index.json` and add your country:

```json
{
  "code": "de",
  "name": "Germany",
  "region": "Europe",
  "dataSource": "opencorporates",
  "states": [
    {
      "code": "de-bw",
      "name": "Baden-Württemberg",
      "cities": ["Stuttgart", "Mannheim", "Heidelberg"]
    }
  ]
}
```

### 2. Create Data Source Handler (if needed)

If you need a country-specific API, create a service:

```javascript
// backend/src/services/countryName.js
const axios = require('axios');
const cache = require('../utils/cache');

class CountryNameService {
  async searchCompanies(query, options = {}) {
    // Implementation
  }
}

module.exports = new CountryNameService();
```

### 3. Update Search Routes

Modify `/backend/src/routes/search.js` to use the new service:

```javascript
if (country === 'de') {
  results = await countryNameService.searchCompanies(query, options);
} else {
  results = await openCorporates.searchCompanies(query, options);
}
```

### 4. Test the Integration

```bash
# Test the API endpoint
curl "http://localhost:5000/api/search?query=Company&country=de"
```

## Supported Data Sources

### OpenCorporates (Global)
- **Coverage**: 150+ countries
- **Rate Limit**: 5 requests/minute (free tier)
- **Setup**: Get free API key from https://opencorporates.com/api

### Companies House (UK)
- **Coverage**: United Kingdom only
- **Rate Limit**: Effectively unlimited
- **Setup**: Get free API key from https://developer.companieshouse.gov.uk/

### Custom Implementations Needed

#### United States
```javascript
// SEC EDGAR (Public companies only)
const secUrl = 'https://www.sec.gov/cgi-bin/browse-edgar';

// State Business Registries (e.g., Delaware)
const delawareUrl = 'https://onlineservices.delaware.gov';
```

#### European Union
```javascript
// Germany - Bundesanzeiger API (limited)
const germanUrl = 'https://www.bundesanzeiger.de/ebanzwww/public/';

// France - Infogreffe (requires scraping)
const franceUrl = 'https://www.infogreffe.fr/';
```

#### Asia-Pacific
```javascript
// Australia - ASIC (CSV downloads)
const asicUrl = 'https://www.asic.gov.au/';

// Japan - EDINET (Japanese companies)
const jUrl = 'https://edinet-fss.sec.go.jp/';
```

## Performance Optimization

### 1. Implement Caching

Results are cached with TTL:
- **Company search**: 1 hour
- **Company details**: 24 hours
- **Location data**: 7 days (global data, less frequent changes)

Adjust in `/backend/src/services/*.js`:

```javascript
cache.set('service:operation', params, result, 3600); // 1 hour TTL
```

### 2. Database Optimization (Optional)

For production, consider storing frequently accessed data:

```javascript
// With MongoDB/Supabase
const Company = {
  registrationNumber: String,
  name: String,
  country: String,
  status: String,
  lastUpdated: Date,
  data: Object // Full company data
};

// Index frequently searched fields
db.companies.createIndex({ name: 'text', country: 1, status: 1 });
```

### 3. Rate Limiting Strategy

```javascript
// Implement request queue for rate-limited APIs
class RequestQueue {
  constructor(requestsPerSecond) {
    this.queue = [];
    this.processing = false;
    this.rps = requestsPerSecond;
  }

  async enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const { fn, resolve, reject } = this.queue.shift();
    
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
    
    await new Promise(r => setTimeout(r, 1000 / this.rps));
    this.processing = false;
    this.process();
  }
}
```

## Testing

### Unit Tests

```bash
cd backend
npm test
```

### API Testing

```bash
# Test search endpoint
curl -X GET "http://localhost:5000/api/search?query=Google&country=us&limit=10"

# Test location endpoints
curl -X GET "http://localhost:5000/api/locations/countries"
curl -X GET "http://localhost:5000/api/locations/countries/gb/states"

# Test company details
curl -X GET "http://localhost:5000/api/companies/03404908?country=gb"
```

### Integration Testing

```bash
# Start backend
npm start

# In another terminal, test full flow
cd ../frontend
npm test
```

## Frontend Component Development

### Adding New Components

1. Create component in `/frontend/src/components/`:

```javascript
import React from 'react';

function NewComponent(props) {
  return (
    <div>
      {/* Component JSX */}
    </div>
  );
}

export default NewComponent;
```

2. Use in pages:

```javascript
import NewComponent from '../components/NewComponent';

// In SearchPage or other pages
<NewComponent {...props} />
```

### State Management

For complex state, consider Redux:

```bash
npm install redux react-redux @reduxjs/toolkit
```

## Debugging

### Backend Logging

The backend logs all API calls:

```
[2024-01-04T10:30:45.123Z] GET /api/search
[SEARCH] Query: "Google", Country: us
[CACHE SET] companieshouse:search:... (TTL: 3600s)
[API] Response: { companies: [...] }
```

### Frontend Debugging

Use React DevTools extension and browser console:

```javascript
// Enable verbose logging in api.js
api.interceptors.request.use(config => {
  console.log(`[API] ${config.method.toUpperCase()} ${config.url}`, config.params);
  return config;
});
```

## Common Issues & Solutions

### Rate Limit Exceeded

**Problem**: `Error: Rate limit exceeded`

**Solution**:
- Adjust `RATE_LIMIT_MAX_REQUESTS` in `.env`
- Implement exponential backoff retry logic
- Cache responses more aggressively

### API Key Invalid

**Problem**: `Error: Unauthorized - API key invalid`

**Solution**:
- Verify API key is correct in `.env`
- Check API provider for key regeneration
- Ensure key has correct permissions

### CORS Errors

**Problem**: `Cross-Origin Request Blocked`

**Solution**:
- Backend CORS is configured in `server.js`
- For production, update allowed origins:

```javascript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
```

### Slow Response Times

**Problem**: Search takes >5 seconds

**Solution**:
- Check API provider status
- Increase cache TTL for frequently searched terms
- Add pagination/limit to reduce result sizes
- Consider database indexing

## Scaling for Production

### 1. Use Environment Variables

```bash
export NODE_ENV=production
export COMPANIES_HOUSE_API_KEY=xxx
export OPENCORPORATES_API_KEY=xxx
```

### 2. Add Database Layer

```javascript
// Use Supabase or MongoDB for:
// - Caching company search results
// - Storing user favorites
// - Analytics and search trends
```

### 3. Implement CDN

For static assets:
- Frontend: Deploy to Vercel or Netlify
- Backend: Use Cloudflare for API caching

### 4. Monitor Performance

```bash
npm install pino pino-pretty
# Add performance monitoring to backend
```

## Contributing Guidelines

1. Create feature branch: `git checkout -b feature/new-country-support`
2. Add/modify files following patterns in existing code
3. Test thoroughly with real API calls
4. Document changes in commit messages
5. Submit PR with detailed description

## References

- Companies House API: https://developer.companieshouse.gov.uk/
- OpenCorporates API: https://opencorporates.com/api
- SEC EDGAR: https://www.sec.gov/cgi-bin/browse-edgar
- Bootstrap Documentation: https://getbootstrap.com/docs/
- React Documentation: https://react.dev/
