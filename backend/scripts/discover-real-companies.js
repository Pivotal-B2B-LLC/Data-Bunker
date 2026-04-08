#!/usr/bin/env node

/**
 * REAL COMPANY DISCOVERY SYSTEM
 *
 * Uses legitimate APIs to find and verify real companies:
 * - Google Places API (global)
 * - Companies House API (UK)
 * - Web scraping with validation
 *
 * Usage: node discover-real-companies.js <city> <state/region> <country> [limit]
 */

const axios = require('axios');
const { pool } = require('../src/db/connection');
const googlePlacesService = require('../services/googlePlacesService');

class RealCompanyDiscovery {
  constructor(city, region, country = 'United States') {
    this.city = city;
    this.region = region;
    this.country = country;
    this.companiesFound = 0;

    // API Keys
    this.googlePlacesKey = process.env.GOOGLE_PLACES_API_KEY;
    this.companiesHouseKey = process.env.COMPANIES_HOUSE_API_KEY;

    // Check which APIs are available
    this.hasGooglePlaces = !!this.googlePlacesKey;
    this.hasCompaniesHouse = !!this.companiesHouseKey;

    console.log('\n🔑 API Status:');
    console.log(`   Google Places: ${this.hasGooglePlaces ? '✓ Available' : '✗ Missing API Key'}`);
    console.log(`   Companies House: ${this.hasCompaniesHouse ? '✓ Available' : '✗ Missing API Key (UK only)'}\n`);
  }

  /**
   * Get industries to search for
   */
  getIndustries() {
    return [
      { name: 'Restaurant', types: ['restaurant', 'cafe', 'food'] },
      { name: 'Retail', types: ['store', 'shop', 'retail'] },
      { name: 'Healthcare', types: ['doctor', 'hospital', 'health'] },
      { name: 'Legal Services', types: ['lawyer', 'attorney', 'legal'] },
      { name: 'Accounting', types: ['accountant', 'accounting'] },
      { name: 'Real Estate', types: ['real_estate_agency'] },
      { name: 'Construction', types: ['general_contractor', 'construction'] },
      { name: 'Marketing', types: ['marketing_agency'] },
      { name: 'IT Services', types: ['it', 'software', 'technology'] },
      { name: 'Consulting', types: ['consultant', 'consulting'] },
      { name: 'Insurance', types: ['insurance_agency'] },
      { name: 'Financial Services', types: ['finance', 'bank'] },
      { name: 'Architecture', types: ['architect', 'architecture'] },
      { name: 'Design', types: ['design', 'graphic_design'] },
      { name: 'Fitness', types: ['gym', 'fitness'] },
      { name: 'Beauty & Spa', types: ['spa', 'beauty_salon', 'hair_care'] },
      { name: 'Automotive', types: ['car_dealer', 'car_repair'] },
      { name: 'Education', types: ['school', 'training', 'education'] }
    ];
  }

