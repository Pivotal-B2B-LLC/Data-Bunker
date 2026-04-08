#!/usr/bin/env node
/**
 * FREE US Company Discovery via Web Search
 * No API costs - uses Google search + web scraping
 * Discovers companies by location, industry, size
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { pool } = require('../src/db/connection');
const webScraperService = require('../src/services/webScraperService');

class FreeUSCompanyDiscovery {
  constructor(options = {}) {
    this.state = options.state || 'California';
    this.industry = options.industry || 'technology';
    this.city = options.city || null;
    this.limit = options.limit || 100;
    this.batchSize = options.batchSize || 10;
    
    this.stats = {
      discovered: 0,
      saved: 0,
      enriched: 0,
      errors: 0
    };

    // Search queries to find companies
    this.searchTemplates = [
      '{industry} companies in {location}',
      'top {industry} businesses {location}',
      '{industry} firms located in {location}',
      'best {industry} companies {location}',
      'list of {industry} businesses in {location}'
    ];
  }

  async init() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('     FREE US COMPANY DISCOVERY (No API Required)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Location: ${this.city ? this.city + ', ' : ''}${this.state}`);
    console.log(`Industry: ${this.industry}`);
    console.log(`Target: ${this.limit} companies`);
    console.log(`Method: Web Search + Scraping (100% Free)`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }

  /**
   * Search web directories and databases
   */
  async searchCompanyDatabases(query) {
    const companies = [];
    
    // Use DuckDuckGo (less restrictive than Google)
    try {
      const duckQuery = encodeURIComponent(query + ' site:linkedin.com OR site:crunchbase.com');
      const url = `https://html.duckduckgo.com/html/?q=${duckQuery}`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      
      $('.result').each((i, elem) => {
        const $elem = $(elem);
        const title = $elem.find('.result__title').text().trim();
        const link = $elem.find('.result__url').text().trim();
        const snippet = $elem.find('.result__snippet').text().trim();

        if (title && link) {
          const companyName = title.replace(/\s*[-|–]\s*.+$/, '').trim();
          const cleanUrl = link.replace(/^https?:\/\//, '').split('/')[0];
          
          companies.push({
            name: companyName,
            website: `https://${cleanUrl}`,
            description: snippet,
            source: 'web_search'
          });
        }
      });
    } catch (error) {
      console.error(`   ⚠️  DuckDuckGo search error:`, error.message);
    }

    return companies;
  }

  /**
   * Search Google for companies (scrape results page)
   */
  async searchGoogle(query) {
    try {
      // Use alternative search method
      return await this.searchCompanyDatabases(query);

      const $ = cheerio.load(response.data);
      const results = [];

      // Parse search results
      $('div.g').each((i, elem) => {
        const $elem = $(elem);
        const title = $elem.find('h3').first().text();
        const link = $elem.find('a').first().attr('href');
        const snippet = $elem.find('.VwiC3b').text() || $elem.find('.lEBKkf').text();

        if (title && link && link.startsWith('http')) {
          // Extract company name from title
          const companyName = title.replace(/\s*[-|–]\s*.+$/, '').trim();
          
          results.push({
            name: companyName,
            website: link,
            description: snippet,
            source: 'google_search'
          });
        }
      });

      await this.sleep(2000); // Be respectful to Google
      return results;
    } catch (error) {
      console.error(`   ⚠️  Search error:`, error.message);
      return [];
    }
  }

  /**
   * Discover companies using multiple search strategies
   */
  async discoverCompanies() {
    console.log('🔍 Discovering companies via web search...\n');
    
    const allCompanies = new Map();
    const location = this.city ? `${this.city} ${this.state}` : this.state;

    for (const template of this.searchTemplates) {
      if (allCompanies.size >= this.limit) break;

      const query = template
        .replace('{industry}', this.industry)
        .replace('{location}', location);

      console.log(`   Searching: "${query}"`);
      
      const results = await this.searchGoogle(query);
      console.log(`   Found: ${results.length} results`);

      for (const company of results) {
        if (allCompanies.size >= this.limit) break;
        
        // Deduplicate by domain
        const domain = this.extractDomain(company.website);
        if (!allCompanies.has(domain)) {
          allCompanies.set(domain, company);
        }
      }

      await this.sleep(3000); // Rate limiting
    }

    return Array.from(allCompanies.values());
  }

  /**
   * Search business directories (Yelp, Yellow Pages, etc.)
   */
  async searchBusinessDirectories() {
    console.log('\n📂 Searching business directories...\n');
    
    const companies = [];
    const location = this.city ? `${this.city}-${this.state}` : this.state;

    // Yellow Pages search
    try {
      console.log('   Checking Yellow Pages...');
      const ypQuery = `${this.industry} ${location}`.replace(/\s+/g, '+');
      const ypUrl = `https://www.yellowpages.com/search?search_terms=${ypQuery}&geo_location_terms=${location}`;
      
      const response = await axios.get(ypUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      
      $('.result').each((i, elem) => {
        if (companies.length >= 50) return;
        
        const $elem = $(elem);
        const name = $elem.find('.business-name').text().trim();
        const website = $elem.find('.track-visit-website').attr('href');
        const phone = $elem.find('.phone').text().trim();
        const address = $elem.find('.street-address').text().trim();
        const city = $elem.find('.locality').text().trim();

        if (name && website) {
          companies.push({
            name,
            website,
            phone,
            address_line_1: address,
            locality: city,
            region: this.state,
            country: 'United States',
            source: 'yellowpages'
          });
        }
      });

      console.log(`   ✓ Found ${companies.length} from Yellow Pages`);
    } catch (error) {
      console.error('   ⚠️  Yellow Pages error:', error.message);
    }

    await this.sleep(2000);
    return companies;
  }

  /**
   * Enrich company data by scraping their website
   */
  async enrichCompany(company) {
    try {
      console.log(`   Enriching: ${company.name}`);

      // Scrape website for additional data
      const scrapedData = await webScraperService.scrapeWebsite(company.website);

      if (scrapedData) {
        return {
          ...company,
          email: scrapedData.email || company.email,
          phone: scrapedData.phone || company.phone,
          address_line_1: scrapedData.address || company.address_line_1,
          description: scrapedData.description || company.description
        };
      }

      return company;
    } catch (error) {
      console.error(`   ⚠️  Enrichment failed for ${company.name}:`, error.message);
      return company;
    }
  }

  /**
   * Save company to database
   */
  async saveCompany(company) {
    const client = await pool.connect();

    try {
      // Generate company number from domain
      const domain = this.extractDomain(company.website);
      const companyNumber = `us_web_${domain.replace(/[^a-z0-9]/g, '_')}`;

      const result = await client.query(
        `INSERT INTO companies (
          company_number, name, jurisdiction, 
          address_line_1, locality, region, country,
          website, phone, email, description,
          industry, data_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (company_number) DO UPDATE SET
          website = EXCLUDED.website,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          last_updated = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted`,
        [
          companyNumber,
          company.name,
          this.getStateCode(),
          company.address_line_1,
          company.locality || this.city,
          company.region || this.state,
          'United States',
          company.website,
          company.phone,
          company.email,
          company.description,
          this.industry,
          company.source || 'web_discovery'
        ]
      );

      client.release();
      return result.rows[0].inserted;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  /**
   * Main execution
   */
  async run() {
    await this.init();

    const startTime = Date.now();

    // Step 1: Discover companies via web search
    const discovered = await this.discoverCompanies();
    this.stats.discovered = discovered.length;
    console.log(`\n✅ Discovered ${discovered.length} companies\n`);

    // Step 2: Search business directories
    const directoryCompanies = await this.searchBusinessDirectories();
    const allCompanies = [...discovered, ...directoryCompanies];
    console.log(`\n📊 Total companies found: ${allCompanies.length}\n`);

    // Step 3: Enrich and save in batches
    console.log('💾 Saving and enriching companies...\n');

    for (let i = 0; i < allCompanies.length; i += this.batchSize) {
      const batch = allCompanies.slice(i, i + this.batchSize);
      
      console.log(`Processing batch ${Math.floor(i / this.batchSize) + 1}...`);

      for (const company of batch) {
        try {
          // Enrich with website data
          const enriched = await this.enrichCompany(company);
          
          // Save to database
          const inserted = await this.saveCompany(enriched);
          
          if (inserted) {
            this.stats.saved++;
          }
          
          if (enriched.email || enriched.phone) {
            this.stats.enriched++;
          }

          console.log(`   ✓ ${company.name} ${enriched.email ? '✉️' : ''} ${enriched.phone ? '📞' : ''}`);
        } catch (error) {
          console.error(`   ❌ Failed: ${company.name} - ${error.message}`);
          this.stats.errors++;
        }

        await this.sleep(1000); // Rate limiting
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('           DISCOVERY COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Duration: ${duration}s`);
    console.log(`Discovered: ${this.stats.discovered}`);
    console.log(`Saved: ${this.stats.saved}`);
    console.log(`Enriched (email/phone): ${this.stats.enriched}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log('═══════════════════════════════════════════════════════════');
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  }

  getStateCode() {
    const stateCodes = {
      'california': 'us_ca', 'texas': 'us_tx', 'florida': 'us_fl',
      'new york': 'us_ny', 'pennsylvania': 'us_pa', 'illinois': 'us_il',
      'ohio': 'us_oh', 'georgia': 'us_ga', 'north carolina': 'us_nc',
      'michigan': 'us_mi', 'washington': 'us_wa', 'arizona': 'us_az',
      'massachusetts': 'us_ma', 'tennessee': 'us_tn', 'indiana': 'us_in',
      'missouri': 'us_mo', 'maryland': 'us_md', 'wisconsin': 'us_wi',
      'colorado': 'us_co', 'minnesota': 'us_mn', 'virginia': 'us_va',
      'oregon': 'us_or', 'new jersey': 'us_nj'
    };
    return stateCodes[this.state.toLowerCase()] || 'us_other';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
FREE US Company Discovery (No API Costs)

Usage:
  node discover-us-companies-free.js [options]

Options:
  --state <name>          US state (default: California)
  --city <name>           City name (optional)
  --industry <type>       Industry type (default: technology)
  --limit <number>        Max companies to find (default: 100)
  --help, -h              Show this help

Examples:
  # Tech companies in California
  node discover-us-companies-free.js --state California --industry technology

  # Restaurants in New York City
  node discover-us-companies-free.js --state "New York" --city "New York City" --industry restaurant --limit 200

  # Law firms in Texas
  node discover-us-companies-free.js --state Texas --industry legal

  # Healthcare in Florida
  node discover-us-companies-free.js --state Florida --industry healthcare --limit 150

Industries:
  technology, software, healthcare, finance, legal, real estate,
  construction, manufacturing, retail, restaurant, consulting,
  marketing, education, automotive, energy, agriculture

How It Works:
  1. Searches Google for companies in your target location/industry
  2. Scrapes business directories (Yellow Pages, etc.)
  3. Visits each company website to extract email/phone
  4. Saves to your database
  5. Your enrichment workers continue improving data

Cost: $0 (100% free using web scraping)
`);
    process.exit(0);
  }

  let state = 'California';
  let city = null;
  let industry = 'technology';
  let limit = 100;

  if (args.includes('--state')) {
    state = args[args.indexOf('--state') + 1];
  }
  if (args.includes('--city')) {
    city = args[args.indexOf('--city') + 1];
  }
  if (args.includes('--industry')) {
    industry = args[args.indexOf('--industry') + 1];
  }
  if (args.includes('--limit')) {
    limit = parseInt(args[args.indexOf('--limit') + 1]);
  }

  const discoverer = new FreeUSCompanyDiscovery({ state, city, industry, limit });

  discoverer.run()
    .then(() => {
      console.log('\n✅ Discovery completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Discovery failed:', error.message);
      process.exit(1);
    });
}

module.exports = FreeUSCompanyDiscovery;
