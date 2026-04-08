# 100% FREE Company Discovery Guide

## No Payment Required! 🎉

Discover real, verified companies using **completely FREE APIs** - no credit card needed!

---

## Quick Start (Zero Setup Required!)

### Option 1: OpenStreetMap Only (NO API KEY NEEDED!)

```bash
cd backend
node scripts/discover-free.js "Birmingham" "Alabama" "United States" 50
```

**This works immediately with ZERO setup!** OpenStreetMap is always available and requires no API key.

---

## Free APIs Available

### 1. 🗺️ **OpenStreetMap** (Completely Free Forever)
- **Cost**: $0 forever
- **Setup**: None! Works immediately
- **API Key**: Not needed
- **Limit**: Unlimited (with reasonable delays)
- **Coverage**: Global
- **Data**: Business names, addresses, phone, websites

**How to use:**
```bash
# Just run it - works immediately!
node scripts/discover-free.js "London" "England" "United Kingdom" 100
```

---

### 2. 🍔 **Yelp Fusion API** (5,000 calls/day FREE)
- **Cost**: $0 (up to 5,000 calls/day)
- **Setup**: 5 minutes
- **Limit**: 5,000 requests per day (FREE!)
- **Coverage**: US, Canada, UK, and more
- **Data**: Business info, ratings, reviews, photos

**How to get FREE Yelp API key:**

1. Go to https://www.yelp.com/developers
2. Click "Create App" (no credit card!)
3. Fill in:
   - App Name: "Data Bunker"
   - Industry: "Business Services"
   - Contact Email: your email
4. Accept terms → Get API Key!
5. Add to `.env`:
```bash
YELP_API_KEY=your-key-here
```

**Cost Breakdown:**
- First 5,000 calls/day: **FREE**
- That's 5,000 companies/day for $0!

---

### 3. 🗺️ **Bing Maps API** (FREE Tier)
- **Cost**: $0 (up to 125,000 transactions/year)
- **Setup**: 10 minutes
- **Limit**: 125,000 free transactions/year
- **Coverage**: Global
- **Data**: Business locations, addresses, phone

**How to get FREE Bing Maps key:**

1. Go to https://www.bingmapsportal.com/
2. Sign in with Microsoft account (free)
3. Click "My account" → "My keys"
4. Click "Create new key"
5. Select:
   - App name: "Data Bunker"
   - Key type: "Basic"
   - App type: "Dev/Test"
6. Copy your key!
7. Add to `.env`:
```bash
BING_MAPS_API_KEY=your-key-here
```

**Cost Breakdown:**
- 0 - 125,000 transactions/year: **FREE**
- That's ~10,400 free companies/month!

---

### 4. 🏢 **Companies House API** (UK Only - FREE Forever)
- **Cost**: $0 forever
- **Setup**: 5 minutes
- **Limit**: 600 requests per 5 minutes
- **Coverage**: UK only
- **Data**: Official UK company records, directors, addresses

**How to get FREE Companies House key:**

1. Go to https://developer.company-information.service.gov.uk/
2. Click "Register" (free, no credit card)
3. Create account
4. Go to "Your applications"
5. Click "Create new application"
6. Get your API key!
7. Add to `.env`:
```bash
COMPANIES_HOUSE_API_KEY=your-key-here
```

**Cost Breakdown:**
- Unlimited searches: **FREE** (with rate limits)

---

## Setup Instructions

### Step 1: Choose Your Free APIs

Pick ANY combination (or use NONE and rely on OpenStreetMap):

- ✅ **OpenStreetMap** - Already works, no setup!
- ✅ **Yelp** - 5 min setup, 5,000/day free
- ✅ **Bing Maps** - 10 min setup, 125,000/year free
- ✅ **Companies House** - 5 min setup (UK only), unlimited free

### Step 2: Add Keys to `.env`

Edit your `.env` file:

```bash
# FREE API Keys (All optional - OpenStreetMap works without any keys!)
YELP_API_KEY=your-yelp-key-here
BING_MAPS_API_KEY=your-bing-key-here
COMPANIES_HOUSE_API_KEY=your-uk-key-here
```

### Step 3: Restart Backend

```bash
cd backend
npm run dev
```

### Step 4: Run Discovery!

```bash
# Test with OpenStreetMap only (no keys needed!)
node scripts/discover-free.js "Birmingham" "Alabama" "United States" 20

# With Yelp added (better results)
node scripts/discover-free.js "San Francisco" "California" "United States" 50

# UK with Companies House
node scripts/discover-free.js "London" "England" "United Kingdom" 100
```

