# Real Company Discovery Setup Guide

## Overview

Your discovery system has been upgraded to find **REAL, VERIFIED companies** using legitimate APIs instead of generating fake data.

## What Changed

### Before:
- ❌ Generated fake company names like "Central Bistro", "London Shop"
- ❌ Random phone numbers and emails
- ❌ Fictitious contact data
- ❌ No verification

### After:
- ✅ Real companies from Google Places API
- ✅ Verified business addresses and phone numbers
- ✅ Actual websites and ratings
- ✅ UK companies from Companies House API (optional)
- ✅ All data validated and marked as verified

---

## API Setup Required

### 1. Google Places API (Required for all regions)

**Get your API key:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable these APIs:
   - Places API
   - Places API (New)
   - Geocoding API
4. Go to "Credentials" → "Create Credentials" → "API Key"
5. Copy your API key

**Add to `.env` file:**
```bash
GOOGLE_PLACES_API_KEY=AIzaSy...your-key-here
```

**Pricing:**
- $17 per 1,000 requests (Text Search)
- $17 per 1,000 requests (Place Details)
- Free tier: $200/month credit
- Discovery of 100 companies ≈ $3-5

### 2. Companies House API (Optional - UK only)

**Get your API key:**
1. Go to [Companies House Developer Hub](https://developer.company-information.service.gov.uk/)
2. Register for an account
3. Create an API key

**Add to `.env` file:**
```bash
COMPANIES_HOUSE_API_KEY=your-key-here
```

**Pricing:**
- Free for basic usage
- Rate limited to 600 requests/5 minutes

---

## How It Works

### Discovery Process:

1. **Search by Industry & Location**
   - Searches Google Places for "restaurant in London", "law firm in Birmingham", etc.
   - Searches all 18 industries: Restaurant, Retail, Healthcare, Legal, etc.

2. **Verify Business Status**
   - Checks if business is operational
   - Validates address and location
   - Confirms rating and reviews

3. **Extract Real Data**
   - Business name
   - Full address
   - Phone number (verified)
   - Website
   - Google Maps rating
   - Number of reviews
   - Business type

4. **Save to Database**
   - Marks as `verified: true`
   - Tags with `data_source: "Google Places"`
   - Prevents duplicates
   - Links to Google Place ID for updates

---

## Usage

### From the Frontend:
1. Go to Discovery Page
2. Select Country, Region, City
3. Click "Start Discovery"
4. System will find real, verified companies

### From Command Line:
```bash
# United States
node backend/scripts/discover-real-companies.js "Birmingham" "Alabama" "United States" 50

# United Kingdom
node backend/scripts/discover-real-companies.js "London" "England" "United Kingdom" 100

# Any location
node backend/scripts/discover-real-companies.js <city> <region> <country> <limit>
```

---

## Database Changes

New fields added to `accounts` table:
- `rating` - Google rating (1.0-5.0)
- `total_ratings` - Number of reviews
- `place_id` - Google Place ID for updates
- `verified` - Boolean flag (true for real companies)
- `data_source` - "Google Places" or "Companies House"
- `address` - Full verified address
- `district` - District/area within city
- `ward` - Ward/parish (UK)

---

## API Quotas & Limits

### Google Places API:
- **Free tier**: $200/month credit
- **Cost**: ~$3-5 per 100 companies
- **Rate limit**: Reasonable delays built-in
- **Recommended**: Start with 50 companies to test

### Best Practices:
1. Start with small limits (20-50 companies)
2. Monitor your Google Cloud billing dashboard
3. Set up billing alerts
4. Use caching (built-in, 24-hour cache)

---

## Fallback Options

If you don't have API keys yet, you can:

1. **Use the old fake generator** (for testing only):
   ```bash
   node backend/scripts/discover-with-openai.js "London" "England" 100
   ```
   ⚠️ This generates FAKE data - not suitable for production

2. **Manual import**: Use the enrichment feature to add real companies manually

3. **Wait**: The system will show a clear error message if no API keys are configured

---

## Verification

All discovered companies have:
- ✅ `verified: true` flag in database
- ✅ `data_source` field showing API used
- ✅ Real phone numbers and addresses
- ✅ Actual websites (where available)
- ✅ Google Maps ratings and reviews
- ✅ Confirmed operational status

---

## Support

If you need help:
1. Check API key is correctly added to `.env`
2. Restart backend server after adding keys
3. Check Google Cloud Console for API enablement
4. Monitor backend logs for detailed error messages

---

## Next Steps

1. **Get Google Places API key** (required)
2. Add to `.env` file
3. Restart backend server: `npm run dev`
4. Test with small discovery (20-50 companies)
5. Monitor costs in Google Cloud Console
6. Scale up as needed!
