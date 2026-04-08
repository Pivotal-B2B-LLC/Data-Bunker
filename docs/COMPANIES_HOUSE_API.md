# Companies House API Integration Guide

## ✅ What Was Fixed

### 1. Correct API Base URL
- **Old**: `https://api.companieshouse.gov.uk`
- **New**: `https://api.company-information.service.gov.uk` ✓

### 2. Proper Authentication
- Uses **Basic Auth** with API key as username and blank password
- Encodes credentials in Base64: `Basic base64(API_KEY:)`
- No Bearer tokens used ✓

### 3. Valid Endpoints
- `/search/companies?q=query` - Search for companies
- `/company/{company_number}` - Get company details
- `/company/{company_number}/officers` - Get company officers

### 4. Backend-Only Implementation
- All API calls run through Express backend
- No direct browser requests (avoids CORS issues)
- Frontend calls backend at `/api/*` endpoints ✓

### 5. Comprehensive Logging
- Request URLs and parameters logged
- Response data logged (status, count, etc.)
- Detailed error logging with status codes
- Stack traces for debugging

## 🧪 Testing the Integration

### Step 1: Add Your API Key

Create `backend/.env` file:
```bash
cd backend
cp .env.example .env
# Edit .env and add your API key
```

Your `.env` should have:
```env
COMPANIES_HOUSE_API_KEY=a63cf07f-2099-4182-91e0-a89edb762c96
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

### Step 2: Run the Test Script

```bash
cd backend
node test-api.js
```

**Expected output:**
```
=== Companies House API Test ===

✓ API Key found: xxxxxxxx...
✓ Base URL: https://api.company-information.service.gov.uk
✓ Auth Header: Basic ...

Test 1: Searching for "TESCO"...
✅ Search successful!
   Found 5 companies
   Total results: 20
   First result: TESCO PLC (00445790)

Test 2: Getting details for company 00445790...
✅ Company details retrieved!
   Name: TESCO PLC
   Status: active
   Type: plc
   ...

Test 3: Getting officers for company 00445790...
✅ Officers retrieved!
   Active count: 15
   ...

✅ All tests passed!
```

### Step 3: Start the Backend Server

```bash
cd backend
npm install
npm start
```

### Step 4: Test API Endpoints

#### Test Connectivity
```bash
curl http://localhost:5000/api/companies/test
```

#### Search Companies
```bash
curl "http://localhost:5000/api/search?query=microsoft&country=gb"
```

#### Get Company Details
```bash
curl "http://localhost:5000/api/companies/00445790?country=gb"
```

#### Get Company Officers
```bash
curl "http://localhost:5000/api/companies/00445790/officers?country=gb"
```

## 📊 API Response Format

### Search Results
```json
{
  "success": true,
  "data": {
    "companies": [
      {
        "id": "00445790",
        "name": "TESCO PLC",
        "registrationNumber": "00445790",
        "status": "active",
        "type": "plc",
        "address": "Tesco House, Shire Park, Kestrel Way...",
        "dateOfCreation": "1947-11-27",
        "url": "https://find-and-update.company-information.service.gov.uk/company/00445790",
        "source": "Companies House"
      }
    ],
    "total": 100,
    "pageSize": 20
  }
}
```

### Company Details
```json
{
  "success": true,
  "data": {
    "id": "00445790",
    "name": "TESCO PLC",
    "registrationNumber": "00445790",
    "status": "active",
    "type": "plc",
    "incorporationDate": "1947-11-27",
    "jurisdiction": "England/Wales",
    "registeredOffice": {
      "full": "Tesco House, Shire Park, Kestrel Way...",
      "city": "Welwyn Garden City",
      "postalCode": "AL7 1GA",
      "country": "United Kingdom"
    },
    "sicCodes": ["47110"],
    "accounts": {
      "nextDue": "2025-05-31",
      "overdue": false
    },
    "rawData": { ... }
  }
}
```

## 🔍 Monitoring & Debugging

### Backend Logs
When searching, you'll see:
```
[SEARCH] Query: "microsoft", Location: gb → - → - → -
[SEARCH] Using Companies House API
[Companies House] Search request: { url: '...', params: {...} }
[Companies House] Search response: { status: 200, itemsCount: 20, totalResults: 100 }
[SEARCH] Found 20 companies
```

### Error Logs
If something goes wrong:
```
[Companies House] Search error: {
  message: 'Unauthorized - Companies House API key is invalid',
  status: 401,
  data: { ... }
}
```

## 🚨 Common Issues & Solutions

### Issue: "Unauthorized - API key is invalid"
**Solution:**
- Verify API key in `.env` file
- Check for extra spaces or quotes
- Ensure key is from https://developer.company-information.service.gov.uk/

### Issue: "Cannot connect to Companies House API"
**Solution:**
- Check internet connection
- Verify firewall settings
- Try the test script: `node test-api.js`

### Issue: "Rate limit exceeded"
**Solution:**
- Wait 10 seconds between requests
- Companies House allows 600 requests per 5 minutes
- Caching is implemented (1 hour for searches, 24 hours for details)

### Issue: "Company not found"
**Solution:**
- Verify company number is correct (e.g., "00445790")
- Check company exists at: https://find-and-update.company-information.service.gov.uk/
- Ensure using UK country code: `country=gb`

## 📝 Next Steps

1. ✅ **Test the integration** - Run `node test-api.js`
2. ✅ **Start the server** - Run `npm start`
3. ✅ **Test endpoints** - Use curl or Postman
4. ✅ **Check logs** - Monitor console output
5. ✅ **Deploy** - Push to production

## 🔗 Useful Links

- [Companies House API Docs](https://developer.company-information.service.gov.uk/)
- [Get API Key](https://developer.company-information.service.gov.uk/manage-applications)
- [Company Search](https://find-and-update.company-information.service.gov.uk/)
- [API Status](https://companieshouse.service.gov.uk/)

## 💡 Tips

- **Caching**: Results are cached (searches: 1hr, details: 24hrs)
- **Rate limits**: 600 req/5min automatically handled
- **Country code**: Use `gb` or `uk` for UK companies
- **Logging**: All requests and errors are logged to console
- **Testing**: Use `/api/companies/test` endpoint to verify connectivity
