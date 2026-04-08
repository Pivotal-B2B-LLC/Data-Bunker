# Deployment Guide

## Prerequisites

- Node.js 16+ installed locally
- Git repository set up
- API keys obtained (Companies House, OpenCorporates)

## Local Development Setup

### 1. Clone and Install

```bash
# Clone repository
git clone <your-repo-url>
cd Data-Bunker

# Backend setup
cd backend
npm install
cp .env.example .env
# Edit .env with your API keys

# Frontend setup (new terminal)
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local with API_URL
```

### 2. Get API Keys

#### Companies House API (UK)
1. Visit https://developer.companieshouse.gov.uk/
2. Sign up for free account
3. Create API application
4. Copy API key to `backend/.env`

#### OpenCorporates API (Global)
1. Visit https://opencorporates.com/api/documentation
2. Sign up for free account (optional for basic tier)
3. Get API key from settings
4. Add to `backend/.env` (optional, works without key at lower rate)

### 3. Run Locally

```bash
# Terminal 1 - Backend
cd backend
npm start
# Backend runs on http://localhost:5000

# Terminal 2 - Frontend
cd frontend
npm start
# Frontend runs on http://localhost:3000 (opens automatically)
```

## Deploying Backend

### Option 1: Deploy to Render (Free Tier Available)

1. **Create Render Account**
   - Visit https://render.com
   - Sign up with GitHub

2. **Connect Repository**
   - Link your GitHub repository
   - Grant repository access

3. **Create Web Service**
   - Click "New +"
   - Select "Web Service"
   - Choose your repository
   - Select `backend` directory as root

4. **Configure Environment**
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Add environment variables:
     ```
     PORT=5000
     COMPANIES_HOUSE_API_KEY=your_key
     OPENCORPORATES_API_KEY=your_key
     NODE_ENV=production
     ```

5. **Deploy**
   - Click "Deploy"
   - Wait for build to complete
   - Backend URL: `https://your-app.onrender.com`

### Option 2: Deploy to Heroku (Requires Paid Plan)

```bash
# Install Heroku CLI
curl https://cli.heroku.com/install.sh | sh

# Login
heroku login

# Create app
heroku create your-app-name

# Set environment variables
heroku config:set COMPANIES_HOUSE_API_KEY=xxx
heroku config:set OPENCORPORATES_API_KEY=xxx
heroku config:set NODE_ENV=production

# Deploy
git push heroku main
```

### Option 3: Deploy to Replit

1. **Create New Replit**
   - Import from GitHub or create new

2. **Configure .env**
   - Create `.env` file with API keys

3. **Run**
   - Click "Run" button
   - Replit generates URL

## Deploying Frontend

### Option 1: Deploy to Vercel (Recommended for React)

1. **Connect Repository**
   - Visit https://vercel.com
   - Click "Import Project"
   - Select GitHub repository

2. **Configure**
   - Framework: Create React App
   - Root Directory: `frontend`
   - Build Command: `npm run build`
   - Environment Variables:
     ```
     REACT_APP_API_URL=https://your-backend.onrender.com/api
     ```

3. **Deploy**
   - Click "Deploy"
   - Wait for deployment
   - Frontend URL: `https://your-app.vercel.app`

### Option 2: Deploy to Netlify

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Build frontend
cd frontend
npm run build

# Deploy
netlify deploy --prod --dir=build
```

## Environment Configuration

### Backend (.env)

```
# Required
PORT=5000
COMPANIES_HOUSE_API_KEY=your_api_key
OPENCORPORATES_API_KEY=your_api_key

# Optional
NODE_ENV=production
RATE_LIMIT_WINDOW_MS=3600000
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
```

### Frontend (.env.local or .env.production)

```
# Required
REACT_APP_API_URL=https://your-backend-url/api

