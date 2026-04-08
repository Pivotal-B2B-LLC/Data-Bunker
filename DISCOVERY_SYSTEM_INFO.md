# Data Bunker Discovery System Overview

## 🎯 Discovery System Being Used

### **OpenAI-Powered US Company Discovery**

Your Data Bunker system uses **OpenAI-powered company discovery** as the primary mechanism for discovering and generating company data.

**Location:** `/backend/scripts/discover-with-openai.js`

---

## How It Works

### System Architecture

```
Discovery Page / Enrichment Page (Frontend)
    ↓
POST /api/discovery/start (Backend Route)
    ↓
Spawns: node discover-with-openai.js
    ↓
OpenAI API (GPT)
    ↓
Generates realistic company data
    ↓
Saves to PostgreSQL Database
```

### Key Features

1. **Location-Based Discovery**
   - Generates companies for specific locations
   - Supports: Country → State/Region → City → **District (Optional)**
   - Default region: United States

2. **Realistic Data Generation**
   - Uses OpenAI GPT to generate realistic company names
   - Creates diverse industries from predefined list
   - Generates authentic contact information
   - Creates LinkedIn URLs
   - Infers email formats (john@company.com, john.smith@company.com, etc.)
   - Generates phone numbers

3. **Flexible Company Size Support**
   - Small (1-50 employees)
   - Medium (51-500 employees)
   - Large (500+ employees)
   - Mixed (any size)

4. **No Limits**
   - Discover unlimited companies (set limit to 0)
   - Or specify exact numbers (50, 100, 500, 1000, 10000+)
   - All discovered companies automatically saved to database

---

## API Endpoint

**POST `/api/discovery/start`**

Request body:
```json
{
  "city": "New York",
  "state": "New York",
  "district": "Manhattan",        // Optional
  "limit": 0,                     // 0 = unlimited, or specific number
  "companySize": "Mixed"
}
```

Response:
```json
{
  "success": true,
  "message": "Company discovery started for New York, New York",
  "status": {
    "running": true,
    "city": "New York",
    "state": "New York",
    "district": "Manhattan",
    "stateCode": "NY",
    "limit": 0,
    "startTime": "2026-01-13T10:30:00.000Z",
    "companiesFound": 0
  }
}
```

---

## Configuration

### Required: OpenAI API Key

The system requires an OpenAI API key to function.

**Set environment variable:**
```bash
export OPENAI_API_KEY="sk-..."
```

**Or add to `.env` file:**
```
OPENAI_API_KEY=sk-...
```

### Optional: Customize Discovery

You can modify the discovery script at `/backend/scripts/discover-with-openai.js` to:
- Change industries list
- Adjust email format preferences
- Modify company name generation patterns
- Add additional data fields

---

## Available Discovery Methods

While your primary system is **OpenAI-Powered**, the backend also has other discovery scripts available (though not actively used in the interface):

1. **discover-with-openai.js** ✅ **[ACTIVE]**
   - Uses OpenAI GPT to generate realistic company data
   - Best for: Generating diverse, realistic company information

2. **discover-us-companies.js** (Dormant)
   - Alternative US company discovery method

3. **discover-us-companies-free.js** (Dormant)
   - Free alternative using public data sources

4. **discover-ny-organic.js** (Dormant)
   - New York specific discovery

5. **discover-more-ny-companies.js** (Dormant)
   - Additional NY company discovery

---

## Complete Discovery Flow in Data Bunker

### Step 1: Access Discovery
Navigate to **"🔍 Discovery"** page in the main navigation

### Step 2: Select Location
- Country: United States (default)
- State/Region: e.g., "New York"
- City: e.g., "New York"
- District: e.g., "Manhattan" (optional)

### Step 3: Set Limit
- **All Companies (No Limit)** - Unlimited discovery
- **50, 100, 200, 500, 1000, 5000, 10000** - Specific numbers

### Step 4: Start Discovery
Click **"🚀 Start Discovery"** button
- System spawns OpenAI discovery process
- Companies are generated in real-time
- All companies automatically saved to database

### Step 5: Monitor Progress
- Watch real-time progress in discovery status
- See "Companies Found" counter update
- View recent companies as they're added

