#!/usr/bin/env node

/**
 * 100% FREE COMPANY DISCOVERY - OPENSTREETMAP ONLY
 *
 * NO API KEY REQUIRED
 * NO SIGNUP REQUIRED
 * NO PAYMENT INFO REQUIRED
 *
 * Uses OpenStreetMap data via Overpass API
 * Completely free forever!
 *
 * Usage: node discover-osm-only.js <city> <state/region> <country> [limit]
 */

const axios = require('axios');
const { pool } = require('../src/db/connection');

class OSMCompanyDiscovery {
  constructor(city, region, country = 'United States') {
    this.city = city;
    this.region = region;
    this.country = country;
    this.companiesFound = 0;

    console.log('\n🆓 100% FREE - NO API KEY NEEDED!');
    console.log('   Using: OpenStreetMap (Free Forever)\n');
  }

  /**
   * Get search categories
   */
  getCategories() {
    return {
      restaurants: { tags: 'amenity~"restaurant|cafe|fast_food"', name: 'Restaurants & Food' },
      retail: { tags: 'shop', name: 'Retail & Shopping' },
      healthcare: { tags: 'amenity~"doctors|dentist|clinic|hospital|pharmacy"', name: 'Healthcare' },
      professional: { tags: 'office', name: 'Professional Services' },
      services: { tags: 'shop~"beauty|hairdresser|car_repair|laundry"', name: 'Personal Services' },
      finance: { tags: 'amenity~"bank|atm"', name: 'Financial Services' },
      education: { tags: 'amenity~"school|university|college"', name: 'Education' },
      automotive: { tags: 'shop~"car|car_repair|car_parts"', name: 'Automotive' }
    };
  }

  /**
   * Search OpenStreetMap via Overpass API
   */
  async searchOpenStreetMap(categoryKey, category, limit = 50) {
    try {
      console.log(`   🔍 Searching: ${category.name}`);

      // Get city bounding box
      const geocodeResponse = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: `${this.city}, ${this.region}, ${this.country}`,
          format: 'json',
          limit: 1
        },
        headers: {
          'User-Agent': 'DataBunker/1.0'
        }
      });

      if (!geocodeResponse.data || geocodeResponse.data.length === 0) {
        console.log(`   ⚠️  City not found: ${this.city}`);
        return [];
      }

      const bbox = geocodeResponse.data[0].boundingbox;

      // Query Overpass API
      const overpassQuery = `
        [out:json][timeout:30];
        (
          node[${category.tags}](${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]});
          way[${category.tags}](${bbox[0]},${bbox[2]},${bbox[1]},${bbox[3]});
        );
        out center ${limit};
      `;

      const overpassResponse = await axios.post(
        'https://overpass-api.de/api/interpreter',
        overpassQuery,
        {
          headers: { 'Content-Type': 'text/plain' },
          timeout: 35000
        }
      );

      if (overpassResponse.data.elements) {
        const companies = overpassResponse.data.elements
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
              category: category.name,
              latitude: element.lat || element.center?.lat,
              longitude: element.lon || element.center?.lon,
              verified: true,
              source: 'OpenStreetMap',
              osmId: element.id,
              osmType: element.type
            };
          });

        console.log(`   ✅ Found ${companies.length} businesses`);
        return companies;
      }

      return [];
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.error(`   ⏱️  Timeout - try a smaller area or reduce limit`);
      } else {
        console.error(`   ❌ Error:`, error.message);
      }
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

      // Check if exists
      const existsResult = await client.query(
        `SELECT account_id FROM accounts
         WHERE company_name = $1 AND city = $2 AND state_region = $3`,
        [company.name, company.city, company.region]
      );

      if (existsResult.rows.length > 0) {
        return false;
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
          null, // No ratings in OSM
          null,
          company.osmId,
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
   * Remove duplicates
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

  /**
   * Main discovery function
   */
  async discover(limit = 100) {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║  FREE DISCOVERY: ${this.city.toUpperCase()}`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    const categories = this.getCategories();
    const companiesPerCategory = Math.ceil(limit / Object.keys(categories).length);

    console.log(`📍 Location: ${this.city}, ${this.region}, ${this.country}`);
    console.log(`📊 Categories: ${Object.keys(categories).length}`);
    console.log(`🏢 Target: ${limit} companies`);
    console.log(`🗺️  Data Source: OpenStreetMap (Free Forever!)\n`);

    for (const [categoryKey, category] of Object.entries(categories)) {
      if (this.companiesFound >= limit) break;

      console.log(`\n🔍 ${category.name}...`);

      const companies = await this.searchOpenStreetMap(categoryKey, category, companiesPerCategory);

      // Save companies
      const uniqueCompanies = this.deduplicateCompanies(companies);
      for (const company of uniqueCompanies) {
        if (this.companiesFound >= limit) break;
        await this.saveCompany(company);
      }

      // Respect OSM rate limits
      await this.delay(1000);
    }

    console.log(`\n✅ Discovery complete!`);
    console.log(`📊 Total companies saved: ${this.companiesFound}`);
    console.log(`💰 Total cost: $0.00 (100% FREE!)`);
    console.log(`🗺️  Source: OpenStreetMap - https://www.openstreetmap.org\n`);
  }
}

// Main execution
async function main() {
  const city = process.argv[2];
  const region = process.argv[3];
  const country = process.argv[4] || 'United States';
  const limit = parseInt(process.argv[5]) || 100;

  if (!city || !region) {
    console.error('\n╔════════════════════════════════════════════════════════╗');
    console.error('║  100% FREE Company Discovery - OpenStreetMap          ║');
    console.error('╚════════════════════════════════════════════════════════╝\n');
    console.error('Usage: node discover-osm-only.js <city> <region> [country] [limit]\n');
    console.error('Examples:');
    console.error('  node discover-osm-only.js "Birmingham" "Alabama" "United States" 50');
    console.error('  node discover-osm-only.js "London" "England" "United Kingdom" 100');
    console.error('  node discover-osm-only.js "Toronto" "Ontario" "Canada" 75\n');
    console.error('💡 NO API KEY NEEDED - Works immediately!\n');
    process.exit(1);
  }

  const discovery = new OSMCompanyDiscovery(city, region, country);

  try {
    await discovery.discover(limit);
    process.exit(0);
  } catch (error) {
    console.error('❌ Discovery failed:', error.message);
    process.exit(1);
  }
}

main();
