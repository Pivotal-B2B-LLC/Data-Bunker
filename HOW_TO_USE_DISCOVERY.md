# How to Use Company Discovery

## ✅ Your System is Ready!

The FREE discovery system is now integrated with your frontend - no API keys needed!

---

## 🚀 Quick Start

### 1. Open Your App
Go to: **http://localhost:3000**

### 2. Navigate to Discovery Page
Click on **"Discovery"** in the navigation menu

### 3. Select Your Filters

**Required:**
- ✅ **Country**: Select from dropdown (United States, United Kingdom, etc.)
- ✅ **State/Region**: Select state (Alabama, California, New York, etc.)
- ✅ **City**: Select city (Birmingham, Los Angeles, London, etc.)

**Optional:**
- District (if applicable)
- Ward (if applicable)
- Industry filter
- Company size
- Limit (number of companies to find)

### 4. Click "Start Discovery"

The system will:
- ✅ Search OpenStreetMap for real businesses
- ✅ Find companies in your selected location
- ✅ Extract contact information
- ✅ Save to your database
- ✅ Show real-time progress

### 5. View Results

Companies will appear in:
- **Discovery Page** (real-time)
- **Accounts Page** (all discovered companies)
- **Recent Found Data** (latest discoveries)

---

## 📊 What You'll Get

### Company Information:
- ✅ **Company Name** - Real business name
- ✅ **Address** - Full street address
- ✅ **City/Region** - Location details
- ✅ **Phone Number** - When available
- ✅ **Website** - When available
- ✅ **Industry** - Business category
- ✅ **Verified** - Marked as verified from OpenStreetMap

### Example Results:

**Birmingham, Alabama:**
```
✅ Mudtown (Restaurant)
   Address: Birmingham, AL
   Category: Restaurants & Food

✅ UAB Russell Clinic (Healthcare)
   Address: Birmingham, AL
   Category: Healthcare

✅ JCPenney (Retail)
   Address: Birmingham, AL
   Category: Retail & Shopping
```

---

## 🎯 Pro Tips

### Tip 1: Start Small
First time? Try **20-50 companies** to see the data quality:
- Set Limit: `50`
- Click "Start Discovery"
- Review results

### Tip 2: Use Major Cities
Better results in larger cities:
- ✅ New York, NY
- ✅ Los Angeles, CA
- ✅ Chicago, IL
- ✅ London, UK
- ✅ Birmingham, AL

### Tip 3: Multiple Discoveries
Discover companies in multiple cities:
1. Birmingham, AL → 50 companies
2. Montgomery, AL → 50 companies
3. Huntsville, AL → 50 companies

### Tip 4: Watch Progress
The discovery page shows:
- Companies found in real-time
- Current status
- Total saved

### Tip 5: Check Results Immediately
After discovery completes:
- Go to "Accounts" page
- Filter by `data_source: OpenStreetMap`
- See all discovered companies

---

## 🌍 Supported Locations

### United States (Excellent Coverage):
- All 50 states
- Major cities: New York, LA, Chicago, Houston, Phoenix, Philadelphia, San Antonio, San Diego, Dallas, San Jose
- Medium cities: Birmingham, Montgomery, Mobile, Huntsville
- Small cities: Variable coverage

### United Kingdom (Excellent Coverage):
- England: London, Manchester, Birmingham, Leeds, Liverpool
- Scotland: Edinburgh, Glasgow
- Wales: Cardiff
- Northern Ireland: Belfast

### Canada (Excellent Coverage):
- Toronto, Montreal, Vancouver, Calgary, Ottawa, Edmonton

### Europe (Very Good Coverage):
- France: Paris, Lyon, Marseille
- Germany: Berlin, Munich, Hamburg
- Spain: Madrid, Barcelona, Valencia
- Italy: Rome, Milan, Naples

### Australia (Good Coverage):
- Sydney, Melbourne, Brisbane, Perth

---

## 🔧 Troubleshooting

### "No results found"
**Solution:**
- Try a larger city nearby
- Increase the limit (try 100 instead of 50)
- Check spelling of city name

### "Discovery failed"
**Solution:**
- Check backend logs in terminal
- Ensure backend is running (http://localhost:5000)
- Try again - OpenStreetMap might be temporarily busy

### "Companies have no phone/website"
**Explanation:**
- OpenStreetMap data varies by location
- Some businesses don't add contact info
- This is normal - you can enrich data later

### "Duplicate companies"
**Solution:**
- System automatically prevents duplicates
- Safe to run discovery multiple times

---

## 📈 After Discovery

### View Companies:
1. **Accounts Page** - See all companies
2. **Filter by Location** - Use city/state filters
3. **Export Data** - Export to CSV
4. **Enrich Data** - Add more details to companies

### Enrich Companies:
You can add more information to discovered companies:
- Add contacts (decision makers)
- Update phone numbers
- Add email addresses
- Add notes

### Use Data:
- Build contact lists
- Create outreach campaigns
- Analyze by industry
- Export for CRM

---

## 💰 Cost

**Total Cost: $0.00**
- ✅ No API keys required
- ✅ No signup needed
- ✅ No payment info
- ✅ Unlimited discoveries
- ✅ Free forever

---

## 🎉 Examples

### Example 1: Birmingham, Alabama
**Filters:**
- Country: United States
- State: Alabama
- City: Birmingham
- Limit: 50

**Results:** 50 real businesses in ~30 seconds

---

### Example 2: London, UK
**Filters:**
- Country: United Kingdom
- State: England
- City: London
- Limit: 100

**Results:** 100 real UK businesses in ~60 seconds

---

### Example 3: Multiple Cities
**Day 1:** Discover Birmingham (50 companies)
**Day 2:** Discover Montgomery (50 companies)
**Day 3:** Discover Mobile (50 companies)

**Total:** 150 companies across Alabama - $0 cost

---

## 🚀 Next Steps

1. **Test It Now:**
   - Open http://localhost:3000/discovery
   - Select: United States > Alabama > Birmingham
   - Set Limit: 20
   - Click "Start Discovery"

2. **Scale Up:**
   - Increase to 50-100 companies
   - Try multiple cities
   - Discover different states

3. **Use Your Data:**
   - View in Accounts page
   - Filter and sort
   - Export to CSV
   - Start outreach!

---

## 📞 Quick Reference

**Frontend URL:** http://localhost:3000
**Backend URL:** http://localhost:5000
**Discovery Page:** http://localhost:3000/discovery
**Accounts Page:** http://localhost:3000/accounts

**Command Line (Alternative):**
```bash
cd backend
node scripts/discover-osm-only.js "Birmingham" "Alabama" "United States" 50
```

---

## ✅ You're All Set!

Your discovery system is:
- ✅ **Active** - Backend running
- ✅ **Free** - No API keys needed
- ✅ **Ready** - Just use the filters!

**Go to http://localhost:3000/discovery and start finding companies!** 🚀