### Step 6: View Results
Navigate to **"📊 Recent Found Data"** page to:
- View all discovered companies
- Filter by location hierarchy
- Search by company name or website
- Export or manage the data

---

## Discovery in Enrichment Page

The **Enrichment Page** (🤖 Enrichment) now includes:

### 1. Discovery Section
- **Exact same filters** as Discovery page
- System indicator: "**System: OpenAI-Powered Discovery**"
- Start discoveries directly from enrichment dashboard
- District/Area optional filtering

### 2. Find & Enrich Existing Section
- Find companies you already have in the database
- Select location filters to narrow down
- Queue found companies for enrichment
- Enrich multiple companies at once

---

## Data Generated Per Company

When OpenAI generates a company, it creates:

```
Company Information:
- Name (realistic business names)
- Industry (from diverse list)
- Company Size (Small/Medium/Large)
- Country (typically United States)
- State/Region (user selected)
- City (user selected)
- District (optional, user selected)
- Address (generated realistic format)
- Website (generated format: company.com)
- Phone Number (generated US format)
- Email Format (realistic patterns)
- LinkedIn URL (generated from company name)

Contacts (generated for each company):
- First Name
- Last Name
- Job Title
- Email (based on email format)
- Phone Number (optional)
- LinkedIn Profile (generated)
```

---

## Enrichment Integration

After companies are discovered via OpenAI, they can be **enriched** with additional data:

1. **From Discovery Page:**
   - View companies in "Recent Found Data"
   - Queue them for enrichment via the enrichment queue

2. **From Enrichment Page:**
   - Use "Find & Enrich Existing" section
   - Select location filters
   - Find your companies
   - Click "Enrich All" to queue them

3. **Enrichment Queue:**
   - Companies queued for enrichment
   - Processed by enrichment workers
   - Data supplemented with additional information
   - Progress tracked in real-time

---

## Advantages of OpenAI System

✅ **Realistic Data** - Generates authentic-looking company information
✅ **Scalable** - Can discover unlimited companies
✅ **Flexible** - Works with any location
✅ **No Rate Limits** - Unlike API-based services (within OpenAI quota)
✅ **Fast** - Generates companies quickly
✅ **Customizable** - Easy to adjust parameters
✅ **Integrated** - Seamlessly integrated with enrichment pipeline

---

## When You See "OpenAI-Powered Discovery"

You'll see this label in:
- **Discovery Page:** Main discovery section header
- **Enrichment Page:** In the 🌎 Discovery section alert
- **System Status:** Logged in backend when discovery starts

---

## Next Steps

### To Use the Discovery System:

1. **Ensure OpenAI API Key is set**
   - Check `.env` file in `/backend` directory
   - Should have: `OPENAI_API_KEY=sk-...`

2. **Navigate to Discovery Page**
   - Select Country → State → City → District
   - Choose limit (or unlimited)
   - Click "🚀 Start Discovery"

3. **Monitor Progress**
   - Watch companies being discovered
   - Check "Companies Found" counter

4. **View Results**
   - Go to "Recent Found Data" page
   - Filter and manage discovered companies

5. **Enrich Companies**
   - Use Enrichment page
   - Queue companies for data enrichment
   - Monitor enrichment progress

---

## Troubleshooting

### Discovery Not Starting?
- ✅ Check OpenAI API key is set correctly
- ✅ Verify backend server is running
- ✅ Check browser console for errors
- ✅ Ensure city and state are selected

### No Companies Found?
- ✅ Check OpenAI API quota/credit
- ✅ Verify location filters are valid
- ✅ Check backend logs for errors
- ✅ Ensure limit is > 0 or set to 0 for unlimited

### Slow Discovery?
- ✅ OpenAI API response time varies
- ✅ Check internet connection
- ✅ Monitor OpenAI API status
- ✅ Reduce limit if experiencing delays

---

## Summary

**You are using: OpenAI-Powered Company Discovery**

This is a sophisticated system that leverages OpenAI's GPT models to generate realistic, diverse company data for any location you specify. All discovered companies are automatically saved to your database and can be further enriched with additional information.

The same discovery filters and options are now available in both the Discovery page and the Enrichment page, allowing you to discover new companies or find and enrich existing ones from a single interface.
