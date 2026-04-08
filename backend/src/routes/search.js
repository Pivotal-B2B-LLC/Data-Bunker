/**
 * Search API Route
 * Endpoint: /api/search
 * 
 * AUTOMATICALLY USES DATABASE when API keys are not configured
 * No API keys needed if you have data in your database!
 */

const express = require('express');
const router = express.Router();
const companiesHouse = require('../services/companiesHouse');
const openCorporates = require('../services/openCorporates');
const googleSearchService = require('../services/googleSearchService');
const companyRepository = require('../models/companyRepository');
const { validateSearch } = require('../utils/validators');

// Check if API keys are available
const HAS_API_KEYS = !!(process.env.COMPANIES_HOUSE_API_KEY || process.env.OPENCORPORATES_API_KEY);

/**
 * GET /api/search
 * Search for companies by hierarchical location and optional name filter
 * 
 * Query Parameters:
 *   - query (optional): company name to filter (if not provided, returns all companies in location)
 *   - country (optional): 2-letter country code
 *   - state (optional): state/province code
 *   - city (optional): city name
 *   - district (optional): district/local area name
 *   - limit (optional): results per page (default: 20)
 *   - offset (optional): pagination offset (default: 0)
 * 
 * Example:
 *   GET /api/search?country=us&state=ca&city=Mountain View&limit=10
 *   GET /api/search?query=Google&country=us&state=ca&city=Mountain View&limit=10
 */
router.get('/', async (req, res) => {
  try {
    // Validate input
    const { error, value } = validateSearch({
      query: req.query.query,
      country: req.query.country,
      state: req.query.state,
      city: req.query.city,
      district: req.query.district,
      limit: parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0
    });

    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    const { query, country, state, city, district, limit, offset } = value;

    console.log(`[SEARCH] Query: "${query || 'ALL'}", Location: ${country || 'global'} → ${state || '-'} → ${city || '-'} → ${district || '-'}`);
    console.log(`[SEARCH] API Keys Available: ${HAS_API_KEYS ? 'Yes' : 'No (using database)'}`);

    let results = {};

    // ALWAYS USE DATABASE FIRST (it's faster and doesn't need API keys!)
    console.log('[SEARCH] Using local database');
    const dbFilters = {
      query,
      country: country,
      region: state,
      locality: city
    };
    
    const dbResult = await companyRepository.searchCompanies(dbFilters, limit, offset);
    
    // Format to match API response structure
    return res.json({
      success: true,
      source: 'database',
      query,
      location: {
        country: country || 'global',
        state: state || null,
        city: city || null,
        district: district || null
      },
      data: {
        companies: dbResult.companies,
        total: dbResult.total,
        pageSize: limit,
        page: Math.floor(offset / limit) + 1,
        hasMore: dbResult.hasMore
      },
      message: dbResult.companies.length === 0 ? 'No companies found with these filters' : null
    });

    // Build location-based query if no explicit search query provided
    const searchQuery = query || [district, city, state].filter(Boolean).join(' ') || '*';
    
    // For location-only searches without a query
    if (!query) {
      console.log(`[SEARCH] Location-only search: ${searchQuery}`);
    }

    // Use Companies House for UK searches, OpenCorporates for other countries
    if (country && (country.toLowerCase() === 'gb' || country.toLowerCase() === 'uk')) {
      console.log('[SEARCH] Using Companies House API');
      // For UK without query, search by location components or use wildcard
      const ukQuery = query || [city, state].filter(Boolean).join(' ') || 'ltd';
      const rawResults = await companiesHouse.searchCompanies(ukQuery, { limit: limit * 3, offset });
      
      // Filter by location if specified
      if (city || state) {
        results = {
          companies: rawResults.companies.filter(company => {
            if (!company.address) return false;
            const addr = company.address.toLowerCase();
            
            // Check city match
            if (city && !addr.includes(city.toLowerCase())) {
              return false;
            }
            
            // Check state/region match (for UK: England, Wales, Scotland, N.Ireland)
            if (state) {
              const statePatterns = {
                'england': ['england', 'london', 'manchester', 'birmingham'],
                'wales': ['wales', 'cardiff'],
                'scotland': ['scotland', 'edinburgh', 'glasgow'],
                'northern ireland': ['northern ireland', 'belfast']
              };
              const patterns = statePatterns[state.toLowerCase()] || [state.toLowerCase()];
              if (!patterns.some(p => addr.includes(p))) {
                return false;
              }
            }
            
            return true;
          }).slice(0, limit),
          total: rawResults.total,
          pageSize: limit
        };
        console.log(`[SEARCH] Filtered ${rawResults.companies.length} → ${results.companies.length} companies by location`);
      } else {
        results = rawResults;
      }
    } else if (country) {
      console.log('[SEARCH] Using OpenCorporates API');
      // OpenCorporates handles location via jurisdiction_code
      const ocQuery = query || [city, state].filter(Boolean).join(' ') || 'company';
      const rawResults = await openCorporates.searchCompanies(ocQuery, { country, limit: limit * 2, offset });
      
      // Filter by city/state if specified
      if (city || state) {
        results = {
          companies: rawResults.companies.filter(company => {
            if (!company.address) return false;
            const addr = typeof company.address === 'string' 
              ? company.address.toLowerCase() 
              : JSON.stringify(company.address).toLowerCase();
            
            if (city && !addr.includes(city.toLowerCase())) return false;
            if (state && !addr.includes(state.toLowerCase())) return false;
            
            return true;
          }).slice(0, limit),
          total: rawResults.companies.length,
          pageSize: limit
        };
        console.log(`[SEARCH] Filtered ${rawResults.companies.length} → ${results.companies.length} companies by location`);
      } else {
        results = rawResults;
      }
    } else {
      console.log('[SEARCH] Using Google Custom Search');
      results = await googleSearchService.searchCompanies(searchQuery, {
        country,
        state,
        city,
        district,
        limit,
        offset
      });
    }

    console.log(`[SEARCH] Found ${results.companies?.length || 0} companies`);

    res.json({
      success: true,
      query,
      location: {
        country: country || 'global',
        state: state || null,
        city: city || null,
        district: district || null
      },
      data: results
    });
  } catch (error) {
    console.error('[SEARCH ERROR]', {
      message: error.message,
      query: req.query.query,
      country: req.query.country
    });
    res.status(500).json({
      success: false,
      error: error.message,
      type: 'search_error'
    });
  }
});

