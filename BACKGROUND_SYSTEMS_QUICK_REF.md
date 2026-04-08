# 🚀 BACKGROUND SYSTEMS - QUICK REFERENCE

## ✅ Current Status: RUNNING

### Active Systems
- 🔍 **Discovery**: Finding ALL NY companies (17,019 searches planned)
- 💼 **Enrichment**: 40 workers adding contacts, officers, addresses
- 📊 **Progress**: Auto-saved every 50 searches

---

## 🎮 Essential Commands

### Check Status
```bash
# Quick check
ps aux | grep -E "(discovery|enrichment)" | grep -v grep

# Detailed stats
bash /workspaces/Data-Bunker/backend/scripts/monitor-status.sh
```

### View Live Logs
```bash
# Discovery (companies being found)
tail -f /workspaces/Data-Bunker/backend/logs/discovery.log

# Enrichment (contacts being added)
tail -f /workspaces/Data-Bunker/backend/logs/enrichment.log
```

### Database Stats
```bash
docker exec -i data-bunker-db psql -U postgres -d databunker -c "
SELECT 
  jurisdiction,
  COUNT(*) as total,
  COUNT(website) as websites,
  COUNT(phone) as phones,
  COUNT(email) as emails,
  COUNT(address_line_1) as addresses
FROM companies 
WHERE jurisdiction IN ('gb', 'us_ny')
GROUP BY jurisdiction;
"
```

### Stop Systems (if needed)
```bash
bash /workspaces/Data-Bunker/backend/scripts/stop-all-background.sh
```

### Restart Systems
```bash
bash /workspaces/Data-Bunker/backend/scripts/start-all-background.sh
```

---

## 📊 Expected Progress

| Time | Companies Found | Enriched | Areas Completed |
|------|-----------------|----------|-----------------|
| Now  | 55              | ~10      | 0               |
| 1h   | 100-150         | 50-80    | 50-100          |
| 6h   | 500-800         | 200-400  | 300-600         |
| 12h  | 1,000-2,000     | 500-1,000| 1,000-1,500     |
| 24h  | 5,000-10,000    | 2,000-5,000 | ALL (17,019) |

---

## 📁 Important Files

### Progress Tracking
- `backend/data/ny-completed-areas.json` - List of searched areas
- `backend/data/ny-discovery-stats.json` - Statistics

### Logs
- `backend/logs/discovery.log` - Company discovery
- `backend/logs/enrichment.log` - Contact enrichment

### PID Files
- `backend/discovery.pid` - Discovery process ID
- `backend/enrichment-workers.pid` - Worker process IDs

---

## 🎯 What's Being Found

### Locations (183 neighborhoods)
- Manhattan: Financial District, SoHo, Midtown, Harlem...
- Brooklyn: Williamsburg, DUMBO, Park Slope...
- Queens: Astoria, Flushing, Long Island City...
- Bronx: Fordham, Riverdale, Hunts Point...
- Staten Island: St. George, Tottenville...

### Industries (93 types)
restaurants, cafes, retail, healthcare, legal, accounting, construction, real estate, marketing, tech, finance, and 80+ more

### Contact Info Methods
1. **Website scraping** - from company websites
2. **🆕 Search snippets** - from Google/Bing results
   - `"Company" + phone number`
   - `"Company" + address`
   - `"Company" + contact`
3. **Companies House** - UK officers (already working)

---

## 🔥 Systems Will Continue Running Until:

1. All 17,019 searches completed (~12-24 hours)
2. Manually stopped with stop script
3. Server restart/shutdown

**Progress is saved continuously - can resume anytime!**

---

## 📞 What Each System Does

### Discovery System
- Searches Bing for companies in each neighborhood/industry
- Extracts company name and website from results
- Checks for duplicates
- Saves to database with jurisdiction='us_ny'
- Tracks completed areas

### Enrichment Workers (40 workers)
For EACH company:
1. Find website (if missing)
2. Scrape website for contacts
3. **NEW**: Search Google/Bing for phone/email/address
4. Extract from search snippets
5. Save to database
6. **UK companies**: Fetch officers from Companies House

---

## ✅ Completed Features

✅ Comprehensive location coverage (183 neighborhoods)  
✅ Comprehensive industry coverage (93 types)  
✅ Multiple search patterns (7 per location/industry)  
✅ Progress auto-save (every 50 searches)  
✅ Duplicate prevention  
✅ Search-based contact discovery (NEW)  
✅ Website scraping  
✅ UK officer enrichment  
✅ Address extraction (NEW)  
✅ Graceful shutdown  
✅ Resume capability  

---

## 🎉 All Systems Active NOW!

Check status anytime: `bash scripts/monitor-status.sh`
