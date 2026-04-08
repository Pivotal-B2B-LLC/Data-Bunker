# Project Structure

## Directory Overview

```
Data-Bunker/
├── backend/                          # Node.js/Express API Server
│   ├── src/
│   │   ├── routes/                  # API route handlers
│   │   │   ├── search.js           # Search companies endpoint
│   │   │   ├── companies.js        # Company details endpoint
│   │   │   ├── locations.js        # Location/geography endpoint
│   │   │   └── filter.js           # Advanced filtering endpoint
│   │   │
│   │   ├── services/                # Data source handlers
│   │   │   ├── companiesHouse.js   # UK Companies House API integration
│   │   │   └── openCorporates.js   # Global OpenCorporates API integration
│   │   │
│   │   ├── utils/                   # Utility modules
│   │   │   ├── cache.js            # Response caching manager
│   │   │   ├── rateLimiter.js      # API rate limiting
│   │   │   └── validators.js       # Input validation schemas
│   │   │
│   │   └── middleware/              # Express middleware (future)
│   │
│   ├── server.js                    # Express server entry point
│   ├── package.json                 # Dependencies
│   └── .env.example                 # Environment variables template
│
├── frontend/                        # React.js Frontend Application
│   ├── src/
│   │   ├── components/              # Reusable React components
│   │   │   ├── LocationSelector.js # Country/state/city dropdown
│   │   │   ├── SearchBar.js        # Company name search input
│   │   │   ├── CompanyCard.js      # Company result card
│   │   │   └── CompanyDetailsModal.js # Detailed company info modal
│   │   │
│   │   ├── pages/                   # Page-level components
│   │   │   └── SearchPage.js       # Main search interface
│   │   │
│   │   ├── App.js                   # Root component
│   │   ├── App.css                  # Global styles
│   │   ├── index.js                 # React entry point
│   │   └── api.js                   # API client configuration
│   │
│   ├── public/
│   │   └── index.html               # HTML template
│   │
│   ├── package.json                 # Dependencies
│   └── .env.example                 # Environment variables template
│
├── data/                            # Static data files
│   └── locations/
│       └── index.json               # Countries, states, cities, industries
│
├── docs/                            # Documentation
│   ├── API_SOURCES.md              # API reference & integration guide
│   ├── DEVELOPMENT.md              # Adding countries & development
│   ├── DEPLOYMENT.md               # Production deployment guide
│   └── PROJECT_STRUCTURE.md        # This file
│
└── README.md                        # Project overview

```

## File Descriptions

### Backend Routes (`backend/src/routes/`)

#### `search.js`
- **Endpoints**:
  - `GET /api/search` - Search companies by name
  - `GET /api/search/by-location` - Search by location
- **Functions**:
  - Route to Companies House (UK) or OpenCorporates (global)
  - Parameter validation
  - Response formatting

#### `companies.js`
- **Endpoints**:
  - `GET /api/companies/:companyNumber` - Get company details
  - `GET /api/companies/:companyNumber/officers` - Get directors/officers
- **Functions**:
  - Fetch detailed company information
  - Handle different country data formats
  - Error handling for not found cases

#### `locations.js`
- **Endpoints**:
  - `GET /api/locations/countries` - List all countries
  - `GET /api/locations/countries/:code/states` - States in country
  - `GET /api/locations/countries/:code/states/:state/cities` - Cities in state
  - `GET /api/locations/industries` - Industry categories
- **Functions**:
  - Serve static location data
  - Validate location hierarchy

#### `filter.js`
- **Endpoints**:
  - `POST /api/filter/advanced` - Advanced filtering (future)
- **Functions**:
  - Combine multiple filter criteria
  - Query optimization

### Backend Services (`backend/src/services/`)

#### `companiesHouse.js`
- **Methods**:
  - `searchCompanies(query, options)` - Search UK companies
  - `getCompanyDetails(companyNumber)` - Fetch full company data
  - `getCompanyOfficers(companyNumber)` - Get directors
- **Features**:
  - Authentication via API key
  - Response caching (1-24 hours)
  - Error handling & rate limiting
  - Response formatting to common schema

#### `openCorporates.js`
- **Methods**:
  - `searchCompanies(query, options)` - Global company search
  - `getCompanyDetails(companyNumber, jurisdiction)` - Company details
- **Features**:
  - Jurisdiction code mapping
  - Rate limiting (5 req/min free tier)
  - Multi-country support
  - Response normalization

### Backend Utilities (`backend/src/utils/`)

#### `cache.js`
- **Methods**:
  - `get(service, params)` - Retrieve cached response
  - `set(service, params, value, ttl)` - Store response
  - `flush()` - Clear all cache
  - `getStats()` - Cache statistics
- **TTL Defaults**:
  - Company search: 1 hour
  - Company details: 24 hours
  - Location data: 7 days

#### `rateLimiter.js`
- **Methods**:
  - `isAllowed(key)` - Check if request allowed
  - `getStatus(key)` - Get remaining requests & reset time
- **Usage**:
  - Per-API rate limiting
  - Track requests within time window
  - Prevent API quota exhaustion

