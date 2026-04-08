/**
 * Discover MORE New York Companies - Expanded Search
 * 
 * This script discovers additional NY companies by:
 * 1. Searching multiple NYC boroughs (Manhattan, Brooklyn, Queens, Bronx, Staten Island)
 * 2. Searching by industry categories
 * 3. Using various business directory patterns
 * 
 * Usage: node discover-more-ny-companies.js [limit]
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { pool } = require('../src/db/connection');

class NYCompanyDiscovery {
  constructor() {
    this.companiesFound = new Set();
    this.searchDelay = 3000; // 3 seconds between searches
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Search Bing for companies
   */
  async searchBing(query) {
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      const results = [];

      // Extract search results
      $('.b_algo').each((i, elem) => {
        const title = $(elem).find('h2').text().trim();
        const snippet = $(elem).find('.b_caption p').text().trim();
        const link = $(elem).find('h2 a').attr('href');

        if (title && link) {
          results.push({ title, snippet, link });
        }
      });

      return results;
    } catch (error) {
      console.error(`❌ Bing search error for "${query}":`, error.message);
      return [];
    }
  }

  /**
   * Extract company names from search results
   */
  extractCompanyNames(results) {
    const companies = [];

    for (const result of results) {
      // Look for company patterns in title
      let companyName = result.title;

      // Remove common suffixes from title
      companyName = companyName
        .replace(/\s*\|\s*.+$/, '') // Remove "| About" "| Contact" etc
        .replace(/\s*-\s*.+$/, '')  // Remove "- Home" etc
        .replace(/\s*–\s*.+$/, '')  // Remove em-dash suffixes
        .trim();

      // Skip if too short or generic
      if (companyName.length < 3 || companyName.length > 100) continue;
      if (companyName.match(/^(home|about|contact|search|find)/i)) continue;

      companies.push({
        name: companyName,
        website: result.link,
        snippet: result.snippet
      });
    }

    return companies;
  }

  /**
   * Check if company already exists in database
   */
  async companyExists(name) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id FROM companies WHERE LOWER(name) = LOWER($1) AND jurisdiction = 'us_ny' LIMIT 1`,
        [name]
      );
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Save company to database
   */
  async saveCompany(company) {
    const client = await pool.connect();
    try {
      // Generate a simple company number for US companies
      const companyNumber = `NY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      await client.query(
        `INSERT INTO companies (company_number, name, jurisdiction, locality, country, website, data_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (company_number) DO NOTHING`,
        [
          companyNumber,
          company.name,
          'us_ny',
          company.locality || 'New York City',
          'United States',
          company.website,
          'bing_search_discovery'
        ]
      );

      console.log(`✅ Saved: ${company.name}`);
      return true;
    } catch (error) {
      console.error(`❌ Error saving ${company.name}:`, error.message);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Discover companies by borough
   */
  async discoverByBorough(borough, industry, limit = 20) {
    console.log(`\n🔍 Searching ${borough} - ${industry}...`);
    
    const queries = [
      `${industry} companies in ${borough} New York`,
      `${industry} businesses ${borough} NYC`,
      `best ${industry} ${borough} New York`,
      `${borough} ${industry} directory`
    ];

    let found = 0;

    for (const query of queries) {
      if (found >= limit) break;

      console.log(`  Searching: "${query}"`);
      const results = await this.searchBing(query);
      const companies = this.extractCompanyNames(results);

      for (const company of companies) {
        if (found >= limit) break;
        
        const uniqueKey = `${company.name.toLowerCase()}-${borough}`;
        if (this.companiesFound.has(uniqueKey)) continue;
        
        const exists = await this.companyExists(company.name);
        if (exists) continue;

        company.locality = borough;
        await this.saveCompany(company);
        this.companiesFound.add(uniqueKey);
        found++;
      }

      await this.sleep(this.searchDelay);
    }

    return found;
  }

  /**
   * Main discovery process
   */
  async discover(totalLimit = 100) {
    console.log('🚀 Starting NYC Company Discovery');
    console.log(`📊 Target: ${totalLimit} new companies\n`);

    const boroughs = [
      'Manhattan',
      'Brooklyn', 
      'Queens',
      'Bronx',
      'Staten Island'
    ];

    const industries = [
      'Accounting', 'Agriculture', 'Airlines/Aviation', 'Alternative Medicine',
      'Animation', 'Apparel & Fashion', 'Architecture & Planning', 'Arts & Crafts',
      'Automotive', 'Aviation & Aerospace', 'Banking', 'Biotechnology',
      'Broadcast Media', 'Building Materials', 'Business Supplies & Equipment',
      'Capital Markets', 'Chemicals', 'Civil Engineering', 'Commercial Real Estate',
      'Computer & Network Security', 'Computer Games', 'Computer Software',
      'Construction', 'Consumer Electronics', 'Consumer Goods', 'Consumer Services',
      'Cosmetics', 'Design', 'E-Learning', 'Education Management',
      'Electrical/Electronic Manufacturing', 'Entertainment', 'Environmental Services',
      'Events Services', 'Facilities Services', 'Farming', 'Financial Services',
      'Fine Art', 'Food & Beverages', 'Food Production', 'Furniture',
      'Gambling & Casinos', 'Government Administration', 'Graphic Design',
      'Health, Wellness & Fitness', 'Higher Education', 'Hospital & Health Care',
      'Hospitality', 'Human Resources', 'Import & Export',
      'Industrial Automation', 'Information Technology & Services',
      'Insurance', 'Internet', 'Investment Banking', 'Investment Management',
      'Law Practice', 'Legal Services', 'Leisure, Travel & Tourism',
      'Logistics & Supply Chain', 'Luxury Goods & Jewelry', 'Machinery',
      'Management Consulting', 'Maritime', 'Market Research',
      'Marketing & Advertising', 'Media Production', 'Medical Devices',
      'Medical Practice', 'Mental Health Care', 'Mining & Metals',
      'Motion Pictures & Film', 'Music', 'Nonprofit Organization Management',
      'Oil & Energy', 'Online Media', 'Pharmaceuticals', 'Photography',
      'Plastics', 'Printing', 'Professional Training & Coaching',
      'Public Relations & Communications', 'Publishing', 'Real Estate',
      'Recreational Facilities & Services', 'Research', 'Restaurants',
      'Retail', 'Security & Investigations', 'Semiconductors',
      'Sporting Goods', 'Sports', 'Staffing & Recruiting', 'Supermarkets',
      'Telecommunications', 'Textiles', 'Transportation/Trucking/Railroad',
      'Utilities', 'Venture Capital & Private Equity', 'Veterinary',
      'Warehousing', 'Wholesale', 'Wine & Spirits', 'Wireless'
    ];

    let totalFound = 0;
    const limitPerSearch = Math.ceil(totalLimit / (boroughs.length * industries.length / 2));

    // Iterate through combinations
    for (const borough of boroughs) {
      for (const industry of industries) {
        if (totalFound >= totalLimit) break;

        const found = await this.discoverByBorough(borough, industry, limitPerSearch);
        totalFound += found;

        console.log(`📈 Progress: ${totalFound}/${totalLimit} companies discovered`);
      }
      if (totalFound >= totalLimit) break;
    }

    console.log(`\n✅ Discovery Complete!`);
    console.log(`📊 Total new companies found: ${totalFound}`);
    console.log(`💡 These companies will be enriched by background workers\n`);
  }
}

// Run if called directly
if (require.main === module) {
  const limit = parseInt(process.argv[2]) || 100;
  
  const discovery = new NYCompanyDiscovery();
  discovery.discover(limit)
    .then(() => {
      console.log('✅ Discovery process completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Discovery failed:', error);
      process.exit(1);
    });
}

module.exports = NYCompanyDiscovery;
