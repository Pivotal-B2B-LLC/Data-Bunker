# Data Bunker - Global Company Search Platform

A web application for finding and displaying active companies from around the globe using public, legal data sources.

## 🎯 No API Keys Required!

**You already have millions of UK companies in your database!** You can start using Data Bunker immediately without any API keys.

## Quick Start (Database Only - No Setup Needed!)

```bash
# Start the containers
docker-compose up -d

# Your API is ready!
curl http://localhost:5000/api/db/search?query=tesco&limit=10
```

**Available immediately:**
- ✅ **4+ million UK companies** in PostgreSQL database
- ✅ **No API keys needed** - uses your local database
- ✅ **No rate limits** - it's your own data
- ✅ **Fast searches** - indexed database queries

📖 See [DATABASE_FIRST_APPROACH.md](docs/DATABASE_FIRST_APPROACH.md) for all available endpoints.

## Overview

Data Bunker enables users to:
- Search for companies by name, location, or industry **from your database**
- Filter by country → state/province → city
- View company details (name, registration number, address, status, industry)
- Optionally connect external APIs for real-time updates
- Save favorite companies locally

## Two Ways to Use Data Bunker

### Option 1: Database Only (Recommended - No Setup!)

Uses your local PostgreSQL database with millions of companies already loaded.

**Endpoints:**
- `/api/db/search` - Search your database
- `/api/db/companies/:number` - Get company details
- `/api/db/companies` - Add/update companies

**Advantages:**
- ✅ No API keys needed
- ✅ No rate limits
- ✅ Fast local queries
- ✅ Works offline
- ✅ 4+ million UK companies available

### Option 2: External APIs (Optional)

Connect to external APIs for real-time data and companies not in your database.

**Setup:**
1. Get API keys:
   - **Companies House**: https://developer.companieshouse.gov.uk/
   - **OpenCorporates**: https://opencorporates.com/api

2. Configure `backend/.env`:
```
COMPANIES_HOUSE_API_KEY=your_key_here
OPENCORPORATES_API_KEY=your_key_here
```

**Endpoints:**
- `/api/search` - Searches external APIs (falls back to database if no keys)
- `/api/companies/:number` - Gets from external APIs (falls back to database)

## Installation

### Using Docker (Recommended)

```bash
# Clone and start
git clone https://github.com/yourusername/Data-Bunker.git
cd Data-Bunker
docker-compose up -d

# Database is ready with 4+ million companies!
curl http://localhost:5000/api/db/search?limit=5
```

### Manual Setup

```bash
# Backend
cd backend
npm install
npm start

# Frontend (new terminal)
cd frontend
npm install
npm start
```

Visit `http://localhost:3000`

## Features (MVP)

✅ Company search by name & location  
✅ Filter by country → state → city  
✅ Company details display  
✅ Companies House integration (UK)  
✅ Rate limiting & caching  

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: React.js + Axios
- **APIs**: Companies House, OpenCorporates, SEC EDGAR
- **Hosting**: Replit/Vercel/Render

## Documentation

- [API Sources](docs/API_SOURCES.md) - Detailed API reference
- [Development](docs/DEVELOPMENT.md) - Adding countries & sources
- [Deployment](docs/DEPLOYMENT.md) - Production setup

## Roadmap

- **Phase 1**: UK MVP (Companies House)
- **Phase 2**: Global (OpenCorporates + 20 countries)
- **Phase 3**: Advanced (accounts, exports, analytics)