/**
 * GET /api/search/by-location
 * Search companies by location
 * 
 * Query Parameters:
 *   - country (required)
 *   - state (optional)
 *   - city (optional)
 *   - limit (optional): results per page
 * 
 * Example:
 *   GET /api/search/by-location?country=gb&state=eng&city=London
 */
router.get('/by-location', async (req, res) => {
  try {
    const { country, state, city, limit = 20, offset = 0 } = req.query;

    if (!country) {
      return res.status(400).json({
        error: 'Country is required'
      });
    }

    // Build location query
    const locationParts = [city, state, country].filter(Boolean);
    const locationQuery = locationParts.join(', ');

    console.log(`[LOCATION SEARCH] ${locationQuery}`);

    let results = {};

    if (country.toLowerCase() === 'gb' || country.toLowerCase() === 'uk') {
      console.log('[LOCATION SEARCH] Using Companies House API');
      results = await companiesHouse.searchCompanies(locationQuery, { 
        limit: parseInt(limit), 
        offset: parseInt(offset) 
      });
    } else {
      console.log('[LOCATION SEARCH] Using OpenCorporates API');
      results = await openCorporates.searchCompanies(locationQuery, { 
        country,
        limit: parseInt(limit), 
        offset: parseInt(offset) 
      });
    }

    console.log(`[LOCATION SEARCH] Found ${results.companies?.length || 0} companies`);

    res.json({
      success: true,
      location: { country, state, city },
      data: results
    });
  } catch (error) {
    console.error('[LOCATION SEARCH ERROR]', {
      message: error.message,
      country: req.query.country
    });
    res.status(500).json({
      success: false,
      error: error.message,
      type: 'location_search_error'
    });
  }
});

module.exports = router;
