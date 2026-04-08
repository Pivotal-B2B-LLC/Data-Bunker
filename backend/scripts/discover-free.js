#!/usr/bin/env node

/**
 * FREE COMPANY DISCOVERY SYSTEM
 *
 * Uses FREE APIs and data sources (no paid APIs required):
 * 1. Yelp Fusion API (Free: 5,000 calls/day)
 * 2. Overpass API (OpenStreetMap data - completely free)
 * 3. Companies House API (UK - completely free)
 * 4. Bing Local Search (Free tier)
 *
 * Usage: node discover-free.js <city> <state/region> <country> [limit]
 */

const axios = require('axios');
const { pool } = require('../src/db/connection');

class FreeCompanyDiscovery {
  constructor(city, region, country = 'United States') {
    this.city = city;
    this.region = region;
    this.country = country;
    this.companiesFound = 0;

    // Free API Keys (get these free APIs)
    this.yelpApiKey = process.env.YELP_API_KEY; // Free: https://www.yelp.com/developers
    this.bingApiKey = process.env.BING_MAPS_API_KEY; // Free tier: https://www.bingmapsportal.com/
    this.companiesHouseKey = process.env.COMPANIES_HOUSE_API_KEY; // Free: UK only

    console.log('\n🆓 FREE API Status:');
    console.log(`   Yelp API: ${this.yelpApiKey ? '✓ Available (Free 5,000/day)' : '✗ Not configured'}`);
    console.log(`   Bing Maps: ${this.bingApiKey ? '✓ Available (Free tier)' : '✗ Not configured'}`);
    console.log(`   OpenStreetMap: ✓ Always available (No key needed!)`);
    console.log(`   Companies House: ${this.companiesHouseKey ? '✓ Available (UK only, Free)' : '✗ Not configured'}\n`);
  }

  /**
   * Get search categories
   */
  getCategories() {
    return {
      restaurants: ['restaurants', 'food', 'cafes'],
      retail: ['shopping', 'retail'],
      healthcare: ['health', 'medical', 'dentists'],
      professional: ['professional', 'lawyers', 'accountants'],
      services: ['homeservices', 'beautysvc', 'auto']
    };
  }

  /**
   * Search Yelp Fusion API (FREE - 5,000 calls/day)
   */
  async searchYelp(category, limit = 20) {
    if (!this.yelpApiKey) {
      return [];
    }

    try {
      console.log(`   🔍 Searching Yelp: ${category}`);

      const response = await axios.get('https://api.yelp.com/v3/businesses/search', {
        headers: {
          'Authorization': `Bearer ${this.yelpApiKey}`
        },
        params: {
          location: `${this.city}, ${this.region}`,
          categories: category,
          limit: Math.min(limit, 50), // Yelp max is 50
          sort_by: 'rating'
        }
      });

      if (response.data.businesses) {
        return response.data.businesses.map(business => ({
          name: business.name,
          address: business.location.display_address.join(', '),
          city: business.location.city,
          region: business.location.state,
          country: this.country,
          phone: business.phone || business.display_phone,
          website: business.url,
          rating: business.rating,
          totalRatings: business.review_count,
          category: category,
          latitude: business.coordinates?.latitude,
          longitude: business.coordinates?.longitude,
          verified: true,
          source: 'Yelp (Free)',
          yelpId: business.id
        }));
      }

      return [];
    } catch (error) {
      if (error.response?.status === 429) {
        console.log(`   ⚠️  Yelp rate limit reached (5,000/day limit)`);
      } else {
        console.error(`   ❌ Yelp error:`, error.message);
      }
      return [];
    }
  }

