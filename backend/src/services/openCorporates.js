/**
 * OpenCorporates API Service (Global)
 * https://opencorporates.com/api
 */

const axios = require('axios');
const cache = require('../utils/cache');
const RateLimiter = require('../utils/rateLimiter');

const API_KEY = process.env.OPENCORPORATES_API_KEY;
const BASE_URL = 'https://api.opencorporates.com/v0.4';

// Rate limiter: 5 requests per minute (OpenCorporates free tier)
const rateLimiter = new RateLimiter(5, 60000);

class OpenCorporatesService {
  /**
   * Search companies globally
   */
  async searchCompanies(query, options = {}) {
    const params = { query, ...options };
    
    // Check cache (7 days for global data)
    const cached = cache.get('opencorporates:search', params);
    if (cached) return cached;

    // Check rate limit
    if (!rateLimiter.isAllowed('opencorporates')) {
      throw new Error('Rate limit exceeded for OpenCorporates API (5 req/min)');
    }

    try {
      const searchParams = {
        q: query,
        per_page: options.limit || 30,
        page: (options.offset || 0) / (options.limit || 30) + 1
      };

      // Add jurisdiction if country specified
      if (options.country) {
        searchParams.jurisdiction_code = this._countryToJurisdiction(options.country);
      }

      // Add API key if available
      if (API_KEY) {
        searchParams.api_token = API_KEY;
      }

      const response = await axios.get(`${BASE_URL}/companies/search`, {
        params: searchParams,
        headers: {
          'User-Agent': 'DataBunker/1.0'
        },
        timeout: 10000
      });

      const formatted = this._formatSearchResults(response.data);
      cache.set('opencorporates:search', params, formatted, 604800); // Cache for 7 days
      return formatted;
    } catch (error) {
      this._handleError(error);
    }
  }

  /**
   * Get company details
   */
  async getCompanyDetails(companyNumber, jurisdictionCode) {
    const params = { companyNumber, jurisdictionCode };
    
    // Check cache
    const cached = cache.get('opencorporates:details', params);
    if (cached) return cached;

    // Check rate limit
    if (!rateLimiter.isAllowed('opencorporates')) {
      throw new Error('Rate limit exceeded for OpenCorporates API');
    }

    try {
      const searchParams = {
        company_number: companyNumber,
        jurisdiction_code: jurisdictionCode
      };

      if (API_KEY) {
        searchParams.api_token = API_KEY;
      }

      const response = await axios.get(`${BASE_URL}/companies/${jurisdictionCode}/${companyNumber}`, {
        params: API_KEY ? { api_token: API_KEY } : {},
        headers: {
          'User-Agent': 'DataBunker/1.0'
        },
        timeout: 10000
      });

      const formatted = this._formatCompanyDetails(response.data.company);
      cache.set('opencorporates:details', params, formatted, 1209600); // Cache for 14 days
      return formatted;
    } catch (error) {
      this._handleError(error);
    }
  }

  /**
   * Format search results
   */
  _formatSearchResults(data) {
    if (!data.companies) return { companies: [], total: 0 };

    return {
      companies: data.companies.map(item => ({
        id: item.company.company_number,
        name: item.company.name,
        registrationNumber: item.company.company_number,
        jurisdiction: item.company.jurisdiction_code,
        status: item.company.status || 'Unknown',
        incorporationDate: item.company.incorporation_date,
        type: item.company.company_type,
        address: item.company.registered_address,
        url: item.company.url,
        source: 'OpenCorporates'
      })),
      total: data.total_count || 0,
      pageSize: data.companies.length
    };
  }

  /**
   * Format company details
   */
  _formatCompanyDetails(company) {
    return {
      id: company.company_number,
      name: company.name,
      registrationNumber: company.company_number,
      status: company.status || 'Unknown',
      jurisdiction: company.jurisdiction_code,
      incorporationDate: company.incorporation_date,
      type: company.company_type,
      address: company.registered_address,
      website: company.website,
      officers: company.officers || [],
      source: 'OpenCorporates',
      url: company.url,
      filings: {
        count: company.filing_count || 0,
        lastFilingDate: company.last_filing_date
      }
    };
  }

  /**
   * Convert ISO country code to OpenCorporates jurisdiction code
   */
  _countryToJurisdiction(countryCode) {
    const jurisdictionMap = {
      'gb': 'gb',
      'us': 'us_de', // Delaware is most common
      'au': 'au',
      'de': 'de',
      'fr': 'fr',
      'jp': 'jp',
      'ca': 'ca_federal',
      'in': 'in',
      'cn': 'cn',
      'br': 'br'
    };

    return jurisdictionMap[countryCode.toLowerCase()] || countryCode;
  }

  /**
   * Handle API errors
   */
  _handleError(error) {
    if (error.response) {
      switch (error.response.status) {
        case 400:
          throw new Error('Invalid search parameters');
        case 401:
          throw new Error('Unauthorized - API key invalid');
        case 404:
          throw new Error('Company not found');
        case 429:
          throw new Error('Rate limit exceeded');
        default:
          throw new Error(`API error: ${error.response.status}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('API request timeout');
    } else {
      throw new Error(`Network error: ${error.message}`);
    }
  }
}

module.exports = new OpenCorporatesService();
