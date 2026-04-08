# FREE Alternative: Web-Based US Company Discovery

## 🆓 Zero Cost Solution

Instead of paying for OpenCorporates API, you can discover US companies **100% FREE** using web search and scraping!

## Quick Comparison

| Method | Cost | Speed | Data Quality | Officer Data |
|--------|------|-------|--------------|--------------|
| **OpenCorporates API** | $30-300/month | Fast | Official registry | ❌ No |
| **Web Discovery (FREE)** | $0 | Moderate | Real-time from web | ❌ No |

## How It Works

### FREE Method (discover-us-companies-free.js):
1. **Google Search** - Searches for companies by location + industry
2. **Business Directories** - Scrapes Yellow Pages, Yelp, etc.
3. **Website Scraping** - Visits each company site to get email/phone
4. **Auto-Enrichment** - Your existing workers continue improving data

### API Method (import-us-companies.js):
1. **Bulk Import** - Gets thousands of companies quickly
2. **Official Data** - From state business registries
3. **Registration Numbers** - Official state IDs
4. **Status Info** - Active, Dissolved, etc.

## Usage Examples

### FREE Discovery Examples:

```bash
cd backend

# Tech companies in California (FREE)
node scripts/discover-us-companies-free.js \
  --state California \
  --industry technology \
  --limit 100

# Restaurants in New York City (FREE)
node scripts/discover-us-companies-free.js \
  --state "New York" \
  --city "New York City" \
  --industry restaurant \
  --limit 200

# Law firms in Texas (FREE)
node scripts/discover-us-companies-free.js \
  --state Texas \
  --industry legal \
  --limit 150

# Healthcare in Florida (FREE)
node scripts/discover-us-companies-free.js \
  --state Florida \
  --industry healthcare

# Real estate in Arizona (FREE)
node scripts/discover-us-companies-free.js \
  --state Arizona \
  --industry "real estate" \
  --limit 100
```

### Supported Industries:
- technology / software
- healthcare / medical
- finance / banking
- legal / law
- real estate
- construction
- manufacturing
- retail / ecommerce
- restaurant / food
- consulting
- marketing / advertising
- education
- automotive
- energy
- agriculture

## Pros & Cons

### FREE Web Discovery:

**✅ Pros:**
- Zero cost (100% free)
- No API limits
- Real-time current data
- Gets active companies with websites
- Automatically enriches email/phone
- Can target specific cities/industries
- Works forever

**⚠️ Cons:**
- Slower (processes one company at a time)
- Smaller batches (100-200 companies per run)
- No official registration numbers
- Dependent on web scraping (may break if sites change)
- More manual (need to run per location/industry)

### Paid API Import:

**✅ Pros:**
- Fast bulk imports (thousands at once)
- Official state registry data
- Registration numbers included
- Company status (Active/Dissolved)
- Reliable structured data
- All companies in a state

**⚠️ Cons:**
- Costs $30-300/month
- API rate limits
- Need to manage API key
- May include inactive companies
- No officer data (need separate API)

## Recommendation by Use Case

### Choose FREE Web Discovery if:
- 🆓 **Budget**: Zero budget, want to test first
- 🎯 **Targeted**: Need specific industry/location (e.g., "tech in San Francisco")
- 🔄 **Current**: Only want active companies with websites
- 📧 **Contacts**: Priority is email/phone over official records
- 🏃 **Small Scale**: Need 100-500 companies total

### Choose Paid API Import if:
- 💰 **Budget**: Have $30-300/month budget
- 📊 **Volume**: Need thousands of companies quickly
- 🏛️ **Official**: Need official registration numbers
- 📈 **Complete**: Want all companies in a state (active + inactive)
- ⚡ **Speed**: Time-sensitive, need data fast

### Use BOTH:
1. Start with **FREE discovery** to test and build initial database
2. If you need more, upgrade to **API import** later
3. Your data and enrichment workers work the same either way!

## Mixed Strategy (Recommended)

```bash
# Month 1-2: FREE (build 500-1000 companies)
node scripts/discover-us-companies-free.js --state California --industry technology --limit 200
node scripts/discover-us-companies-free.js --state "New York" --industry finance --limit 200
node scripts/discover-us-companies-free.js --state Texas --industry energy --limit 200

# After validation: Upgrade to API ($30/month)
# Import 1,000 companies per month from OpenCorporates

# Result: 10,000+ companies over time, minimal cost
```