# Optional
REACT_APP_ENVIRONMENT=production
```

## Full Stack Deployment Example (Render + Vercel)

### Step 1: Deploy Backend

```bash
# Render automatically deploys from GitHub push
git add .
git commit -m "Deploy backend"
git push origin main
```

→ Backend URL: `https://data-bunker-api.onrender.com`

### Step 2: Update Frontend Environment

Edit `frontend/.env.production`:
```
REACT_APP_API_URL=https://data-bunker-api.onrender.com/api
```

### Step 3: Deploy Frontend

```bash
git add frontend/.env.production
git commit -m "Update API URL"
git push origin main
```

→ Frontend URL: `https://data-bunker.vercel.app`

## Production Checklist

- [ ] API keys configured in production environment
- [ ] CORS configured for production domain
- [ ] Environment variables not exposed in code
- [ ] Database connections use production credentials
- [ ] Rate limiting enabled
- [ ] Error logging configured
- [ ] API monitoring enabled
- [ ] Frontend built with production optimizations
- [ ] HTTPS enforced
- [ ] Security headers configured

## Monitoring

### Error Tracking

Consider integrating:
- **Sentry** (https://sentry.io/) for error tracking
- **LogRocket** for session replay
- **New Relic** for performance monitoring

### API Monitoring

```javascript
// Log API usage in backend
const logApiUsage = (service, query, count) => {
  console.log(`[METRICS] ${service} - Query: "${query}" - Results: ${count}`);
  // Send to monitoring service
};
```

## Scaling Considerations

### Phase 1 (MVP - <1000 users/day)
- Single backend instance
- Frontend on CDN (Vercel/Netlify)
- In-memory caching

### Phase 2 (Growth - 1000-10000 users/day)
- Upgrade to paid tier or multiple instances
- Add Redis for distributed caching
- Implement database for frequent queries

### Phase 3 (Production - 10000+ users/day)
- Load balancer with multiple backend instances
- Dedicated database (PostgreSQL/MongoDB)
- Message queue for async tasks
- CDN for all static assets

## Database Setup (Optional - for Caching)

### Supabase (PostgreSQL)

```bash
# Install client
npm install @supabase/supabase-js

# Create schema
CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  company_number VARCHAR(50) UNIQUE,
  country VARCHAR(2),
  name VARCHAR(255),
  data JSONB,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_country_number (country, company_number)
);
```

### MongoDB

```bash
# Install client
npm install mongodb

# Connection string
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/databunker
```

## Maintenance

### Backup Strategy

- **Code**: GitHub repository
- **API Keys**: Stored in environment (never in code)
- **Data**: Database backups (if using)

### Updates & Patches

```bash
# Check for updates
npm outdated

# Update dependencies
npm update

# Test after updates
npm test

# Deploy
git push origin main
```

## Troubleshooting

### Build Fails

```bash
# Clear cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Try building again
npm run build
```

### API Connection Issues

- Verify backend URL in frontend `.env`
- Check CORS headers in backend
- Ensure API keys are valid
- Check firewall/security group rules

### Rate Limiting Issues

Increase limits in backend `.env`:
```
RATE_LIMIT_MAX_REQUESTS=200
RATE_LIMIT_WINDOW_MS=60000
```

### Memory Issues

- Check for memory leaks
- Optimize database queries
- Implement pagination
- Use compression middleware

## Cost Estimation

### Free Tier Options
- **Render**: 0.5 CPU, 512 MB RAM (free tier)
- **Vercel**: Up to 12 serverless functions (free)
- **OpenCorporates**: 5 requests/minute (free)

### Paid Alternatives
- **Render Pro**: $7/month (2GB RAM, multiple instances)
- **AWS**: Pay-as-you-go (typically $5-50/month for small apps)
- **Heroku**: Starting at $7/month (discontinued free tier)

## References

- Render Documentation: https://render.com/docs
- Vercel Documentation: https://vercel.com/docs
- Node.js Deployment: https://nodejs.org/en/docs/guides/nodejs-web-frameworks/
