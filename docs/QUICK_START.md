# Quick Start Guide

## 5-Minute Setup

### 1. Get API Keys (2 minutes)

#### Companies House (UK)
1. Go to https://developer.companieshouse.gov.uk/
2. Sign up or log in
3. Click "Create a new application"
4. Accept terms
5. Copy your API key

#### OpenCorporates (Global)
1. Go to https://opencorporates.com/api
2. Create free account (optional)
3. Copy your API key (leave empty to use free tier with rate limits)

### 2. Configure Project (2 minutes)

```bash
# Backend configuration
cd backend
cp .env.example .env

# Edit .env - paste your API keys
nano .env
```

Contents of `backend/.env`:
```
PORT=5000
NODE_ENV=development
COMPANIES_HOUSE_API_KEY=your_key_here
OPENCORPORATES_API_KEY=your_key_here
RATE_LIMIT_WINDOW_MS=3600000
RATE_LIMIT_MAX_REQUESTS=100
```

```bash
# Frontend configuration
cd ../frontend
cp .env.example .env.local

# Edit .env.local
nano .env.local
```

Contents of `frontend/.env.local`:
```
REACT_APP_API_URL=http://localhost:5000/api
```

### 3. Install & Run (1 minute)

**Terminal 1 - Backend:**
```bash
cd backend
npm install
npm start
```

Expected output:
```
╔════════════════════════════════════════╗
║     Data Bunker Backend Server         ║
╠════════════════════════════════════════╣
║ 🚀 Server running on http://localhost:5000
║ 📊 Environment: development
║ 🔑 Companies House API: ✓
║ 🌍 OpenCorporates API: ✓
╚════════════════════════════════════════╝
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm start
```

Frontend automatically opens at `http://localhost:3000`

## First Search

1. **Select Location**: Choose country → state → city
2. **Search**: Type company name (e.g., "Google", "Apple")
3. **View Results**: Click on company card
4. **See Details**: Click "View Details" for full information

## Example Searches

### United Kingdom (Companies House)
- Search: "Google UK Limited"
- Location: United Kingdom → England → London
- Registration: 03404908

### United States (OpenCorporates)
- Search: "Apple Inc"
- Location: United States → California → Cupertino
- Registration: 942404

### Global (OpenCorporates)
- Search: "Microsoft"
- Country: Any supported country
- Will find local subsidiaries

## Troubleshooting

### "Please select a country first"
→ Make sure to select a country in the location filter before searching

### API Key Error
→ Check your `.env` file has the correct keys:
```bash
cat backend/.env | grep API_KEY
```

### Port Already in Use
→ Change port in `.env`:
```
PORT=5001
```

### CORS Error
→ Make sure frontend `.env` has correct API URL:
```
REACT_APP_API_URL=http://localhost:5000/api
```

## What's Included

✅ Full-stack application (backend + frontend)
✅ Companies House API integration (UK)
✅ OpenCorporates API integration (150+ countries)
✅ Location filtering (country → state → city)
✅ Company details view (registration, address, officers)
✅ Response caching (reduces API calls)
✅ Rate limiting (prevents quota exceeded)
✅ Responsive design (mobile-friendly)
✅ Error handling & validation
✅ Production-ready code structure

## Next Steps

### Add More Countries
1. Edit `data/locations/index.json`
2. Add country with states/cities
3. Update search routes to use OpenCorporates
4. See [DEVELOPMENT.md](DEVELOPMENT.md)

### Deploy to Production
1. Follow [DEPLOYMENT.md](DEPLOYMENT.md)
2. Deploy backend to Render
3. Deploy frontend to Vercel
4. Update API URLs

### Add Database
1. Set up Supabase or MongoDB
2. Cache frequent searches
3. Store user favorites
4. Track analytics

### Customize UI
1. Modify `frontend/src/App.css`
2. Update `frontend/src/pages/SearchPage.js`
3. Add new components as needed
4. Deploy to Vercel

## API Documentation

### Search Companies
```bash
curl -X GET "http://localhost:5000/api/search?query=Google&country=gb&limit=10"
```

### Get Company Details
```bash
curl -X GET "http://localhost:5000/api/companies/03404908?country=gb"
```

### Get Locations
```bash
curl -X GET "http://localhost:5000/api/locations/countries"
```

See [API_SOURCES.md](API_SOURCES.md) for full API documentation.

## Project Structure

```
Data-Bunker/
├── backend/           # Node.js API server
├── frontend/          # React web app
├── data/              # Location & config data
└── docs/              # Documentation
```

See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for detailed structure.

## Getting Help

1. Check [API_SOURCES.md](API_SOURCES.md) for API reference
2. Read [DEVELOPMENT.md](DEVELOPMENT.md) for adding features
3. Follow [DEPLOYMENT.md](DEPLOYMENT.md) for production
4. Review [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for codebase

## Commands Reference

```bash
# Backend
npm install          # Install dependencies
npm start           # Start dev server
npm test            # Run tests

# Frontend
npm install         # Install dependencies
npm start           # Start dev server
npm run build       # Build for production
npm test            # Run tests

# Global
git status          # Check changes
git add .           # Stage all
git commit -m ""    # Commit
git push            # Push to GitHub
```

---

**Ready to search for companies? Launch the app and start exploring!** 🚀