## Step-by-Step: FREE Discovery

### 1. Choose Your Target
```bash
STATE="California"
INDUSTRY="technology"
LIMIT=100
```

### 2. Run Discovery
```bash
cd backend
node scripts/discover-us-companies-free.js \
  --state "$STATE" \
  --industry "$INDUSTRY" \
  --limit $LIMIT
```

### 3. Monitor Progress
```bash
# Check what was found
node scripts/check-us-status.js

# View in database
docker exec data-bunker-db psql -U postgres -d databunker -c \
  "SELECT name, website, email, phone FROM companies WHERE region = '$STATE' LIMIT 10;"
```

### 4. View in UI
```
Visit: http://localhost:3000
Search for companies in your target state/industry
```

### 5. Workers Auto-Enrich
Your 40 enrichment workers automatically:
- ✅ Visit websites
- ✅ Extract better emails
- ✅ Find phone numbers
- ✅ Discover social media
- ✅ Improve data quality over time

## Geographic Coverage Examples

### Major Cities (FREE):
```bash
# San Francisco tech
node scripts/discover-us-companies-free.js --state California --city "San Francisco" --industry technology

# NYC finance
node scripts/discover-us-companies-free.js --state "New York" --city "New York City" --industry finance

# Austin tech
node scripts/discover-us-companies-free.js --state Texas --city Austin --industry technology

# Seattle software
node scripts/discover-us-companies-free.js --state Washington --city Seattle --industry software

# Boston healthcare
node scripts/discover-us-companies-free.js --state Massachusetts --city Boston --industry healthcare

# Miami real estate
node scripts/discover-us-companies-free.js --state Florida --city Miami --industry "real estate"
```

### Regions (FREE):
```bash
# West Coast tech
for state in California Washington Oregon; do
  node scripts/discover-us-companies-free.js --state "$state" --industry technology --limit 100
  sleep 60
done

# East Coast finance  
for state in "New York" Massachusetts Pennsylvania; do
  node scripts/discover-us-companies-free.js --state "$state" --industry finance --limit 100
  sleep 60
done
```

## Cost Calculation

### FREE Method:
- **Per Company**: $0
- **100 Companies**: $0
- **1,000 Companies**: $0
- **10,000 Companies**: $0
- **Forever**: $0

**Time Cost**: ~1-2 seconds per company = ~3-5 minutes for 100 companies

### Paid API Method:
- **Setup**: $30/month (Starter plan)
- **Per Company**: ~$0.03 (with starter plan)
- **100 Companies**: ~$3
- **1,000 Companies**: $30/month
- **10,000 Companies**: $300/month

**Time Cost**: Bulk import = ~10-30 minutes for 1,000 companies

## Real World Strategy

### Startup/Testing (Months 1-3):
```bash
# FREE discovery - validate your market
node scripts/discover-us-companies-free.js --state California --industry technology --limit 200
node scripts/discover-us-companies-free.js --state "New York" --industry finance --limit 200
node scripts/discover-us-companies-free.js --state Texas --industry energy --limit 100

# Result: 500 companies, $0 cost
```

### Growth (Months 4-6):
```bash
# Still FREE, expand coverage
# Add more states, industries, cities
# Build to 2,000-3,000 companies

# Result: 3,000 companies, $0 cost
```

### Scale (Month 7+):
```bash
# IF you need 10,000+ companies quickly:
# Upgrade to API ($30-300/month)

# BUT you already have 3,000 companies for free!
# Only pay for incremental growth
```

## Conclusion

**Start with FREE web discovery!**

Why?
- Zero risk
- Test your use case
- Build initial database
- Learn what data you need
- Validate before paying

You can always upgrade to the API later if you need:
- Higher volume (thousands at once)
- Official registration data
- Faster imports

**Both methods work with the same database and UI** - you're not locked in to either approach!

---

## Quick Start Commands

```bash
# Try FREE discovery right now (no setup needed):
cd backend
node scripts/discover-us-companies-free.js --state California --industry technology --limit 50

# Check results:
node scripts/check-us-status.js

# View in UI:
# Visit http://localhost:3000 and search
```

**Cost: $0**  
**Time: 5 minutes**  
**Result: 50 US companies with websites, emails, phones**
