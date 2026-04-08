/**
 * Accounts Routes
 * API endpoints for Account management and filtering
 */

const express = require('express');
const router = express.Router();
const Account = require('../models/Account');
const locations = require('../data/locations');

/**
 * GET /api/accounts
 * Get all accounts with filtering and pagination
 */
router.get('/', async (req, res) => {
  try {
    const {
      country,
      state_region,
      city,
      district,
      industry,
      company_size,
      search,
      limit = 50,
      offset = 0,
      orderBy = 'created_at',
      orderDirection = 'DESC'
    } = req.query;

    const filters = {
      country,
      state_region,
      city,
      district,
      industry,
      company_size,
      search
    };

    const options = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      orderBy,
      orderDirection
    };

    const result = await Account.findAll(filters, options);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch accounts',
      message: error.message
    });
  }
});

/**
 * GET /api/accounts/stats
 * Get account statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await Account.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/accounts/filter-options
 * Get available filter options (countries, industries, sizes)
 */
router.get('/filter-options', async (req, res) => {
  try {
    const options = await Account.getFilterOptions();
    res.json({
      success: true,
      data: options
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch filter options',
      message: error.message
    });
  }
});

/**
 * GET /api/accounts/regions/:country
 * Get states/regions for a specific country
 */
router.get('/regions/:country', async (req, res) => {
  try {
    const { country } = req.params;
    
    // First try comprehensive locations data
    if (locations[country]) {
      const regions = Object.keys(locations[country]).sort();
      return res.json({
        success: true,
        data: regions
      });
    }
    
    // Fallback to database
    const regions = await Account.getRegionsByCountry(country);
    res.json({
      success: true,
      data: regions
    });
  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch regions',
      message: error.message
    });
  }
});

/**
 * GET /api/accounts/cities/:country/:region
 * Get cities for a specific country and region
 */
router.get('/cities/:country/:region', async (req, res) => {
  try {
    const { country, region } = req.params;
    
    // First try comprehensive locations data
    if (locations[country] && locations[country][region]) {
      const cities = locations[country][region].sort();
      return res.json({
        success: true,
        data: cities
      });
    }
    
    // Fallback to database
    const cities = await Account.getCitiesByRegion(country, region);
    res.json({
      success: true,
      data: cities
    });
  } catch (error) {
    console.error('Error fetching cities:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cities',
      message: error.message
    });
  }
});

/**
 * GET /api/accounts/districts/:country/:region/:city
 * Get districts/neighborhoods for a specific city
 */
router.get('/districts/:country/:region/:city', async (req, res) => {
  try {
    const { country, region, city } = req.params;
    const { pool } = require('../db/connection');
    
    // First try to get districts from district column
    const result = await pool.query(`
      SELECT DISTINCT district
      FROM accounts 
      WHERE country = $1 
        AND state_region = $2 
        AND city = $3
        AND district IS NOT NULL
        AND district != ''
      ORDER BY district
      LIMIT 100
    `, [country, region, city]);
    
    // If found districts in database, return them
    if (result.rows.length > 0) {
      return res.json({
        success: true,
        data: result.rows.map(r => r.district)
      });
    }

    // Try to get from addresses as fallback
    const addressResult = await pool.query(`
      SELECT DISTINCT 
        TRIM(SPLIT_PART(address, ',', 1)) as district
      FROM accounts 
      WHERE country = $1 
        AND state_region = $2 
        AND city = $3
        AND address IS NOT NULL
        AND address != ''
      GROUP BY TRIM(SPLIT_PART(address, ',', 1))
      HAVING TRIM(SPLIT_PART(address, ',', 1)) != ''
      ORDER BY district
      LIMIT 100
    `, [country, region, city]);
    
    if (addressResult.rows.length > 0) {
      return res.json({
        success: true,
        data: addressResult.rows.map(r => r.district)
      });
    }

    // If no database records, return sample districts for demo
    const sampleDistricts = getSampleDistricts(city, region, country);
    res.json({
      success: true,
      data: sampleDistricts,
      note: 'Using sample districts (no data in database)'
    });
  } catch (error) {
    console.error('Error fetching districts:', error);
    // Even on error, return sample districts
    const sampleDistricts = getSampleDistricts(req.params.city, req.params.region, req.params.country);
    res.json({
      success: true,
      data: sampleDistricts,
      note: 'Using sample districts (database error fallback)'
    });
  }
});

/**
 * Generate sample districts for demo purposes
 */
