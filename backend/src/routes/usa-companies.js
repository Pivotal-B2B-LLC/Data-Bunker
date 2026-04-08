/**
 * USA Companies Routes - API Only
 * Searches USA companies via OpenCorporates API in real-time
 * No storage needed, always fresh data
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

const OPENCORPORATES_API_KEY = process.env.OPENCORPORATES_API_KEY;
const OPENCORPORATES_BASE_URL = 'https://api.opencorporates.com/v0.4';

// Check if API key is configured
const hasAPIKey = !!OPENCORPORATES_API_KEY;

/**
 * Search USA companies via API
 * GET /api/companies/usa/search?query=tesla&state=ca&limit=20
 */
router.get('/search', async (req, res) => {
  try {
    if (!hasAPIKey) {
      return res.status(503).json({
        success: false,
        error: 'USA company search requires OpenCorporates API key',
        message: 'Please set OPENCORPORATES_API_KEY in your .env file',
        signup: 'https://opencorporates.com/api_accounts/new'
      });
    }

    const { query, state, status, limit = 30, page = 1 } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required'
      });
    }

    // Build OpenCorporates API request
    const params = {
      q: query,
      jurisdiction_code: state ? `us_${state.toLowerCase()}` : 'us',
      api_token: OPENCORPORATES_API_KEY,
      per_page: parseInt(limit),
      page: parseInt(page)
    };

    if (status) {
      params.current_status = status;
    }

    console.log('[USA API] Searching:', query, 'in', params.jurisdiction_code);

    const response = await axios.get(`${OPENCORPORATES_BASE_URL}/companies/search`, {
      params,
      timeout: 10000
    });

    const data = response.data;

    if (!data.results || !data.results.companies) {
      return res.json({
        success: true,
        source: 'opencorporates_api',
        country: 'USA',
        companies: [],
        total: 0,
        message: 'No USA companies found'
      });
    }

    // Transform OpenCorporates data to our format
    const companies = data.results.companies.map(item => {
      const company = item.company;
      return {
        company_number: company.company_number,
        name: company.name,
        jurisdiction: company.jurisdiction_code,
        status: company.current_status,
        company_type: company.company_type,
        incorporation_date: company.incorporation_date,
        address: company.registered_address_in_full,
        registry_url: company.registry_url,
        opencorporates_url: company.opencorporates_url,
        source: 'opencorporates_api'
      };
    });

    res.json({
      success: true,
      source: 'opencorporates_api',
      country: 'USA',
      companies,
      total: data.results.total_count || companies.length,
      page: parseInt(page),
      per_page: parseInt(limit),
      message: 'USA companies from OpenCorporates API (real-time)'
    });

  } catch (error) {
    console.error('USA API search error:', error.message);

    if (error.response) {
      // API returned an error
      res.status(error.response.status).json({
        success: false,
        error: 'OpenCorporates API error',
        details: error.response.data,
        message: 'Failed to search USA companies'
      });
    } else {
      // Network or other error
      res.status(500).json({
        success: false,
        error: 'Failed to search USA companies',
        details: error.message
      });
    }
  }
});

/**
 * Get USA company details by jurisdiction and number
 * GET /api/companies/usa/:jurisdiction/:companyNumber
 * Example: /api/companies/usa/us_ca/C1234567
 */
router.get('/:jurisdiction/:companyNumber', async (req, res) => {
  try {
    if (!hasAPIKey) {
      return res.status(503).json({
        success: false,
        error: 'USA company lookup requires OpenCorporates API key'
      });
    }

    const { jurisdiction, companyNumber } = req.params;

    console.log('[USA API] Fetching:', jurisdiction, companyNumber);

    const response = await axios.get(
      `${OPENCORPORATES_BASE_URL}/companies/${jurisdiction}/${companyNumber}`,
      {
        params: { api_token: OPENCORPORATES_API_KEY },
        timeout: 10000
      }
    );

    const company = response.data.results.company;

    res.json({
      success: true,
      source: 'opencorporates_api',
      country: 'USA',
      company: {
        company_number: company.company_number,
        name: company.name,
        jurisdiction: company.jurisdiction_code,
        status: company.current_status,
        company_type: company.company_type,
        incorporation_date: company.incorporation_date,
        dissolution_date: company.dissolution_date,
        address: company.registered_address_in_full,
        registry_url: company.registry_url,
        opencorporates_url: company.opencorporates_url,
        previous_names: company.previous_names,
        source: 'opencorporates_api'
      }
    });

  } catch (error) {
    console.error('USA API fetch error:', error.message);

    if (error.response && error.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'USA company not found'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to fetch USA company',
      details: error.message
    });
  }
});

/**
 * Check API status
 * GET /api/companies/usa/status
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    api_configured: hasAPIKey,
    provider: 'OpenCorporates',
    message: hasAPIKey 
      ? 'USA API is configured and ready' 
      : 'USA API requires OPENCORPORATES_API_KEY',
    signup: 'https://opencorporates.com/api_accounts/new',
    pricing: {
      free: '500 requests/month',
      starter: '$30/month for 10,000 requests',
      business: '$300/month for 100,000 requests'
    }
  });
});

module.exports = router;