---

## Usage Examples

### United States (All Free APIs):
```bash
node scripts/discover-free.js "New York" "New York" "United States" 100
node scripts/discover-free.js "Los Angeles" "California" "United States" 75
node scripts/discover-free.js "Chicago" "Illinois" "United States" 50
```

### United Kingdom (with Companies House):
```bash
node scripts/discover-free.js "London" "England" "United Kingdom" 100
node scripts/discover-free.js "Manchester" "England" "United Kingdom" 50
node scripts/discover-free.js "Edinburgh" "Scotland" "United Kingdom" 50
```

### Canada (Yelp + Bing):
```bash
node scripts/discover-free.js "Toronto" "Ontario" "Canada" 50
node scripts/discover-free.js "Vancouver" "British Columbia" "Canada" 50
```

---

## Free API Comparison

| API | Setup Time | Daily Limit | Coverage | Credit Card? |
|-----|------------|-------------|----------|--------------|
| **OpenStreetMap** | 0 min ⚡ | Unlimited* | Global 🌍 | No ❌ |
| **Yelp** | 5 min | 5,000 | 20+ countries | No ❌ |
| **Bing Maps** | 10 min | 342/day† | Global 🌍 | Yes‡ |
| **Companies House** | 5 min | 600/5min | UK only 🇬🇧 | No ❌ |

*With reasonable delays (1 second between requests)
†125,000 per year = ~342 per day
‡Required for signup but never charged on free tier

---

## Cost Comparison

### Discovery of 100 Real Companies:

| Method | Cost | Setup Time |
|--------|------|------------|
| **Google Places** | $3-5 | 10 min |
| **OpenStreetMap** | **$0** ✅ | **0 min** ✅ |
| **Yelp (Free)** | **$0** ✅ | 5 min |
| **Bing (Free)** | **$0** ✅ | 10 min |
| **Companies House (UK)** | **$0** ✅ | 5 min |
| **All Free APIs Combined** | **$0** ✅ | 20 min |

---

## Which Option Should I Choose?

### No time to setup? → Use OpenStreetMap
```bash
# Works immediately, no setup!
node scripts/discover-free.js "Your City" "Your State" "Your Country" 50
```

### Want best results? → Add Yelp (5 min)
- Free 5,000 calls/day
- Best business data
- High-quality ratings and reviews

### Need UK companies? → Add Companies House (5 min)
- Official UK company registry
- 100% free forever
- Directors, addresses, company numbers

### Want maximum free data? → Add all free APIs (20 min)
- OpenStreetMap (no key)
- Yelp (5 min setup)
- Bing Maps (10 min setup)
- Companies House (5 min setup, UK only)

---

## Update Discovery Route (Optional)

To make the frontend use the free discovery by default:

Edit `backend/src/routes/discovery.js`:

```javascript
// Change line 63 from:
const scriptPath = path.join(__dirname, '../../scripts/discover-real-companies.js');

// To:
const scriptPath = path.join(__dirname, '../../scripts/discover-free.js');
```

Then restart the backend!

---

## Troubleshooting

### "City not found in OpenStreetMap"
- Try adding the country: "Birmingham, Alabama, United States"
- Use full state names, not abbreviations

### "Yelp rate limit reached"
- You've hit 5,000 calls/day (that's a lot!)
- Wait until tomorrow or use other free APIs

### "No results found"
- Some small cities have limited data
- Try a nearby larger city
- Increase the limit parameter

---

## Summary

### ✅ What's FREE:
- OpenStreetMap - No setup, works now!
- Yelp - 5,000 companies/day
- Bing Maps - 125,000 transactions/year
- Companies House - Unlimited (UK only)

### ✅ What You Get:
- Real, verified companies
- Actual phone numbers and addresses
- Business ratings and reviews
- Websites and contact info
- 100% legitimate data

### 💰 Total Cost:
**$0.00** - Completely FREE!

---

## Next Steps

1. **Try it now** (no setup needed):
   ```bash
   cd backend
   node scripts/discover-free.js "Birmingham" "Alabama" "United States" 20
   ```

2. **Add Yelp** (5 min) for better results

3. **Add other free APIs** as needed

4. **Scale up** - discover thousands of companies for $0!

---

**Questions?** Check the script output - it tells you which APIs are active and how to add more!
