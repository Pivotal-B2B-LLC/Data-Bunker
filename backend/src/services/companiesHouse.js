/**
 * Companies House API Service (UK)
 * https://developer.companieshouse.gov.uk/
 */

const axios = require('axios');
const cache = require('../utils/cache');
const RateLimiter = require('../utils/rateLimiter');

const API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const BASE_URL = 'https://api.company-information.service.gov.uk';
const API_AUTH = Buffer.from(`${API_KEY}:`).toString('base64');

// Rate limiter: 10 requests per 10 seconds
const rateLimiter = new RateLimiter(10, 10000);

class CompaniesHouseService {
  /**
   * Search companies by name
   */
  async searchCompanies(query, options = {}) {
    if (!API_KEY) {
      throw new Error('Companies House API key not configured');
    }

    const params = { query, ...options };
    
    // Check cache
    const cached = cache.get('companieshouse:search', params);
    if (cached) return cached;

    // Check rate limit
    if (!rateLimiter.isAllowed('companieshouse')) {
      throw new Error('Rate limit exceeded for Companies House API');
    }

    try {
      const searchParams = {
        q: query,
        items_per_page: options.limit || 20,
        start_index: options.offset || 0
      };

      console.log('[Companies House] Search request:', {
        url: `${BASE_URL}/search/companies`,
        params: searchParams
      });

      const response = await axios.get(`${BASE_URL}/search/companies`, {
        params: searchParams,
        headers: {
          'Authorization': `Basic ${API_AUTH}`,
          'User-Agent': 'DataBunker/1.0'
        },
        timeout: 10000
      });

      console.log('[Companies House] Search response:', {
        status: response.status,
        itemsCount: response.data.items?.length || 0,
        totalResults: response.data.total_results
      });

      const formatted = this._formatSearchResults(response.data);
      cache.set('companieshouse:search', params, formatted, 3600); // Cache for 1 hour
      return formatted;
    } catch (error) {
      console.error('[Companies House] Search error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      this._handleError(error);
    }
  }

  /**
   * Get company details
   */
  async getCompanyDetails(companyNumber) {
    if (!API_KEY) {
      throw new Error('Companies House API key not configured');
    }

    const params = { companyNumber };
    
    // Check cache
    const cached = cache.get('companieshouse:details', params);
    if (cached) return cached;

    // Check rate limit
    if (!rateLimiter.isAllowed('companieshouse')) {
      throw new Error('Rate limit exceeded for Companies House API');
    }

    try {
      console.log('[Companies House] Company details request:', {
        url: `${BASE_URL}/company/${companyNumber}`,
        companyNumber
      });

      const response = await axios.get(`${BASE_URL}/company/${companyNumber}`, {
        headers: {
          'Authorization': `Basic ${API_AUTH}`,
          'User-Agent': 'DataBunker/1.0'
        },
        timeout: 10000
      });

      console.log('[Companies House] Company details response:', {
        status: response.status,
        companyName: response.data.company_name,
        companyStatus: response.data.company_status
      });

      const formatted = this._formatCompanyDetails(response.data);
      cache.set('companieshouse:details', params, formatted, 86400); // Cache for 24 hours
      return formatted;
    } catch (error) {
      console.error('[Companies House] Company details error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        companyNumber
      });
      this._handleError(error);
    }
  }

