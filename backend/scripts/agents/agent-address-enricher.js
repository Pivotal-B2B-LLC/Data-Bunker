#!/usr/bin/env node

/**
 * ADDRESS ENRICHER AGENT
 *
 * Finds and validates full business addresses using:
 * 1. Nominatim Geocoding (FREE, unlimited)
 * 2. Postcodes.io (FREE, UK postcodes)
 * 3. Company website scraping (contact/about pages)
 *
 * Enriches:
 * - Full address (street, city, postcode)
 * - Headquarters address
 * - District / Ward
 * - Latitude / Longitude
 *
 * 100% FREE
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const { pool } = require('../../src/db/connection');

const CONFIG = {
  BATCH_SIZE: 50,
  PARALLEL: 10,
  DELAY_BETWEEN_REQUESTS: 1100, // Nominatim: max 1 req/sec
  DELAY_BETWEEN_BATCHES: 3000,
  CYCLE_DELAY: 30000,
  REQUEST_TIMEOUT: 10000,
};

const USER_AGENTS = [
  'DataBunkerAddressAgent/1.0 (contact@databunker.io)',
];

class AddressEnricherAgent {
  constructor() {
    this.stats = {
      companiesProcessed: 0,
      addressesFound: 0,
      postcodeEnriched: 0,
      geocoded: 0,
      errors: 0,
      cycles: 0,
    };
    this.running = true;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get companies that need address enrichment
   */
  async getCompaniesNeedingAddress() {
    const result = await pool.query(`
      SELECT account_id, company_name, city, state_region, country, website, address, headquarters_address
      FROM accounts
      WHERE (address IS NULL OR address = '' OR headquarters_address IS NULL OR headquarters_address = '')
        AND company_name IS NOT NULL
        AND city IS NOT NULL
      ORDER BY quality_score DESC NULLS LAST, created_at DESC
      LIMIT $1
    `, [CONFIG.BATCH_SIZE]);
    return result.rows;
  }

  /**
   * Get companies that need geocoding (lat/lng)
   */
  async getCompaniesNeedingGeocode() {
    const result = await pool.query(`
      SELECT account_id, company_name, address, city, state_region, country
      FROM accounts
      WHERE address IS NOT NULL
        AND address != ''
        AND (latitude IS NULL OR longitude IS NULL)
      ORDER BY created_at DESC
      LIMIT $1
    `, [CONFIG.BATCH_SIZE]);
    return result.rows;
  }

  /**
   * Geocode address using Nominatim (FREE)
   */
  async geocodeAddress(address, city, country) {
    try {
      const query = [address, city, country].filter(Boolean).join(', ');
      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: query, format: 'json', limit: 1, addressdetails: 1 },
        headers: { 'User-Agent': USER_AGENTS[0] },
        timeout: CONFIG.REQUEST_TIMEOUT,
      });

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        return {
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          address: result.display_name,
          details: result.address || {},
        };
      }
    } catch (error) {
      this.stats.errors++;
    }
    return null;
  }

  /**
   * Search for company address on Nominatim
   */
  async findCompanyAddress(companyName, city, country) {
    try {
      const query = `${companyName}, ${city}, ${country}`;
      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: query, format: 'json', limit: 3, addressdetails: 1 },
        headers: { 'User-Agent': USER_AGENTS[0] },
        timeout: CONFIG.REQUEST_TIMEOUT,
      });

      if (response.data && response.data.length > 0) {
        // Pick the result that's closest to a business address
        for (const result of response.data) {
          const addr = result.address;
          if (addr && (addr.road || addr.house_number)) {
            return {
              fullAddress: this.formatNominatimAddress(addr),
              postcode: addr.postcode,
              district: addr.suburb || addr.city_district || addr.quarter,
              ward: addr.neighbourhood || addr.hamlet,
              lat: parseFloat(result.lat),
              lng: parseFloat(result.lon),
            };
          }
        }

        // Fallback to first result
        const first = response.data[0];
        return {
          fullAddress: first.display_name,
          postcode: first.address?.postcode,
          district: first.address?.suburb || first.address?.city_district,
          ward: first.address?.neighbourhood,
          lat: parseFloat(first.lat),
          lng: parseFloat(first.lon),
        };
      }
    } catch {
      this.stats.errors++;
    }
    return null;
  }

  /**
   * UK Postcode lookup (FREE via postcodes.io)
   */
  async lookupUKPostcode(postcode) {
    try {
      const response = await axios.get(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
        timeout: CONFIG.REQUEST_TIMEOUT,
      });

      if (response.data?.status === 200 && response.data?.result) {
        const r = response.data.result;
        return {
          district: r.admin_district,
          ward: r.admin_ward,
          region: r.region,
          country: r.country,
          lat: r.latitude,
          lng: r.longitude,
          parish: r.parish,
        };
      }
    } catch {
      // Postcode not found
    }
    return null;
  }

  /**
   * Scrape company website for address
   */
  async scrapeWebsiteForAddress(website) {
    try {
      const url = website.startsWith('http') ? website : `https://${website}`;
      const pages = [url, `${url}/contact`, `${url}/about`, `${url}/contact-us`];

      for (const pageUrl of pages) {
        try {
          const response = await axios.get(pageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 8000,
            maxRedirects: 3,
            validateStatus: (status) => status < 400,
          });

          const html = typeof response.data === 'string' ? response.data : '';

          // Extract UK postcodes
          const postcodeMatch = html.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i);
          if (postcodeMatch) {
            // Get surrounding text for full address
            const idx = html.indexOf(postcodeMatch[0]);
            const surrounding = html.substring(Math.max(0, idx - 200), idx + 20)
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();

            return {
              postcode: postcodeMatch[0].toUpperCase(),
              addressContext: surrounding,
            };
          }

          // Extract US zip codes
          const zipMatch = html.match(/\b\d{5}(-\d{4})?\b/);
          if (zipMatch) {
            const idx = html.indexOf(zipMatch[0]);
            const surrounding = html.substring(Math.max(0, idx - 200), idx + 20)
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();

            return {
              postcode: zipMatch[0],
              addressContext: surrounding,
            };
          }
        } catch {
          // Page not reachable
        }
      }
    } catch {
      this.stats.errors++;
    }
    return null;
  }

  /**
   * Format Nominatim address
   */
  formatNominatimAddress(addr) {
    return [
      addr.house_number,
      addr.road,
      addr.suburb || addr.neighbourhood,
      addr.city || addr.town || addr.village,
      addr.county,
      addr.postcode,
    ].filter(Boolean).join(', ');
  }

  /**
   * Save enriched address data
   */
  async saveAddressData(accountId, data) {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (data.fullAddress) {
      updates.push(`address = COALESCE(address, $${paramIndex})`);
      values.push(data.fullAddress);
      paramIndex++;
      updates.push(`headquarters_address = COALESCE(headquarters_address, $${paramIndex})`);
      values.push(data.fullAddress);
      paramIndex++;
    }
    if (data.district) {
      updates.push(`district = COALESCE(district, $${paramIndex})`);
      values.push(data.district);
      paramIndex++;
    }
    if (data.ward) {
      updates.push(`ward = COALESCE(ward, $${paramIndex})`);
      values.push(data.ward);
      paramIndex++;
    }
    if (data.lat && data.lng) {
      updates.push(`latitude = COALESCE(latitude, $${paramIndex})`);
      values.push(data.lat);
      paramIndex++;
      updates.push(`longitude = COALESCE(longitude, $${paramIndex})`);
      values.push(data.lng);
      paramIndex++;
    }

    if (updates.length === 0) return false;

    values.push(accountId);

    try {
      await pool.query(
        `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $${paramIndex}`,
        values
      );
      return true;
    } catch {
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Process a single company
   */
  async processCompany(company) {
    this.stats.companiesProcessed++;
    let addressData = {};

    // Strategy 1: Find address via Nominatim geocoding
    const geocodeResult = await this.findCompanyAddress(company.company_name, company.city, company.country);
    await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);

    if (geocodeResult) {
      addressData = { ...geocodeResult };
      this.stats.addressesFound++;
    }

    // Strategy 2: If UK, try postcode enrichment
    if (geocodeResult?.postcode && company.country?.includes('United Kingdom')) {
      const postcodeData = await this.lookupUKPostcode(geocodeResult.postcode);
      if (postcodeData) {
        addressData.district = addressData.district || postcodeData.district;
        addressData.ward = addressData.ward || postcodeData.ward;
        addressData.lat = addressData.lat || postcodeData.lat;
        addressData.lng = addressData.lng || postcodeData.lng;
        this.stats.postcodeEnriched++;
      }
      await this.delay(200); // postcodes.io is fast
    }

    // Strategy 3: Scrape company website for address
    if (!addressData.fullAddress && company.website) {
      const websiteResult = await this.scrapeWebsiteForAddress(company.website);
      if (websiteResult?.postcode) {
        // UK postcode - enrich it
        if (websiteResult.postcode.match(/^[A-Z]{1,2}\d/i)) {
          const postcodeData = await this.lookupUKPostcode(websiteResult.postcode);
          if (postcodeData) {
            addressData.district = addressData.district || postcodeData.district;
            addressData.ward = addressData.ward || postcodeData.ward;
            addressData.lat = addressData.lat || postcodeData.lat;
            addressData.lng = addressData.lng || postcodeData.lng;
            this.stats.postcodeEnriched++;
          }
        }
        if (websiteResult.addressContext) {
          addressData.fullAddress = addressData.fullAddress || websiteResult.addressContext;
          this.stats.addressesFound++;
        }
      }
    }

    // Save whatever we found
    if (Object.keys(addressData).length > 0) {
      await this.saveAddressData(company.account_id, addressData);
    }
  }

  /**
   * Process batch (sequential due to Nominatim rate limit)
   */
  async processBatch(companies) {
    for (const company of companies) {
      if (!this.running) break;
      await this.processCompany(company);
    }
  }

  /**
   * Geocode companies that have address but no lat/lng
   */
  async geocodeBatch() {
    const companies = await this.getCompaniesNeedingGeocode();
    if (companies.length === 0) return;

    console.log(`   Geocoding ${companies.length} companies...`);

    for (const company of companies) {
      if (!this.running) break;

      const result = await this.geocodeAddress(company.address, company.city, company.country);
      if (result) {
        try {
          await pool.query(
            `UPDATE accounts SET latitude = $1, longitude = $2 WHERE account_id = $3`,
            [result.lat, result.lng, company.account_id]
          );
          this.stats.geocoded++;
        } catch {}
      }

      await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);
    }
  }

  /**
   * Ensure lat/lng columns exist
   */
  async ensureColumns() {
    const columns = [
      { name: 'latitude', type: 'DOUBLE PRECISION' },
      { name: 'longitude', type: 'DOUBLE PRECISION' },
    ];
    for (const col of columns) {
      try {
        await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      } catch {}
    }
  }

  /**
   * Main loop
   */
  async run() {
    console.log('='.repeat(60));
    console.log('   ADDRESS ENRICHER AGENT');
    console.log('='.repeat(60));
    console.log('   Sources: Nominatim, Postcodes.io, Website scraping');
    console.log('   Cost: FREE');
    console.log('');

    await this.ensureColumns();

    while (this.running) {
      this.stats.cycles++;
      console.log(`\n--- Cycle ${this.stats.cycles} ---`);

      // Phase 1: Find addresses for companies
      const needAddress = await this.getCompaniesNeedingAddress();
      if (needAddress.length > 0) {
        console.log(`   Finding addresses for ${needAddress.length} companies...`);
        await this.processBatch(needAddress);
      }

      // Phase 2: Geocode companies with address but no coordinates
      await this.geocodeBatch();

      console.log(`\n   Stats: ${this.stats.companiesProcessed} processed | ${this.stats.addressesFound} addresses | ${this.stats.postcodeEnriched} postcodes | ${this.stats.geocoded} geocoded | ${this.stats.errors} errors`);

      if (needAddress.length === 0) {
        console.log('   No companies need address enrichment. Waiting...');
        await this.delay(CONFIG.CYCLE_DELAY * 2);
      } else {
        await this.delay(CONFIG.CYCLE_DELAY);
      }
    }
  }
}

// Main
const agent = new AddressEnricherAgent();

process.on('SIGINT', () => { agent.running = false; });
process.on('SIGTERM', () => { agent.running = false; });

agent.run().catch(e => {
  console.error('Address Enricher Agent failed:', e.message);
  process.exit(1);
});
