/**
 * Database API Routes
 */

const express = require('express');
const path = require('path');
const router = express.Router();
const companyRepository = require('../models/companyRepository');
const webTrackingService = require('../services/webTrackingService');

const locationsData = require(path.join(__dirname, '../../../data/locations/index.json'));

const HIGH_LEVEL_UK_REGIONS = new Set(['england', 'scotland', 'wales', 'northern ireland']);
const DEFAULT_LIMIT = parseInt(process.env.DB_SEARCH_DEFAULT_LIMIT || '50', 10);
const MAX_LIMIT = parseInt(process.env.DB_SEARCH_MAX_LIMIT || '10000', 10);

const findStateName = (countryCode, stateValue) => {
  if (!countryCode || !stateValue) return null;

  const normalizedCountry = countryCode.toLowerCase();
  const countryAliasMap = { uk: 'gb' };
  const resolvedCountry = countryAliasMap[normalizedCountry] || normalizedCountry;
  const normalizedState = stateValue.toString().toLowerCase();
  const country = locationsData.countries.find((entry) => entry.code === resolvedCountry);

  if (!country || !Array.isArray(country.states)) return null;

  const state = country.states.find(
    (entry) => entry.code === normalizedState || entry.name.toLowerCase() === normalizedState
  );

  return state ? state.name : null;
};

const normalizeRegionFilter = (countryCode, regionValue) => {
  if (!regionValue) return null;

  const mappedState = findStateName(countryCode, regionValue);
  if (mappedState) {
    // Return the mapped state name for filtering - don't skip UK regions!
    return mappedState;
  }

  // If the region looks like a short code (1-3 chars) and we could not map it, skip filtering
  if (/^[a-z]{1,3}$/i.test(regionValue)) {
    return null;
  }

  return regionValue;
};

const sanitizeLimit = (limitValue) => {
  const parsed = parseInt(limitValue, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
};

const sanitizeOffset = (offsetValue) => {
  const parsed = parseInt(offsetValue, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

/**
 * Search companies in database with filters
 */
router.get('/search', async (req, res) => {
  try {
    const {
      query,
      country,
      region,
      locality,
      status,
      industry,
      min_employees,
      max_employees,
      jurisdiction,
      limit,
      offset
    } = req.query;

    // Map country codes to country names for database search
    const countryMapping = {
      'gb': 'United Kingdom',
      'uk': 'United Kingdom',
      'us': 'United States',
      'ca': 'Canada',
      'au': 'Australia',
      'nz': 'New Zealand',
      'ie': 'Ireland',
      // Add more mappings as needed
    };

    // Convert country code to name if it's a 2-letter code
    let countryFilter = country;
    if (country && country.length === 2) {
      countryFilter = countryMapping[country.toLowerCase()] || country;
    }

    const normalizedRegion = normalizeRegionFilter(country, region);

    const filters = {
      query,
      country: countryFilter,
      region: normalizedRegion,
      locality,
      status,
      industry,
      min_employees: min_employees ? parseInt(min_employees) : undefined,
      max_employees: max_employees ? parseInt(max_employees) : undefined,
      jurisdiction
    };

    const safeLimit = sanitizeLimit(limit);
    const safeOffset = sanitizeOffset(offset);

    const result = await companyRepository.searchCompanies(
      filters,
      safeLimit,
      safeOffset
    );

    // Log the search
    await companyRepository.logSearch(
      query,
      filters,
      result.total,
      req.sessionID || 'anonymous'
    );

    // Wrap response to match frontend expectations
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Database search error:', error);
    res.status(500).json({
      error: 'Failed to search database',
      message: error.message
    });
  }
});

/**
 * Get company details by number
 */
router.get('/companies/:companyNumber', async (req, res) => {
  try {
    const { companyNumber } = req.params;
    const company = await companyRepository.getCompanyByNumber(companyNumber);

    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found in database'
      });
    }

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({
      error: 'Failed to get company',
      message: error.message
    });
  }
});

/**
 * Add or update a company
 */
router.post('/companies', async (req, res) => {
  try {
    const companyData = req.body;

    if (!companyData.company_number || !companyData.name) {
      return res.status(400).json({
        error: 'company_number and name are required'
      });
    }

    const company = await companyRepository.upsertCompany(companyData);
    res.json(company);
  } catch (error) {
    console.error('Upsert company error:', error);
    res.status(500).json({
      error: 'Failed to save company',
      message: error.message
    });
  }
});

/**
 * Add contact to company
 */
router.post('/companies/:companyNumber/contacts', async (req, res) => {
  try {
    const { companyNumber } = req.params;
    const contactData = req.body;

    // Get company first
    const company = await companyRepository.getCompanyByNumber(companyNumber);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const contact = await companyRepository.addContact(company.id, contactData);
    res.json(contact);
  } catch (error) {
    console.error('Add contact error:', error);
    res.status(500).json({
      error: 'Failed to add contact',
      message: error.message
    });
  }
});

/**
 * Discover companies in a location
 */
router.post('/discover', async (req, res) => {
  try {
    const { country, region, locality } = req.body;

    if (!country) {
      return res.status(400).json({
        error: 'country is required'
      });
    }

    // Start discovery in background
    const count = await webTrackingService.discoverCompaniesInLocation(
      country,
      region,
      locality
    );

    res.json({
      message: 'Discovery completed',
      companiesAdded: count
    });
  } catch (error) {
    console.error('Discovery error:', error);
    res.status(500).json({
      error: 'Failed to discover companies',
      message: error.message
    });
  }
});

/**
 * Start automated tracking
 */
router.post('/tracking/start', async (req, res) => {
  try {
    const { interval, batchSize, maxAge } = req.body;

    await webTrackingService.startTracking({
      interval: interval ? parseInt(interval) : undefined,
      batchSize: batchSize ? parseInt(batchSize) : undefined,
      maxAge: maxAge ? parseInt(maxAge) : undefined
    });

    res.json({
      message: 'Tracking service started',
      isRunning: webTrackingService.isRunning
    });
  } catch (error) {
    console.error('Start tracking error:', error);
    res.status(500).json({
      error: 'Failed to start tracking',
      message: error.message
    });
  }
});

/**
 * Stop automated tracking
 */
router.post('/tracking/stop', async (req, res) => {
  try {
    webTrackingService.stopTracking();

    res.json({
      message: 'Tracking service stopped',
      isRunning: webTrackingService.isRunning
    });
  } catch (error) {
    console.error('Stop tracking error:', error);
    res.status(500).json({
      error: 'Failed to stop tracking',
      message: error.message
    });
  }
});

/**
 * Get tracking status
 */
router.get('/tracking/status', (req, res) => {
  res.json({
    isRunning: webTrackingService.isRunning
  });
});

/**
 * Get database statistics
 */
router.get('/analytics/stats', async (req, res) => {
  try {
    const stats = await companyRepository.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      error: 'Failed to get statistics',
      message: error.message
    });
  }
});

/**
 * Get popular searches
 */
router.get('/analytics/popular-searches', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const searches = await companyRepository.getPopularSearches(parseInt(limit));
    res.json(searches);
  } catch (error) {
    console.error('Get popular searches error:', error);
    res.status(500).json({
      error: 'Failed to get popular searches',
      message: error.message
    });
  }
});

module.exports = router;