  /**
   * Get company officers/directors
   */
  async getCompanyOfficers(companyNumber) {
    if (!API_KEY) {
      throw new Error('Companies House API key not configured');
    }

    const params = { companyNumber };
    
    // Check cache
    const cached = cache.get('companieshouse:officers', params);
    if (cached) return cached;

    // Check rate limit
    if (!rateLimiter.isAllowed('companieshouse')) {
      throw new Error('Rate limit exceeded for Companies House API');
    }

    try {
      console.log('[Companies House] Officers request:', {
        url: `${BASE_URL}/company/${companyNumber}/officers`,
        companyNumber
      });

      const response = await axios.get(`${BASE_URL}/company/${companyNumber}/officers`, {
        headers: {
          'Authorization': `Basic ${API_AUTH}`,
          'User-Agent': 'DataBunker/1.0'
        },
        timeout: 10000
      });

      console.log('[Companies House] Officers response:', {
        status: response.status,
        officersCount: response.data.items?.length || 0
      });

      const formatted = this._formatOfficers(response.data);
      cache.set('companieshouse:officers', params, formatted, 86400);
      return formatted;
    } catch (error) {
      console.error('[Companies House] Officers error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        companyNumber
      });
      this._handleError(error);
    }
  }

  /**
   * Format search results with detailed address parsing
   */
  _formatSearchResults(data) {
    if (!data.items || !Array.isArray(data.items)) {
      console.warn('[Companies House] No items in search results');
      return { companies: [], total: 0 };
    }

    return {
      companies: data.items.map(item => {
        const fullAddress = this._parseAddressSnippet(item.address_snippet, item.address);
        
        return {
          id: item.company_number,
          name: item.title,
          registrationNumber: item.company_number,
          status: item.company_status,
          type: item.company_type,
          matched: item.title,
          address: item.address_snippet || null,
          addressParsed: fullAddress,
          dateOfCreation: item.date_of_creation || null,
          url: `https://find-and-update.company-information.service.gov.uk/company/${item.company_number}`,
          source: 'Companies House'
        };
      }),
      total: data.total_results || data.items.length,
      pageSize: data.items_per_page || 20
    };
  }

  /**
   * Parse address snippet into structured components
   */
  _parseAddressSnippet(snippet, addressObj) {
    if (addressObj) {
      return {
        line1: addressObj.address_line_1 || '',
        line2: addressObj.address_line_2 || '',
        locality: addressObj.locality || '',
        region: addressObj.region || '',
        postalCode: addressObj.postal_code || '',
        country: addressObj.country || 'United Kingdom',
        full: snippet || this._formatAddress(addressObj)
      };
    }
    
    if (snippet) {
      return {
        full: snippet,
        parsed: true
      };
    }
    
    return null;
  }

  /**
   * Format company details
   */
  _formatCompanyDetails(data) {
    return {
      id: data.company_number,
      name: data.company_name,
      registrationNumber: data.company_number,
      status: data.company_status,
      type: data.type,
      incorporationDate: data.date_of_creation,
      jurisdiction: data.jurisdiction || 'England/Wales',
      registeredOffice: this._formatAddress(data.registered_office_address),
      sicCodes: data.sic_codes || [],
      sicDescription: data.sic_codes?.[0] || 'Not specified',
      countOfOfficers: data.links?.officers ? parseInt(data.links.officers.split('/').pop()) : null,
      canFile: data.can_file || false,
      hasBeenLiquidated: data.has_been_liquidated || false,
      hasInsolvencyHistory: data.has_insolvency_history || false,
      accounts: data.accounts ? {
        nextDue: data.accounts.next_due,
        nextMadeUpTo: data.accounts.next_made_up_to,
        lastFilingDate: data.accounts.last_accounts?.made_up_to,
        overdue: data.accounts.overdue || false
      } : null,
      confirmationStatement: data.confirmation_statement ? {
        nextDue: data.confirmation_statement.next_due,
        nextMadeUpTo: data.confirmation_statement.next_made_up_to,
        lastMadeUpTo: data.confirmation_statement.last_made_up_to,
        overdue: data.confirmation_statement.overdue || false
      } : null,
      url: `https://find-and-update.company-information.service.gov.uk/company/${data.company_number}`,
      source: 'Companies House',
      rawData: data // Include raw data for debugging
    };
  }

  /**
   * Format address
   */
  _formatAddress(addressData) {
    if (!addressData) return null;

    const parts = [
      addressData.address_line_1,
      addressData.address_line_2,
      addressData.locality,
      addressData.region,
      addressData.postal_code,
      addressData.country
    ].filter(Boolean);

    return {
      full: parts.join(', '),
      line1: addressData.address_line_1,
      city: addressData.locality,
      state: addressData.region,
      postalCode: addressData.postal_code,
      country: addressData.country || 'United Kingdom'
    };
  }

  /**
   * Format officers/directors
   */
  _formatOfficers(data) {
    if (!data.items) return { officers: [] };

    return {
      officers: data.items.map(officer => ({
        name: officer.name,
        position: officer.officer_role,
        appointmentDate: officer.appointed_on,
        resignationDate: officer.resigned_on,
        nationality: officer.nationality,
        occupation: officer.occupation,
        address: officer.address ? this._formatAddress(officer.address) : null
      }))
    };
  }

  /**
   * Handle API errors
   */
  _handleError(error) {
    console.error('[Companies House] Detailed error:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers
    });

    if (error.response) {
      const { status, data } = error.response;
      switch (status) {
        case 400:
          throw new Error(`Invalid request: ${data?.errors?.[0]?.error || 'Bad request'}`);
        case 401:
          throw new Error('Unauthorized - Companies House API key is invalid or missing');
        case 404:
          throw new Error('Company not found in Companies House register');
        case 429:
          throw new Error('Rate limit exceeded - too many requests to Companies House API');
        case 500:
          throw new Error('Companies House API server error');
        default:
          throw new Error(`Companies House API error (${status}): ${data?.errors?.[0]?.error || 'Unknown error'}`);
      }
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Companies House API request timeout - please try again');
    } else if (error.code === 'ENOTFOUND') {
      throw new Error('Cannot connect to Companies House API - check your internet connection');
    } else {
      throw new Error(`Network error: ${error.message}`);
    }
  }
}

module.exports = new CompaniesHouseService();