  /**
   * Search Google Places for companies in a specific industry
   */
  async searchGooglePlaces(industry, maxResults = 10) {
    if (!this.hasGooglePlaces) {
      console.log(`⚠️  Skipping Google Places (no API key)`);
      return [];
    }

    const companies = [];

    for (const placeType of industry.types.slice(0, 2)) { // Limit to 2 types per industry to stay within quota
      try {
        const query = `${placeType} in ${this.city}, ${this.region}`;
        console.log(`   🔍 Searching: "${query}"`);

        const response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
          params: {
            query: query,
            key: this.googlePlacesKey,
            type: placeType
          }
        });

        if (response.data.status === 'OK' && response.data.results) {
          for (const place of response.data.results.slice(0, maxResults)) {
            // Get detailed information
            const details = await this.getPlaceDetails(place.place_id);

            if (details && details.business_status === 'OPERATIONAL') {
              companies.push({
                name: details.name,
                address: details.formatted_address,
                city: this.city,
                region: this.region,
                country: this.country,
                industry: industry.name,
                phone: details.formatted_phone_number || details.international_phone_number,
                website: details.website,
                rating: details.rating,
                totalRatings: details.user_ratings_total,
                verified: true,
                source: 'Google Places',
                placeId: place.place_id,
                location: place.geometry?.location,
                types: details.types
              });
            }
          }

          // Respect rate limits
          await this.delay(200);
        } else if (response.data.status === 'ZERO_RESULTS') {
          console.log(`   ℹ️  No results for ${placeType}`);
        } else if (response.data.status === 'OVER_QUERY_LIMIT') {
          console.log(`   ⚠️  Google API quota exceeded - stopping search`);
          break;
        }
      } catch (error) {
        console.error(`   ❌ Error searching ${placeType}:`, error.message);
      }
    }

    return companies;
  }

  /**
   * Get detailed place information
   */
  async getPlaceDetails(placeId) {
    try {
      const response = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
        params: {
          place_id: placeId,
          fields: 'name,formatted_address,formatted_phone_number,international_phone_number,website,business_status,rating,user_ratings_total,types,geometry',
          key: this.googlePlacesKey
        }
      });

      if (response.data.status === 'OK') {
        return response.data.result;
      }
      return null;
    } catch (error) {
      console.error(`Error getting place details: ${error.message}`);
      return null;
    }
  }

  /**
   * Search Companies House (UK companies)
   */
  async searchCompaniesHouse(industryName, limit = 20) {
    if (!this.hasCompaniesHouse || this.country !== 'United Kingdom') {
      return [];
    }

    try {
      console.log(`   🔍 Searching Companies House for ${industryName} in ${this.city}`);

      const response = await axios.get('https://api.company-information.service.gov.uk/search/companies', {
        params: {
          q: `${industryName} ${this.city}`,
          items_per_page: limit
        },
        auth: {
          username: this.companiesHouseKey,
          password: ''
        }
      });

      const companies = [];

      if (response.data.items) {
        for (const company of response.data.items) {
          if (company.company_status === 'active') {
            companies.push({
              name: company.company_name,
              address: company.address_snippet,
              city: this.city,
              region: this.region,
              country: this.country,
              industry: industryName,
              companyNumber: company.company_number,
              incorporationDate: company.date_of_creation,
              companyType: company.company_type,
              verified: true,
              source: 'Companies House UK'
            });
          }
        }
      }

      return companies;
    } catch (error) {
      console.error(`   ❌ Companies House error:`, error.message);
      return [];
    }
  }

  /**
   * Extract domain from website URL
   */
  extractDomain(website) {
    if (!website) return null;
    try {
      const url = new URL(website);
      return url.hostname.replace('www.', '');
    } catch {
      return null;
    }
  }

  /**
   * Generate email patterns for a company
   */
  generateEmailPatterns(companyName, website) {
    const domain = this.extractDomain(website);
    if (!domain) return null;

    return {
      format: `{first}.{last}@${domain}`,
      patterns: [
        `info@${domain}`,
        `contact@${domain}`,
        `hello@${domain}`,
        `sales@${domain}`
      ]
    };
  }

  /**
   * Save company to database
   */
  async saveCompany(company) {
    const client = await pool.connect();
    try {
      const domain = this.extractDomain(company.website);
      const emailFormat = this.generateEmailPatterns(company.name, company.website);

      const result = await client.query(
        `INSERT INTO accounts (
          company_name, industry, country, state_region, city, address,
          website, phone_number, email_format, company_size,
          rating, total_ratings, place_id, verified, data_source, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (company_name, city, state_region) DO NOTHING
        RETURNING account_id`,
        [
          company.name,
          company.industry,
          company.country,
          company.region,
          company.city,
          company.address,
          company.website,
          company.phone,
          emailFormat?.format,
          'Unknown', // Size not available from Places API
          company.rating,
          company.totalRatings,
          company.placeId || company.companyNumber,
          company.verified,
          company.source
        ]
      );

      if (result.rows.length > 0) {
        this.companiesFound++;
        console.log(`   ✅ Saved: ${company.name}`);
        return true;
      } else {
        console.log(`   ⚠️  Duplicate: ${company.name}`);
        return false;
      }
    } catch (error) {
      if (!error.message.includes('duplicate') && !error.message.includes('unique')) {
        console.error(`   ❌ Error saving ${company.name}:`, error.message);
      }
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Delay helper for rate limiting
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Main discovery function
   */
  async discover(limit = 100) {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  DISCOVERING REAL COMPANIES IN ${this.city.toUpperCase()}`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    if (!this.hasGooglePlaces && !this.hasCompaniesHouse) {
      console.error('❌ No API keys configured! Please add:');
      console.error('   - GOOGLE_PLACES_API_KEY for global company search');
      console.error('   - COMPANIES_HOUSE_API_KEY for UK company search (optional)');
      console.error('\nAdd these to your .env file to enable real company discovery.');
      return;
    }

    const industries = this.getIndustries();
    const companiesPerIndustry = Math.ceil(limit / industries.length);

    console.log(`📍 Location: ${this.city}, ${this.region}, ${this.country}`);
    console.log(`📊 Industries: ${industries.length}`);
    console.log(`🏢 Target: ${limit} companies\n`);

    for (const industry of industries) {
      if (this.companiesFound >= limit) break;

      console.log(`\n🔍 Searching ${industry.name}...`);

      let companies = [];

      // Use Companies House for UK
      if (this.country === 'United Kingdom' && this.hasCompaniesHouse) {
        const ukCompanies = await this.searchCompaniesHouse(industry.name, companiesPerIndustry);
        companies = companies.concat(ukCompanies);
      }

      // Use Google Places for all regions
      if (this.hasGooglePlaces) {
        const placesCompanies = await this.searchGooglePlaces(industry, companiesPerIndustry);
        companies = companies.concat(placesCompanies);
      }

      // Save companies
      for (const company of companies) {
        if (this.companiesFound >= limit) break;
        await this.saveCompany(company);
      }

      console.log(`   📊 Found ${companies.length} companies in ${industry.name}`);

      // Rate limiting
      await this.delay(500);
    }

    console.log(`\n✅ Discovery complete!`);
    console.log(`📊 Total verified companies saved: ${this.companiesFound}`);
    console.log(`📍 All companies are REAL and verified through official APIs\n`);
  }
}

// Main execution
async function main() {
  const city = process.argv[2];
  const region = process.argv[3];
  const country = process.argv[4] || 'United States';
  const limit = parseInt(process.argv[5]) || 100;

  if (!city || !region) {
    console.error('Usage: node discover-real-companies.js <city> <region> [country] [limit]');
    console.error('Example: node discover-real-companies.js "London" "England" "United Kingdom" 100');
    console.error('Example: node discover-real-companies.js "Birmingham" "Alabama" "United States" 50');
    process.exit(1);
  }

  const discovery = new RealCompanyDiscovery(city, region, country);

  try {
    await discovery.discover(limit);
    process.exit(0);
  } catch (error) {
    console.error('❌ Discovery failed:', error);
    process.exit(1);
  }
}

main();
