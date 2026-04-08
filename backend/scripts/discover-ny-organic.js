#!/usr/bin/env node
/**
 * Organic Company Discovery for New York
 * Searches for ALL companies (small, medium, large) across industries
 * Uses multiple search strategies to find real businesses
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { pool } = require('../src/db/connection');

class OrganicNYCompanyDiscovery {
  constructor(options = {}) {
    this.limit = options.limit || 200;
    this.discoveredCompanies = new Map(); // Use Map to deduplicate by domain
    
    // Search queries targeting different business sizes and industries
    this.searchQueries = [
      // Small businesses
      'small businesses in New York City',
      'local companies in Manhattan',
      'startups in Brooklyn',
      'small business owners New York',
      'independent businesses NYC',
      
      // Medium businesses
      'medium sized companies New York',
      'private companies NYC',
      'family owned businesses New York',
      'privately held companies Manhattan',
      
      // By industry - small to medium focus
      'restaurants in New York City',
      'retail stores Manhattan',
      'consulting firms NYC',
      'law firms New York',
      'accounting firms NYC',
      'marketing agencies New York',
      'real estate companies NYC',
      'construction companies New York',
      'healthcare providers Manhattan',
      'dental practices NYC',
      'medical practices New York',
      'insurance agencies NYC',
      'financial advisors Manhattan',
      'architecture firms New York',
      'engineering companies NYC',
      'IT services companies New York',
      'web design agencies NYC',
      'graphic design studios Manhattan',
      'advertising agencies New York',
      'PR firms NYC',
      'event planning companies New York',
      'catering companies NYC',
      'bakeries Manhattan',
      'coffee shops Brooklyn',
      'boutique clothing stores NYC',
      'beauty salons New York',
      'barbershops Manhattan',
      'gyms and fitness centers NYC',
      'yoga studios New York',
      'photography studios NYC',
      'printing companies Manhattan',
      'moving companies New York',
      'cleaning services NYC',
      'landscaping companies New York',
      'plumbing companies NYC',
      'electrical contractors Manhattan',
      'HVAC companies New York',
      'auto repair shops NYC',
      'car dealerships New York',
      'furniture stores Manhattan',
      'home improvement stores NYC',
      'pet stores New York',
      'veterinary clinics NYC',
      'bookstores Manhattan',
      'art galleries New York',
      'music stores NYC',
      'florists Manhattan',
      'jewelry stores New York',
      'watch repair shops NYC'
    ];

    this.stats = {
      queriesProcessed: 0,
      companiesDiscovered: 0,
      companiesSaved: 0,
      enriched: 0,
      errors: 0
    };
  }

  async init() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   ORGANIC NEW YORK COMPANY DISCOVERY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Target: All companies (small, medium, large)`);
    console.log(`Search queries: ${this.searchQueries.length}`);
    console.log(`Goal: ${this.limit} companies`);
    console.log(`Method: Organic web search + enrichment`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }

  /**
   * Search Bing (less restrictive than Google)
   */
  async searchBing(query) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://www.bing.com/search?q=${encodedQuery}&count=50`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      const results = [];

      // Parse Bing results
      $('.b_algo').each((i, elem) => {
        const $elem = $(elem);
        const title = $elem.find('h2 a').text().trim();
        let link = $elem.find('h2 a').attr('href');
        const snippet = $elem.find('.b_caption p').text().trim();

        // Fix Bing redirect URLs
        if (link && link.includes('bing.com')) {
          // Extract actual URL from Bing redirect
          const match = link.match(/[?&]u=([^&]+)/);
          if (match) {
            link = decodeURIComponent(match[1]);
          } else {
            return; // Skip if can't extract real URL
          }
        }

        if (title && link && link.startsWith('http')) {
          // Clean company name
          let companyName = title
            .replace(/\s*[-|–]\s*.+$/, '')
            .replace(/\s*\|\s*.+$/, '')
            .replace(/\s*\.\.\.$/, '')
            .replace(/^Official Site.*:\s*/i, '')
            .trim();

          // Extract from snippet if title is not good
          if (companyName.length < 3 || companyName.includes('...')) {
            const match = snippet.match(/^([^-|.]{3,50})/);
            if (match) companyName = match[1].trim();
          }

          if (companyName && companyName.length >= 3) {
            results.push({
              name: companyName,
              website: link,
              description: snippet,
              source: 'bing_search'
            });
          }
        }
      });

      return results;
    } catch (error) {
      console.error(`   ⚠️  Bing search error:`, error.message);
      return [];
    }
  }

  /**
   * Extract domain from URL for deduplication
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  }

  /**
   * Extract company info from website
   */
  async enrichFromWebsite(company) {
    try {
      const response = await axios.get(company.website, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 8000,
        maxRedirects: 3
      });

      const $ = cheerio.load(response.data);
      const text = $('body').text();

      // Extract email
      const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const email = emailMatch ? emailMatch[1] : null;

      // Extract phone (US format)
      const phoneMatch = text.match(/(\+?1?[-.\s]?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
      const phone = phoneMatch ? phoneMatch[1].replace(/[^\d+]/g, '').replace(/^1/, '+1') : null;

      // Get better description
      const metaDesc = $('meta[name="description"]').attr('content') || 
                       $('meta[property="og:description"]').attr('content');

      return {
        ...company,
        email,
        phone,
        description: metaDesc || company.description
      };
    } catch (error) {
      return company;
    }
  }

  /**
   * Discover companies through organic search
   */
  async discoverCompanies() {
    console.log('🔍 Discovering companies organically...\n');

    for (const query of this.searchQueries) {
      if (this.discoveredCompanies.size >= this.limit) {
        console.log(`\n✓ Reached target of ${this.limit} companies\n`);
        break;
      }

      console.log(`   [${this.stats.queriesProcessed + 1}/${this.searchQueries.length}] Searching: "${query}"`);

      try {
        const results = await this.searchBing(query);
        
        for (const company of results) {
          const domain = this.extractDomain(company.website);
          
          // Skip duplicates and non-business domains
          if (this.discoveredCompanies.has(domain)) continue;
          if (this.isInvalidDomain(domain)) {
            console.log(`      ⊘ Skipping: ${domain}`);
            continue;
          }

          this.discoveredCompanies.set(domain, company);
          console.log(`      ✓ Added: ${company.name} (${domain})`);
          
          if (this.discoveredCompanies.size >= this.limit) break;
        }

        console.log(`      → Found ${results.length} results, total unique: ${this.discoveredCompanies.size}`);
        this.stats.queriesProcessed++;

        // Rate limiting
        await this.sleep(3000);
      } catch (error) {
        console.error(`   ❌ Query failed:`, error.message);
        this.stats.errors++;
      }
    }

    this.stats.companiesDiscovered = this.discoveredCompanies.size;
    return Array.from(this.discoveredCompanies.values());
  }

  /**
   * Filter out invalid domains
   */
  isInvalidDomain(domain) {
    const invalidDomains = [
      'yelp.com', 'yellowpages.com', 'facebook.com', 'twitter.com',
      'linkedin.com', 'instagram.com', 'wikipedia.org', 'youtube.com',
      'bing.com', 'tripadvisor.com',
      'foursquare.com', 'mapquest.com', 'bbb.org', 'indeed.com',
      'craigslist.org', 'reddit.com', 'nextdoor.com'
    ];
    
    // Check if domain exactly matches or ends with these (to avoid filtering business websites)
    for (const invalid of invalidDomains) {
      if (domain === invalid || domain.endsWith('.' + invalid)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Save company to database
   */
  async saveCompany(company) {
    const client = await pool.connect();

    try {
      const domain = this.extractDomain(company.website);
      const companyNumber = `us_ny_${domain.replace(/[^a-z0-9]/g, '_')}`;

      const result = await client.query(
        `INSERT INTO companies (
          company_number, name, jurisdiction,
          locality, region, country,
          website, phone, email, description,
          data_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (company_number) DO UPDATE SET
          website = EXCLUDED.website,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          description = EXCLUDED.description,
          last_updated = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted`,
        [
          companyNumber,
          company.name,
          'us_ny',
          'New York',
          'New York',
          'United States',
          company.website,
          company.phone,
          company.email,
          company.description,
          'organic_search'
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

    // Step 1: Discover companies
    const companies = await this.discoverCompanies();

    console.log(`\n✅ Discovery complete: ${companies.length} unique companies found\n`);

    // Step 2: Enrich and save
    console.log('💾 Enriching and saving companies...\n');

    let processed = 0;
    for (const company of companies) {
      try {
        processed++;
        console.log(`   [${processed}/${companies.length}] ${company.name}`);

        // Enrich with website data
        const enriched = await this.enrichFromWebsite(company);

        // Save to database
        const inserted = await this.saveCompany(enriched);

        if (inserted) {
          this.stats.companiesSaved++;
        }

        if (enriched.email || enriched.phone) {
          this.stats.enriched++;
          console.log(`      ✓ ${enriched.email ? '✉️ ' + enriched.email : ''} ${enriched.phone ? '📞 ' + enriched.phone : ''}`);
        }

        // Rate limiting
        await this.sleep(1500);
      } catch (error) {
        console.error(`   ❌ ${company.name}: ${error.message}`);
        this.stats.errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('           DISCOVERY COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Duration: ${Math.floor(duration / 60)}m ${duration % 60}s`);
    console.log(`Queries processed: ${this.stats.queriesProcessed}`);
    console.log(`Companies discovered: ${this.stats.companiesDiscovered}`);
    console.log(`Companies saved: ${this.stats.companiesSaved}`);
    console.log(`Enriched with contact info: ${this.stats.enriched}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log('═══════════════════════════════════════════════════════════');
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
Organic New York Company Discovery

Discovers ALL types of companies in New York (small, medium, large)
across multiple industries through organic web search.

Usage:
  node discover-ny-organic.js [options]

Options:
  --limit <number>    Number of companies to discover (default: 200)
  --help, -h          Show this help

Example:
  node discover-ny-organic.js --limit 500

What it does:
  1. Searches for companies across 50+ industries
  2. Finds small, medium, and large businesses
  3. Extracts company names from search results
  4. Visits each website to get email/phone
  5. Saves to database
  6. Your workers continue enriching

Industries covered:
  • Restaurants, retail, consulting, legal, accounting
  • Marketing, real estate, construction, healthcare
  • IT services, design, advertising, PR, events
  • Many more (50+ search categories)

Note: Takes longer but discovers real businesses of all sizes!
`);
    process.exit(0);
  }

  let limit = 200;
  if (args.includes('--limit')) {
    limit = parseInt(args[args.indexOf('--limit') + 1]);
  }

  const discoverer = new OrganicNYCompanyDiscovery({ limit });

  discoverer.run()
    .then(() => {
      console.log('\n✅ Discovery completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Discovery failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = OrganicNYCompanyDiscovery;