function getSampleDistricts(city, state, country) {
  const districtMap = {
    'Birmingham': ['Downtown', 'Five Points', 'Druid Hills', 'East Lake', 'Smithfield', 'Ensley', 'North Birmingham'],
    'New York City': ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    'Los Angeles': ['Downtown', 'Koreatown', 'Hollywood', 'Beverly Hills', 'West Hollywood', 'Westwood', 'Santa Monica', 'Long Beach'],
    'Chicago': ['Downtown', 'Near North', 'North Shore', 'North Central', 'Northwest', 'West Side', 'Southwest', 'South Shore'],
    'Kabul': ['Shahr-e Naw', 'Karte Parwan', 'Wazir Akbar Khan', 'Karte Seh', 'Karte Char', 'Taimani', 'Macroyan', 'Shor Bazaar'],
    'London': ['Westminster', 'Camden', 'Islington', 'Hackney', 'Tower Hamlets', 'Newham', 'Barking & Dagenham', 'Havering'],
    'Mumbai': ['Dadar', 'Fort', 'Bandra', 'Malabar Hill', 'Lower Parel', 'Colaba', 'South Mumbai', 'Worli'],
    'Delhi': ['Central Delhi', 'East Delhi', 'New Delhi', 'North Delhi', 'South Delhi', 'West Delhi'],
  };

  return districtMap[city] || [
    'Central District',
    'North District', 
    'South District',
    'East District',
    'West District',
    'Downtown',
    'Suburban'
  ];
}

/**
 * GET /api/accounts/wards/:country/:region/:city/:district
 * Get wards/parishes/hamlets for a specific district
 */
router.get('/wards/:country/:region/:city/:district', async (req, res) => {
  try {
    const { country, region, city, district } = req.params;
    const { pool } = require('../db/connection');
    
    // Query distinct wards
    const result = await pool.query(`
      SELECT DISTINCT ward
      FROM accounts 
      WHERE country = $1 
        AND state_region = $2 
        AND city = $3
        AND district = $4
        AND ward IS NOT NULL
        AND ward != ''
      ORDER BY ward
      LIMIT 100
    `, [country, region, city, district]);
    
    // If found wards in database, return them
    if (result.rows.length > 0) {
      return res.json({
        success: true,
        data: result.rows.map(r => r.ward)
      });
    }

    // Return sample wards for demo
    const sampleWards = getSampleWards(city, district, region, country);
    res.json({
      success: true,
      data: sampleWards,
      note: 'Using sample wards (no data in database)'
    });
  } catch (error) {
    console.error('Error fetching wards:', error);
    // Return sample wards on error
    const sampleWards = getSampleWards(req.params.city, req.params.district, req.params.region, req.params.country);
    res.json({
      success: true,
      data: sampleWards,
      note: 'Using sample wards (database error fallback)'
    });
  }
});

/**
 * Generate sample wards for demo purposes
 */
function getSampleWards(city, district, state, country) {
  const wardMap = {
    'Kabul,Shahr-e Naw': ['North Ward', 'South Ward', 'East Ward', 'West Ward', 'Central Ward'],
    'New York City,Manhattan': ['Upper Manhattan', 'Midtown Manhattan', 'Lower Manhattan', 'East Side', 'West Side'],
    'Los Angeles,Downtown': ['Civic Center', 'Old Bank District', 'Arts District', 'Fashion District'],
    'Chicago,Downtown': ['Loop', 'Near North', 'River North', 'Dearborn Park'],
  };

  const key = `${city},${district}`;
  return wardMap[key] || [
    `${district} North`,
    `${district} South`,
    `${district} East`,
    `${district} West`,
    `${district} Central`,
  ];
}

/**
 * GET /api/accounts/:id
 * Get single account by ID with contacts
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const account = await Account.findById(id);

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }

    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    console.error('Error fetching account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch account',
      message: error.message
    });
  }
});

/**
 * GET /api/accounts/:id/contacts
 * Get all contacts linked to a specific account
 */
router.get('/:id/contacts', async (req, res) => {
  try {
    const { id } = req.params;
    const { pool } = require('../db/connection');

    const result = await pool.query(`
      SELECT
        contact_id,
        first_name,
        last_name,
        job_title,
        email,
        phone_number,
        linkedin_url,
        data_source,
        verified,
        confidence_score,
        created_at
      FROM contacts
      WHERE linked_account_id = $1
      ORDER BY
        verified DESC NULLS LAST,
        confidence_score DESC NULLS LAST,
        created_at DESC
    `, [id]);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching account contacts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contacts',
      message: error.message
    });
  }
});

/**
 * POST /api/accounts
 * Create new account
 */
router.post('/', async (req, res) => {
  try {
    const accountData = req.body;

    // Validate required fields
    if (!accountData.company_name || accountData.company_name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'company_name is required and cannot be empty'
      });
    }

    const account = await Account.create(accountData);

    res.status(201).json({
      success: true,
      data: account
    });
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account',
      message: error.message
    });
  }
});

/**
 * PUT /api/accounts/:id
 * Update account
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const accountData = req.body;

    // Validate company_name if provided
    if (accountData.company_name !== undefined && accountData.company_name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'company_name cannot be empty'
      });
    }

    const account = await Account.update(id, accountData);

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }

    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update account',
      message: error.message
    });
  }
});

/**
 * DELETE /api/accounts/:id
 * Delete account (cascades to contacts)
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const account = await Account.delete(id);

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      });
    }

    res.json({
      success: true,
      message: 'Account deleted successfully',
      data: account
    });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      message: error.message
    });
  }
});

module.exports = router;
