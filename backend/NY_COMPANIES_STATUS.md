# New York Companies - Status & Improvements

## Current Status (January 7, 2026)

### Database Overview
- **Total Companies**: 4,047,150
- **UK Companies**: 4,047,095 
- **US (NY) Companies**: 55

### NY Companies Data Quality
- **Total**: 55 companies
- **With Address**: 0 (0%)
- **With Phone**: 4 (7%)
- **With Email**: 1 (2%)
- **With Website**: 55 (100%)

### Issue Identified
❌ US companies are missing:
- Addresses (0%)
- Phone numbers (93% missing)
- Email addresses (98% missing)

## Improvements Implemented

### 1. Enhanced Contact Info Discovery
Added new search-based method to `webScraperService.js`:

**New Method**: `findContactInfoFromSearch(companyName, location)`

This method searches Google/Bing with queries like:
- `"Shutterstock" New York phone number`
- `"Shutterstock" New York address`  
- `"Shutterstock" New York contact`

**Benefits**:
- Finds contact info displayed directly in search snippets
- No need to scrape websites (faster, more reliable)
- Extracts phones, emails, and addresses from search results
- Works alongside existing website scraping (not replacing it)

### 2. Updated Enrichment Process
Modified `companyEnrichmentService.js` to:
1. Try website discovery (existing)
2. Scrape website for contacts (existing)
3. **NEW**: Search for contact info in Google/Bing snippets
4. Extract and save addresses, phones, emails

### 3. Address Field Support
- Added `address_line_1` to enrichment UPDATE query
- Now properly saves addresses found from search or scraping
- Uses COALESCE to preserve existing data

## How to Discover More NY Companies

### Current: 55 companies
### Potential: 1,000+ companies

### Method 1: Quick Discovery (Recommended)
```bash
cd /workspaces/Data-Bunker/backend
node scripts/discover-more-ny-companies.js 200
```

This will discover **200 new companies** by searching:
- **5 boroughs**: Manhattan, Brooklyn, Queens, Bronx, Staten Island
- **16 industries**: restaurant, retail, healthcare, legal, accounting, construction, real estate, marketing, consulting, fashion, media, technology, finance, insurance, education, transportation

**Time estimate**: ~45-60 minutes for 200 companies
**Rate limiting**: 3 seconds between searches to avoid blocks

### Method 2: Targeted Discovery
For specific industry or borough:
```javascript
const NYCompanyDiscovery = require('./scripts/discover-more-ny-companies');
const discovery = new NYCompanyDiscovery();

// Example: 50 restaurants in Brooklyn
await discovery.discoverByBorough('Brooklyn', 'restaurant', 50);
```

## Expected Improvement

After running enrichment with new search method:

| Metric | Before | After (Expected) |
|--------|--------|------------------|
| With Address | 0% | 60-70% |
| With Phone | 7% | 70-80% |
| With Email | 2% | 40-50% |

## How It Works

### Example: Enriching "Shutterstock"

**Step 1**: Website already found ✓
```
Website: https://shutterstock.com
```

**Step 2**: Scrape website (existing method)
```
Result: Company website scraped, but contact page may be hard to find
```

**Step 3**: Search for contact info (NEW method)
```
Query 1: "Shutterstock New York phone number"
→ Search snippet: "Contact Shutterstock at +1-866-663-3954..."
→ Extracted: +1-866-663-3954

Query 2: "Shutterstock New York address"  
→ Search snippet: "350 5th Avenue, 21st Floor, New York, NY 10118"
→ Extracted: 350 5th Avenue, 21st Floor, New York, NY 10118

Query 3: "Shutterstock New York contact"
→ Search snippet: "Email: support@shutterstock.com"
→ Extracted: support@shutterstock.com
```

**Result**: Company fully enriched with phone, address, and email!

## Next Steps

### 1. Discover More Companies
```bash
# Discover 200 more NY companies
node scripts/discover-more-ny-companies.js 200
```

### 2. Monitor Enrichment
Background workers will automatically enrich new companies with the improved search method.

Check progress:
```bash
docker exec -i data-bunker-db psql -U postgres -d databunker -c "SELECT COUNT(*) as total, COUNT(address_line_1) as with_address, COUNT(phone) as with_phone, COUNT(email) as with_email FROM companies WHERE jurisdiction='us_ny';"
```

### 3. Scale Up
Want 1,000+ companies? Run:
```bash
node scripts/discover-more-ny-companies.js 1000
```

**Note**: This will take ~4-5 hours due to rate limiting between searches.

## Benefits Summary

✅ **No API costs** - Uses free Google/Bing search
✅ **Better data quality** - Finds contact info in search snippets
✅ **Scalable** - Can discover thousands of companies
✅ **Diverse coverage** - All boroughs, 16+ industries
✅ **Automatic enrichment** - Background workers process new companies
✅ **Preserves existing data** - Won't overwrite good data with empty values

## Technical Details

### Files Modified
1. `backend/src/services/webScraperService.js`
   - Added `findContactInfoFromSearch()` method
   - Added `_extractAddressFromText()` helper

2. `backend/src/services/companyEnrichmentService.js`
   - Integrated search-based contact discovery
   - Added address_line_1 to UPDATE query

3. `backend/scripts/discover-more-ny-companies.js` (NEW)
   - Automated company discovery by borough + industry
   - Bing search integration
   - Deduplication logic

### Rate Limiting
- 3 seconds between searches (20 searches/minute)
- ~1,200 searches/hour max
- Conservative to avoid IP blocks

### Search Patterns
Phone: `"Company Name" location phone number`
Address: `"Company Name" location address`
Contact: `"Company Name" location contact`

### Extraction Patterns
- **US Phone**: `(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}`
- **US Address**: `\d+ [A-Z][a-zA-Z\s]+ (Street|Ave|Blvd...), City, ST ZIP`
- **Email**: `[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+`
