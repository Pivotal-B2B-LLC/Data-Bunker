/**
 * Google Custom Search Service
 * Search for companies using Google Custom Search API
 */

const axios = require('axios');

class GoogleSearchService {
  constructor() {
    this.apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    this.searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    this.baseUrl = 'https://www.googleapis.com/customsearch/v1';
  }

  /**
   * Search for companies using Google Custom Search
   */
  async searchCompanies(query, options = {}) {
    const { country, state, city, district, limit = 10, offset = 0 } = options;

    // Check if API key is configured
    if (!this.apiKey || this.apiKey === 'your_google_search_api_key_here' || !this.searchEngineId) {
      console.warn('[Google Search] API key not configured, using mock data');
      return this.getMockResults(query, options);
    }

    // Build search query with location filters
    let searchQuery = query;
    
    if (city) searchQuery += ` ${city}`;
    if (state) searchQuery += ` ${state}`;
    if (country) searchQuery += ` ${country}`;
    if (district) searchQuery += ` ${district}`;
    
    // Add "company" or "business" to improve results
    searchQuery += ' company';

    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          key: this.apiKey,
          cx: this.searchEngineId,
          q: searchQuery,
          num: Math.min(limit, 10), // Google allows max 10 per request
          start: offset + 1, // Google uses 1-based indexing
        },
      });

      const items = response.data.items || [];
      const totalResults = parseInt(response.data.searchInformation?.totalResults) || 0;

      // Parse results into company format
      const companies = items.map((item, index) => ({
        company_number: `GOOGLE-${offset + index + 1}`,
        company_name: this.extractCompanyName(item.title),
        company_status: 'active',
        company_type: 'Unknown',
        date_of_creation: null,
        registered_office_address: {
          address_line_1: this.extractAddress(item.snippet),
          locality: city || null,
          region: state || null,
          postal_code: null,
          country: country || null,
        },
        snippet: item.snippet,
        link: item.link,
        source: 'Google Custom Search',
      }));

      return {
        total: totalResults,
        companies,
        page_number: Math.floor(offset / limit) + 1,
        page_size: limit,
      };
    } catch (error) {
      console.error('[Google Search Error]', error.response?.data || error.message);
      
      // If API fails, return mock data
      if (error.response?.status === 403 || error.response?.status === 429) {
        console.warn('[Google Search] API error, using mock data instead');
        return this.getMockResults(query, options);
      }
      
      throw new Error('Failed to search companies via Google: ' + error.message);
    }
  }

  /**
   * Generate mock results for testing
   */
  getMockResults(query, options = {}) {
    const { country, state, city, district, limit = 10, offset = 0 } = options;
    
    const mockCompanies = [
      {
        company_number: 'MOCK-001',
        company_name: `${query} Corporation`,
        company_status: 'active',
        company_type: 'Private Limited Company',
        date_of_creation: '2020-01-15',
        registered_office_address: {
          address_line_1: '123 Business Street',
          locality: city || 'San Francisco',
          region: state || 'California',
          postal_code: '94102',
          country: country || 'US',
        },
        snippet: `${query} is a leading company providing innovative solutions in technology and business services.`,
        link: `https://www.${query.toLowerCase().replace(/\s+/g, '')}.com`,
        source: 'Mock Data (Demo Mode)',
      },
      {
        company_number: 'MOCK-002',
        company_name: `${query} Technologies Inc.`,
        company_status: 'active',
        company_type: 'Corporation',
        date_of_creation: '2018-05-22',
        registered_office_address: {
          address_line_1: '456 Tech Avenue',
          locality: city || 'New York',
          region: state || 'New York',
          postal_code: '10001',
          country: country || 'US',
        },
        snippet: `${query} Technologies specializes in cutting-edge software development and consulting services.`,
        link: `https://www.${query.toLowerCase().replace(/\s+/g, '')}tech.com`,
        source: 'Mock Data (Demo Mode)',
      },
      {
        company_number: 'MOCK-003',
        company_name: `${query} Global Solutions`,
        company_status: 'active',
        company_type: 'Limited Liability Company',
        date_of_creation: '2019-09-10',
        registered_office_address: {
          address_line_1: '789 Corporate Boulevard',
          locality: city || 'London',
          region: state || 'England',
          postal_code: 'SW1A 1AA',
          country: country || 'GB',
        },
        snippet: `${query} Global Solutions offers comprehensive business consulting and management services worldwide.`,
        link: `https://www.${query.toLowerCase().replace(/\s+/g, '')}global.com`,
        source: 'Mock Data (Demo Mode)',
      },
    ];

    return {
      total: 3,
      companies: mockCompanies.slice(offset, offset + limit),
      page_number: Math.floor(offset / limit) + 1,
      page_size: limit,
    };
  }

  /**
   * Extract company name from search result title
   */
  extractCompanyName(title) {
    // Remove common suffixes like " - Official Site", " | LinkedIn", etc.
    return title
      .replace(/\s*[-|]\s*(Official Site|Website|LinkedIn|Facebook|Twitter|Home).*$/i, '')
      .replace(/\s*\.\.\.\s*$/, '')
      .trim();
  }

  /**
   * Extract address information from snippet
   */
  extractAddress(snippet) {
    // Try to extract address-like text from snippet
    const addressPattern = /\d+\s+[\w\s,]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)/i;
    const match = snippet.match(addressPattern);
    return match ? match[0] : snippet.substring(0, 100);
  }

  /**
   * Get company details (search for specific company)
   */
  async getCompanyDetails(companyNumber, country) {
    // For Google Search, we just do another search with the company number/name
    const results = await this.searchCompanies(companyNumber, { country, limit: 1 });
    return results.companies[0] || null;
  }
}

module.exports = new GoogleSearchService();