  /**
   * Search OpenStreetMap via Overpass API (COMPLETELY FREE - NO API KEY!)
   */
  async searchOpenStreetMap(category, limit = 50) {
    try {
      console.log(`   🔍 Searching OpenStreetMap: ${category}`);

      // Get bounding box for city (approximate)
      const geocodeResponse = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: `${this.city}, ${this.region}`,
          format: 'json',
          limit: 1
        },
        headers: {
          'User-Agent': 'DataBunker/1.0' // Required by OSM
        }
      });

      if (!geocodeResponse.data || geocodeResponse.data.length === 0) {
        console.log(`   ℹ️  City not found in OpenStreetMap`);
        return [];
      }

      const bbox = geocodeResponse.data[0].boundingbox;

      // Map categories to OSM tags
      const osmTags = {
        restaurants: 'amenity~"restaurant|cafe|fast_food"',
        retail: 'shop',
        healthcare: 'amenity~"doctors|dentist|clinic|hospital"',
        professional: 'office',
        services: 'shop~"beauty|hairdresser|car_repair"'
      };

      const osmQuery = osmTags[category] || 'shop';

      // Query Overpass API
      const overpassQuery = `
        [out:json][timeout:25];
        (
          node[${osmQuery}](${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]});
          way[${osmQuery}](${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]});
        );
        out center ${limit};
      `;

      const overpassResponse = await axios.post(
        'https://overpass-api.de/api/interpreter',
        overpassQuery,
        {
          headers: { 'Content-Type': 'text/plain' },
          timeout: 30000
        }
      );

      if (overpassResponse.data.elements) {
        return overpassResponse.data.elements
          .filter(element => element.tags && element.tags.name)
          .map(element => {
            const tags = element.tags;
            return {
              name: tags.name,
              address: this.buildAddress(tags),
              city: tags['addr:city'] || this.city,
              region: tags['addr:state'] || this.region,
              country: this.country,
              phone: tags.phone || tags['contact:phone'],
              website: tags.website || tags['contact:website'],
              category: category,
              latitude: element.lat || element.center?.lat,
              longitude: element.lon || element.center?.lon,
              verified: true,
              source: 'OpenStreetMap (Free)',
              osmId: element.id
            };
          });
      }

      return [];
    } catch (error) {
      console.error(`   ❌ OpenStreetMap error:`, error.message);
      return [];
    }
  }

  /**
   * Build address from OSM tags
   */
  buildAddress(tags) {
    const parts = [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:city'],
      tags['addr:state'],
      tags['addr:postcode']
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(', ') : null;
  }

  /**
   * Search Bing Local Search (FREE tier)
   */
  async searchBing(category, limit = 20) {
    if (!this.bingApiKey) {
      return [];
    }

    try {
      console.log(`   🔍 Searching Bing: ${category}`);

      const response = await axios.get('https://dev.virtualearth.net/REST/v1/LocalSearch/', {
        params: {
          query: `${category} ${this.city} ${this.region}`,
          key: this.bingApiKey,
          maxResults: limit
        }
      });

      if (response.data.resourceSets && response.data.resourceSets[0]?.resources) {
        return response.data.resourceSets[0].resources.map(business => ({
          name: business.name,
          address: business.Address?.formattedAddress,
          city: business.Address?.locality || this.city,
          region: business.Address?.adminDistrict || this.region,
          country: this.country,
          phone: business.PhoneNumber,
          website: business.Website,
          category: category,
          latitude: business.GeocodePoint?.coordinates[0],
          longitude: business.GeocodePoint?.coordinates[1],
          verified: true,
          source: 'Bing (Free)'
        }));
      }

      return [];
    } catch (error) {
      console.error(`   ❌ Bing error:`, error.message);
      return [];
    }
  }

  /**
   * Search Companies House (UK - COMPLETELY FREE)
   */
  async searchCompaniesHouse(category, limit = 20) {
    if (!this.companiesHouseKey || this.country !== 'United Kingdom') {
      return [];
    }

    try {
      console.log(`   🔍 Searching Companies House: ${category} in ${this.city}`);

      const response = await axios.get('https://api.company-information.service.gov.uk/search/companies', {
        params: {
          q: `${category} ${this.city}`,
          items_per_page: limit
        },
        auth: {
          username: this.companiesHouseKey,
          password: ''
        }
      });

      if (response.data.items) {
        return response.data.items
          .filter(company => company.company_status === 'active')
          .map(company => ({
            name: company.company_name,
            address: company.address_snippet,
            city: this.city,
            region: this.region,
            country: this.country,
            category: category,
            companyNumber: company.company_number,
            incorporationDate: company.date_of_creation,
            companyType: company.company_type,
            verified: true,
            source: 'Companies House (Free)'
          }));
      }

      return [];
    } catch (error) {
      console.error(`   ❌ Companies House error:`, error.message);
      return [];
    }
  }

  /**
   * Extract domain from website
   */
  extractDomain(website) {
    if (!website) return null;
    try {
      const url = new URL(website.startsWith('http') ? website : `https://${website}`);
      return url.hostname.replace('www.', '');
    } catch {
      return null;
    }
  }

  /**
   * Generate email patterns
   */
  generateEmailPatterns(companyName, website) {
    const domain = this.extractDomain(website);
    if (!domain) return null;

    return {
      format: `{first}.{last}@${domain}`,
      patterns: [`info@${domain}`, `contact@${domain}`, `hello@${domain}`]
    };
  }

  /**
   * Save company to database
   */
  async saveCompany(company) {
    if (!company.name) return false;

    const client = await pool.connect();
    try {
      const emailFormat = this.generateEmailPatterns(company.name, company.website);

      // Check for existing company first
      const existsResult = await client.query(
        `SELECT account_id FROM accounts
         WHERE company_name = $1 AND city = $2 AND state_region = $3`,
        [company.name, company.city, company.region]
      );

      if (existsResult.rows.length > 0) {
        return false; // Already exists
      }

      const result = await client.query(
        `INSERT INTO accounts (
          company_name, industry, country, state_region, city, address,
          website, phone_number, email_format, rating, total_ratings,
          place_id, verified, data_source, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        RETURNING account_id`,
        [
          company.name,
          company.category,
          company.country,
          company.region,
          company.city,
          company.address,
          company.website,
          company.phone,
          emailFormat?.format,
          company.rating,
          company.totalRatings,
          company.yelpId || company.osmId || company.companyNumber,
          company.verified,
          company.source
        ]
      );

      if (result.rows.length > 0) {
        this.companiesFound++;
        console.log(`   ✅ Saved: ${company.name}`);
        return true;
      }
      return false;
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
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Main discovery function
   */
  async discover(limit = 100) {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  FREE COMPANY DISCOVERY: ${this.city.toUpperCase()}`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    const hasAnyApi = this.yelpApiKey || this.bingApiKey || this.companiesHouseKey;

    if (!hasAnyApi) {
      console.log('⚠️  No API keys configured, using OpenStreetMap only (always free!)');
      console.log('\n📋 Optional FREE APIs you can add:');
      console.log('   1. Yelp API (5,000 calls/day free): https://www.yelp.com/developers');
      console.log('   2. Bing Maps (free tier): https://www.bingmapsportal.com/');
      console.log('   3. Companies House (UK, free): https://developer.company-information.service.gov.uk/\n');
    }

    const categories = this.getCategories();
    const companiesPerCategory = Math.ceil(limit / Object.keys(categories).length);

    console.log(`📍 Location: ${this.city}, ${this.region}, ${this.country}`);
    console.log(`📊 Categories: ${Object.keys(categories).length}`);
    console.log(`🏢 Target: ${limit} companies\n`);

    for (const [categoryKey, searchTerms] of Object.entries(categories)) {
      if (this.companiesFound >= limit) break;

      console.log(`\n🔍 Searching ${categoryKey}...`);

      let companies = [];

      // Try each free API
      for (const term of searchTerms.slice(0, 2)) {
        if (this.companiesFound >= limit) break;

        // 1. Try Yelp (best results)
        if (this.yelpApiKey) {
          const yelpResults = await this.searchYelp(term, 10);
          companies = companies.concat(yelpResults);
          await this.delay(100); // Respect rate limits
        }

        // 2. Try Bing
        if (this.bingApiKey) {
          const bingResults = await this.searchBing(term, 10);
          companies = companies.concat(bingResults);
          await this.delay(100);
        }

        // 3. Try OpenStreetMap (always available, no key needed!)
        const osmResults = await this.searchOpenStreetMap(categoryKey, 15);
        companies = companies.concat(osmResults);
        await this.delay(1000); // OSM requires longer delays

        // 4. Try Companies House (UK only)
        if (this.country === 'United Kingdom' && this.companiesHouseKey) {
          const ukResults = await this.searchCompaniesHouse(term, 10);
          companies = companies.concat(ukResults);
          await this.delay(100);
        }
      }

      // Save companies
      const uniqueCompanies = this.deduplicateCompanies(companies);
      for (const company of uniqueCompanies) {
        if (this.companiesFound >= limit) break;
        await this.saveCompany(company);
      }

      console.log(`   📊 Found ${uniqueCompanies.length} unique companies in ${categoryKey}`);
    }

    console.log(`\n✅ Discovery complete!`);
    console.log(`📊 Total verified companies saved: ${this.companiesFound}`);
    console.log(`💰 Total cost: $0.00 (100% FREE!)\n`);
  }

  /**
   * Remove duplicate companies
   */
  deduplicateCompanies(companies) {
    const seen = new Set();
    return companies.filter(company => {
      const key = `${company.name}-${company.city}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// Main execution
async function main() {
  const city = process.argv[2];
  const region = process.argv[3];
  const country = process.argv[4] || 'United States';
  const limit = parseInt(process.argv[5]) || 100;

  if (!city || !region) {
    console.error('Usage: node discover-free.js <city> <region> [country] [limit]');
    console.error('\nExamples:');
    console.error('  node discover-free.js "Birmingham" "Alabama" "United States" 50');
    console.error('  node discover-free.js "London" "England" "United Kingdom" 100');
    console.error('\n💡 This script uses 100% FREE APIs - no payment required!');
    process.exit(1);
  }

  const discovery = new FreeCompanyDiscovery(city, region, country);

  try {
    await discovery.discover(limit);
    process.exit(0);
  } catch (error) {
    console.error('❌ Discovery failed:', error);
    process.exit(1);
  }
}

main();