#### `validators.js`
- **Validators**:
  - `searchSchema` - Validate search input
  - `locationSchema` - Validate location filter
  - `companyNumberSchema` - Validate company number
- **Methods**:
  - `validateSearch(data)` - Validate & return cleaned data
  - `validateAndRespond(schema, data, res)` - Validate & send error response

### Frontend Components (`frontend/src/components/`)

#### `LocationSelector.js`
- **Props**:
  - `onLocationChange(location)` - Callback when location changes
  - `selectedCountry`, `selectedState`, `selectedCity` - Current selections
- **Features**:
  - Cascading dropdowns (country → state → city)
  - API calls to fetch options
  - Loading states and error handling
  - Default form values

#### `SearchBar.js`
- **Props**:
  - `onSearch(query)` - Callback on search submit
  - `loading` - Show loading spinner
- **Features**:
  - Text input with icon
  - Submit button with loading state
  - Clear button
  - Enter key submission

#### `CompanyCard.js`
- **Props**:
  - `company` - Company data object
  - `onViewDetails(company)` - Callback to open details
- **Features**:
  - Compact company display
  - Status badge with color coding
  - Registration number and address
  - "View Details" button
  - Link to official source

#### `CompanyDetailsModal.js`
- **Props**:
  - `show` - Modal visibility
  - `company` - Full company data
  - `onHide()` - Close callback
- **Sections**:
  - Basic information (status, registration, type, dates)
  - Registered address
  - Industry/SIC codes
  - Officers/Directors (UK only)
  - Filing status and history
  - External links

### Frontend Pages (`frontend/src/pages/`)

#### `SearchPage.js`
- **Components Used**:
  - LocationSelector
  - SearchBar
  - CompanyCard (repeated in list)
  - CompanyDetailsModal
- **State Managed**:
  - `searchQuery` - Current search term
  - `selectedLocation` - Country/state/city selection
  - `results` - Company search results
  - `selectedCompany` - Company for detail modal
  - `pagination` - Offset, limit, total count
- **Event Handlers**:
  - `handleSearch()` - Execute company search
  - `handleLocationSearch()` - Filter by location
  - `handleViewDetails()` - Open company details
  - `handlePageChange()` - Pagination

### Frontend API Client (`frontend/src/api.js`)

- **Axios Instance**:
  - Base URL: `process.env.REACT_APP_API_URL`
  - Timeout: 10 seconds
  - Interceptors for logging

- **Services**:
  - `searchService.searchCompanies(query, country, limit, offset)`
  - `searchService.searchByLocation(country, state, city, limit)`
  - `companyService.getDetails(companyNumber, country)`
  - `companyService.getOfficers(companyNumber, country)`
  - `locationService.getCountries()`
  - `locationService.getStates(countryCode)`
  - `locationService.getCities(countryCode, stateCode)`
  - `locationService.getIndustries()`

### Static Data (`data/locations/index.json`)

```json
{
  "countries": [
    {
      "code": "gb",
      "name": "United Kingdom",
      "region": "Europe",
      "dataSource": "companieshouse",
      "states": [
        {
          "code": "eng",
          "name": "England",
          "cities": ["London", "Manchester", ...]
        }
      ]
    }
  ],
  "jurisdictionCodes": {
    // Mapping of country codes to API jurisdiction codes
  },
  "industries": [
    "Technology",
    "Finance & Banking",
    ...
  ]
}
```

## Data Flow

```
User Interface (React)
        ↓
    API Client (axios)
        ↓
Backend Routes (Express)
        ↓
Services (CompaniesHouse / OpenCorporates)
        ↓
Cache (NodeCache)
        ↓
External APIs
        ↓
Response → Cache → User
```

## Adding Components/Routes

### New Route

1. Create route file in `backend/src/routes/`
2. Define endpoints with handlers
3. Import and mount in `server.js`
4. Add error handling

### New Service

1. Create service file in `backend/src/services/`
2. Implement API client logic
3. Add caching wrapper
4. Use in routes

### New Frontend Component

1. Create component in `frontend/src/components/`
2. Use React hooks for state
3. Call API via `frontend/src/api.js`
4. Import and use in pages

## Testing & Validation

### What's Validated

- **Search input**: Min 1 char, max 200 chars
- **Limit/offset**: Positive integers
- **Country codes**: 2-letter ISO codes
- **Company numbers**: Format depends on country

### Error Responses

```json
{
  "error": "Error message",
  "details": "Specific validation error",
  "type": "error_type"
}
```

## Performance Considerations

- **Caching**: Reduces API calls 80-90%
- **Pagination**: Limits results to 20-100 per page
- **Rate limiting**: Prevents API quota exceeded
- **Lazy loading**: Load officer data on demand
- **Code splitting**: Frontend bundle optimization (future)

## Security Considerations

- **API Keys**: Stored in environment variables
- **CORS**: Configured for frontend domain
- **Input validation**: All endpoints validate input
- **Data privacy**: Only public company data stored
- **HTTPS**: Enforced in production
