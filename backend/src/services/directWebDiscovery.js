/**
 * Direct Web Discovery Service
 * Discovers company websites by guessing common URL patterns
 * NO API KEYS NEEDED!
 */

const axios = require('axios');

class DirectWebDiscovery {
  constructor() {
    this.timeout = 5000; // 5 seconds per request
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  }

  /**
   * Generate possible website URLs for a company
   */
  generateUrlPatterns(companyName, country = 'US') {
    // Clean company name
    const cleanName = companyName
      .toLowerCase()
      .replace(/\b(plc|llc|ltd|limited|inc|incorporated|corp|corporation|group|holdings)\b/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .replace(/\s+/g, '');

    const patterns = [];
    
    // Determine TLDs based on country
    const tlds = this.getTLDsByCountry(country);
    
    // Generate patterns
    tlds.forEach(tld => {
      patterns.push(`https://www.${cleanName}.${tld}`);
      patterns.push(`https://${cleanName}.${tld}`);
      
      // Try with hyphens for multi-word names
      if (cleanName.length > 8) {
        const hyphenated = companyName
          .toLowerCase()
          .replace(/\b(plc|llc|ltd|limited|inc|incorporated|corp|corporation)\b/gi, '')
          .replace(/[^a-z0-9\s]/g, '')
          .trim()
          .replace(/\s+/g, '-');
        
        if (hyphenated !== cleanName) {
          patterns.push(`https://www.${hyphenated}.${tld}`);
          patterns.push(`https://${hyphenated}.${tld}`);
        }
      }
    });

    return patterns;
  }

  /**
   * Get appropriate TLDs based on country
   */
  getTLDsByCountry(country) {
    const countryTLDs = {
      'United Kingdom': ['co.uk', 'com', 'uk'],
      'GB': ['co.uk', 'com', 'uk'],
      'UK': ['co.uk', 'com', 'uk'],
      'United States': ['com', 'us', 'net'],
      'US': ['com', 'us', 'net'],
      'Canada': ['ca', 'com'],
      'CA': ['ca', 'com'],
      'Australia': ['com.au', 'com', 'au'],
      'AU': ['com.au', 'com', 'au'],
      'Germany': ['de', 'com'],
      'DE': ['de', 'com'],
      'France': ['fr', 'com'],
      'FR': ['fr', 'com'],
    };

    return countryTLDs[country] || ['com', 'net', 'org'];
  }

  /**
   * Check if a URL is accessible
   */
  async checkUrl(url) {
    try {
      const response = await axios.head(url, {
        timeout: this.timeout,
        maxRedirects: 5,
        headers: {
          'User-Agent': this.userAgent
        },
        validateStatus: (status) => status < 400
      });

      return {
        accessible: true,
        url: response.request.res.responseUrl || url,
        statusCode: response.status
      };
    } catch (error) {
      // Try GET request if HEAD fails
      try {
        const response = await axios.get(url, {
          timeout: this.timeout,
          maxRedirects: 5,
          headers: {
            'User-Agent': this.userAgent
          },
          validateStatus: (status) => status < 400
        });

        return {
          accessible: true,
          url: response.request.res.responseUrl || url,
          statusCode: response.status
        };
      } catch (getError) {
        return {
          accessible: false,
          url,
          error: getError.message
        };
      }
    }
  }

  /**
   * Discover company website
   * @param {string} companyName - Company name
   * @param {string} country - Country code
   * @param {string} locality - City/locality
   * @param {string} fullAddress - Full address for logging context
   */
  async discoverWebsite(companyName, country = 'US', locality = null, fullAddress = null) {
    console.log(`[Direct Discovery] Finding website for: ${companyName}`);
    console.log(`[Direct Discovery] Location: ${fullAddress || locality || country}`);

    // Generate possible URLs
    const urlPatterns = this.generateUrlPatterns(companyName, country);
    
    console.log(`[Direct Discovery] Checking ${urlPatterns.length} possible URLs...`);

    // Check each URL (in parallel for speed)
    const checks = urlPatterns.map(url => 
      this.checkUrl(url).catch(err => ({ accessible: false, url, error: err.message }))
    );

    const results = await Promise.all(checks);

    // Find first accessible URL
    const found = results.find(r => r.accessible);

    if (found) {
      console.log(`[Direct Discovery] ✓ Found: ${found.url}`);
      return {
        success: true,
        website: found.url,
        method: 'url_pattern_matching'
      };
    }

    console.log(`[Direct Discovery] ✗ No website found for: ${companyName}`);
    return {
      success: false,
      website: null,
      method: 'url_pattern_matching',
      attempted: urlPatterns.length
    };
  }

  /**
   * Batch discover websites for multiple companies
   */
  async discoverBatch(companies, maxConcurrent = 3) {
    const results = [];
    
    for (let i = 0; i < companies.length; i += maxConcurrent) {
      const batch = companies.slice(i, i + maxConcurrent);
      
      const batchResults = await Promise.all(
        batch.map(company => 
          this.discoverWebsite(company.name, company.country, company.locality)
            .then(result => ({ ...result, companyId: company.id }))
            .catch(err => ({ 
              success: false, 
              companyId: company.id, 
              error: err.message 
            }))
        )
      );

      results.push(...batchResults);
      
      // Small delay between batches to avoid overwhelming servers
      if (i + maxConcurrent < companies.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }
}

module.exports = new DirectWebDiscovery();
