#!/usr/bin/env node

/**
 * UNIVERSAL US COMPANY DISCOVERY
 * 
 * Discovers companies in ANY US city or state
 * Usage: node discover-us-companies.js <city> <state> [limit]
 * 
 * Examples:
 *   node discover-us-companies.js "Los Angeles" "California" 500
 *   node discover-us-companies.js "Miami" "Florida" 300
 *   node discover-us-companies.js "Chicago" "Illinois" 400
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../src/db/connection');

class USCompanyDiscovery {
  constructor(city, state, stateCode) {
    this.city = city;
    this.state = state;
    this.stateCode = stateCode;
    this.jurisdiction = `us_${stateCode.toLowerCase()}`;
    this.companiesFound = new Set();
    this.searchDelay = 2500;
    this.progressFile = path.join(__dirname, `../data/${stateCode.toLowerCase()}-discovery-progress.json`);
    this.completedFile = path.join(__dirname, `../data/${stateCode.toLowerCase()}-completed-areas.json`);
    this.completedAreas = [];
    this.totalSearches = 0;
    this.totalCompaniesFound = 0;
    this.startTime = new Date();
  }

  /**
   * Professional LinkedIn-style industries
   */
  getIndustries() {
    return [
      'Accounting', 'Agriculture', 'Airlines/Aviation', 'Alternative Dispute Resolution',
      'Alternative Medicine', 'Animation', 'Apparel & Fashion', 'Architecture & Planning',
      'Arts & Crafts', 'Automotive', 'Aviation & Aerospace', 'Banking', 'Biotechnology',
      'Broadcast Media', 'Building Materials', 'Business Supplies & Equipment',
      'Capital Markets', 'Chemicals', 'Civic & Social Organization', 'Civil Engineering',
      'Commercial Real Estate', 'Computer & Network Security', 'Computer Games',
      'Computer Hardware', 'Computer Networking', 'Computer Software', 'Construction',
      'Consumer Electronics', 'Consumer Goods', 'Consumer Services', 'Cosmetics',
      'Dairy', 'Defense & Space', 'Design', 'E-Learning', 'Education Management',
      'Electrical/Electronic Manufacturing', 'Entertainment', 'Environmental Services',
      'Events Services', 'Executive Office', 'Facilities Services', 'Farming',
      'Financial Services', 'Fine Art', 'Fishery', 'Food & Beverages', 'Food Production',
      'Fund-Raising', 'Furniture', 'Gambling & Casinos', 'Glass, Ceramics & Concrete',
      'Government Administration', 'Government Relations', 'Graphic Design',
      'Health, Wellness & Fitness', 'Higher Education', 'Hospital & Health Care',
      'Hospitality', 'Human Resources', 'Import & Export', 'Individual & Family Services',
      'Industrial Automation', 'Information Services', 'Information Technology & Services',
      'Insurance', 'International Affairs', 'International Trade & Development',
      'Internet', 'Investment Banking', 'Investment Management', 'Judiciary',
      'Law Enforcement', 'Law Practice', 'Legal Services', 'Legislative Office',
      'Leisure, Travel & Tourism', 'Libraries', 'Logistics & Supply Chain',
      'Luxury Goods & Jewelry', 'Machinery', 'Management Consulting', 'Maritime',
      'Market Research', 'Marketing & Advertising', 'Mechanical or Industrial Engineering',
      'Media Production', 'Medical Devices', 'Medical Practice', 'Mental Health Care',
      'Military', 'Mining & Metals', 'Motion Pictures & Film', 'Museums & Institutions',
      'Music', 'Nanotechnology', 'Newspapers', 'Nonprofit Organization Management',
      'Oil & Energy', 'Online Media', 'Outsourcing/Offshoring', 'Package/Freight Delivery',
      'Packaging & Containers', 'Paper & Forest Products', 'Performing Arts',
      'Pharmaceuticals', 'Philanthropy', 'Photography', 'Plastics',
      'Political Organization', 'Primary/Secondary Education', 'Printing',
      'Professional Training & Coaching', 'Program Development', 'Public Policy',
      'Public Relations & Communications', 'Public Safety', 'Publishing',
      'Railroad Manufacture', 'Ranching', 'Real Estate', 'Recreational Facilities & Services',
      'Religious Institutions', 'Renewables & Environment', 'Research', 'Restaurants',
      'Retail', 'Security & Investigations', 'Semiconductors', 'Shipbuilding',
      'Sporting Goods', 'Sports', 'Staffing & Recruiting', 'Supermarkets',
      'Telecommunications', 'Textiles', 'Think Tanks', 'Tobacco',
      'Translation & Localization', 'Transportation/Trucking/Railroad', 'Utilities',
      'Venture Capital & Private Equity', 'Veterinary', 'Warehousing', 'Wholesale',
      'Wine & Spirits', 'Wireless', 'Writing & Editing'
    ];
  }

  /**
   * Get neighborhoods for major cities
   */
  getNeighborhoods() {
    const neighborhoods = {
      'Los Angeles': [
        'Downtown LA', 'Hollywood', 'Beverly Hills', 'Santa Monica', 'Venice Beach',
        'Westwood', 'Culver City', 'Silver Lake', 'Echo Park', 'Koreatown',
        'Little Tokyo', 'Arts District', 'West Hollywood', 'Pasadena', 'Glendale',
        'Burbank', 'Studio City', 'Sherman Oaks', 'Van Nuys', 'Woodland Hills'
      ],
      'San Francisco': [
        'Financial District', 'SoMa', 'Mission District', 'Castro', 'Haight-Ashbury',
        'Marina District', 'North Beach', 'Chinatown', 'Nob Hill', 'Russian Hill',
        'Pacific Heights', 'Richmond District', 'Sunset District', 'Potrero Hill'
      ],
      'Chicago': [
        'The Loop', 'River North', 'Gold Coast', 'Lincoln Park', 'Wicker Park',
        'Bucktown', 'Logan Square', 'Pilsen', 'Chinatown', 'Hyde Park',
        'South Loop', 'West Loop', 'Old Town', 'Lakeview', 'Andersonville'
      ],
      'Houston': [
        'Downtown', 'Midtown', 'Montrose', 'Heights', 'River Oaks',
        'Galleria', 'Memorial', 'Museum District', 'East End', 'Third Ward'
      ],
      'Phoenix': [
        'Downtown Phoenix', 'Scottsdale', 'Tempe', 'Mesa', 'Chandler',
        'Glendale', 'Peoria', 'Camelback East', 'Arcadia', 'Biltmore'
      ],
      'Philadelphia': [
        'Center City', 'Old City', 'Rittenhouse Square', 'Fishtown', 'Northern Liberties',
        'South Philadelphia', 'University City', 'Manayunk', 'Chestnut Hill'
      ],
      'Miami': [
        'Downtown Miami', 'Brickell', 'Wynwood', 'Design District', 'Little Havana',
        'Coral Gables', 'Coconut Grove', 'South Beach', 'Miami Beach', 'Key Biscayne'
      ],
      'Boston': [
        'Downtown', 'Back Bay', 'Beacon Hill', 'North End', 'South End',
        'Fenway', 'Seaport District', 'Cambridge', 'Somerville', 'Brookline'
      ],
      'Seattle': [
        'Downtown', 'Capitol Hill', 'Fremont', 'Ballard', 'Queen Anne',
        'University District', 'Wallingford', 'Green Lake', 'Belltown', 'Pioneer Square'
      ],
      'Denver': [
        'Downtown', 'LoDo', 'RiNo', 'Capitol Hill', 'Highland',
        'Cherry Creek', 'Washington Park', 'Five Points', 'Baker', 'Congress Park'
      ],
      'Austin': [
        'Downtown', 'South Congress', 'East Austin', 'Hyde Park', 'Zilker',
        'Barton Hills', 'Travis Heights', 'West Campus', 'North Loop', 'Mueller'
      ],
      'default': [
        'Downtown', 'Midtown', 'Uptown', 'Eastside', 'Westside',
        'Northside', 'Southside', 'Historic District', 'Business District'
      ]
    };

    return neighborhoods[this.city] || neighborhoods['default'];
  }

  /**
   * Search patterns
   */
  getSearchPatterns(location, industry) {
    return [
      `${industry} in ${location} ${this.city}`,
      `${industry} ${location} ${this.state}`,
      `best ${industry} ${location} ${this.city}`,
      `${location} ${this.city} ${industry}`,
      `${industry} near ${location} ${this.city}`,
      `${this.city} ${this.state} ${industry} ${location}`,
      `${industry} businesses ${location}`
    ];
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async loadProgress() {
    try {
      const data = await fs.readFile(this.completedFile, 'utf8');
      this.completedAreas = JSON.parse(data);
      console.log(`📂 Loaded ${this.completedAreas.length} completed areas`);
    } catch (error) {
      this.completedAreas = [];
    }
  }

  async saveProgress() {
    try {
      await fs.mkdir(path.dirname(this.completedFile), { recursive: true });
      await fs.writeFile(this.completedFile, JSON.stringify(this.completedAreas, null, 2));
      
      const stats = {
        city: this.city,
        state: this.state,
        jurisdiction: this.jurisdiction,
        totalSearches: this.totalSearches,
        totalCompaniesFound: this.totalCompaniesFound,
        completedAreas: this.completedAreas.length,
        startTime: this.startTime,
        lastUpdate: new Date(),
        companiesPerHour: this.totalCompaniesFound / ((Date.now() - this.startTime) / 3600000)
      };
      
      await fs.writeFile(this.progressFile, JSON.stringify(stats, null, 2));
    } catch (error) {
      console.error('❌ Save error:', error.message);
    }
  }

  isAreaCompleted(neighborhood, industry) {
    return this.completedAreas.includes(`${neighborhood}:${industry}`);
  }

  markAreaCompleted(neighborhood, industry) {
    const key = `${neighborhood}:${industry}`;
    if (!this.completedAreas.includes(key)) {
      this.completedAreas.push(key);
    }
  }

  async searchBing(query) {
    try {
      this.totalSearches++;
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      const results = [];

      $('.b_algo').each((i, elem) => {
        const title = $(elem).find('h2').text().trim();
        const snippet = $(elem).find('.b_caption p, .b_caption').text().trim();
        const link = $(elem).find('h2 a').attr('href');

        if (title && link && !link.includes('bing.com')) {
          results.push({ title, snippet, link });
        }
      });

      return results;
    } catch (error) {
      console.error(`❌ Search error: ${error.message}`);
      return [];
    }
  }

  extractCompanyInfo(result, location) {
    let companyName = result.title
      .replace(/\s*[\|\-–]\s*.+$/, '')
      .replace(/\s*:.*$/, '')
      .trim();

    if (companyName.length < 3 || companyName.length > 150) return null;
    if (companyName.match(/^(home|about|contact|services|welcome|find|search)/i)) return null;
    if (companyName.match(/^(yelp|google|facebook|maps|directory)/i)) return null;

    return {
      name: companyName,
      website: result.link,
      locality: location,
      snippet: result.snippet
    };
  }

  async companyExists(name) {
    const client = await pool.connect();
    try {
      // Check both companies and accounts tables for duplicates
      const result = await client.query(
        `SELECT id FROM companies 
         WHERE LOWER(name) = LOWER($1) 
         AND jurisdiction = $2
         LIMIT 1
         
         UNION
         
         SELECT id FROM accounts
         WHERE LOWER(name) = LOWER($1)
         AND country = 'United States'
         LIMIT 1`,
        [name, this.jurisdiction]
      );
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  async saveCompany(company) {
    const client = await pool.connect();
    try {
      const companyNumber = `${this.stateCode}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Insert into companies table
      await client.query(
        `INSERT INTO companies (company_number, name, jurisdiction, locality, region, country, website, data_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_number) DO NOTHING`,
        [
          companyNumber,
          company.name,
          this.jurisdiction,
          company.locality,
          this.state,
          'United States',
          company.website,
          'comprehensive_search'
        ]
      );

      // Also insert into accounts table for immediate availability
      await client.query(
        `INSERT INTO accounts (
          name, 
          country, 
          state_region, 
          city, 
          website, 
          source,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT DO NOTHING`,
        [
          company.name,
          'United States',
          this.state,
          company.locality,
          company.website,
          'discovery'
        ]
      );

      this.totalCompaniesFound++;
      return true;
    } catch (error) {
      console.error(`❌ Save error: ${error.message}`);
      return false;
    } finally {
      client.release();
    }
  }

  async searchArea(neighborhood, industry) {
    if (this.isAreaCompleted(neighborhood, industry)) return 0;

    console.log(`\n🔍 ${neighborhood} > ${industry}`);
    
    let foundInArea = 0;
    const patterns = this.getSearchPatterns(neighborhood, industry);

    for (const query of patterns) {
      try {
        const results = await this.searchBing(query);
        
        for (const result of results) {
          const companyInfo = this.extractCompanyInfo(result, neighborhood);
          if (!companyInfo) continue;

          const exists = await this.companyExists(companyInfo.name);
          if (exists) continue;

          const saved = await this.saveCompany(companyInfo);
          if (saved) {
            foundInArea++;
            console.log(`  ✅ ${companyInfo.name}`);
          }
        }

        await this.sleep(this.searchDelay);
      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
      }
    }

    this.markAreaCompleted(neighborhood, industry);
    
    if (foundInArea > 0) {
      console.log(`  📊 Found ${foundInArea} companies`);
    }

    return foundInArea;
  }

  async discover(limit = null) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log(`║  DISCOVERING COMPANIES IN ${this.city.toUpperCase()}, ${this.state.toUpperCase()}`.padEnd(64) + '║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    await this.loadProgress();

    const neighborhoods = this.getNeighborhoods();
    const industries = this.getIndustries();
    
    console.log(`📍 Neighborhoods: ${neighborhoods.length}`);
    console.log(`🏢 Industries: ${industries.length}`);
    console.log(`🔍 Total searches: ${neighborhoods.length * industries.length}`);
    console.log(`⏱️  Estimated time: ${Math.ceil(neighborhoods.length * industries.length * this.searchDelay / 1000 / 3600)} hours\n`);
    
    let searchesCompleted = 0;

    for (const neighborhood of neighborhoods) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📍 ${neighborhood.toUpperCase()}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      for (const industry of industries) {
        await this.searchArea(neighborhood, industry);
        searchesCompleted++;

        if (limit && this.totalCompaniesFound >= limit) {
          console.log(`\n✅ Reached target of ${limit} companies!`);
          await this.saveProgress();
          return;
        }

        if (searchesCompleted % 50 === 0) {
          await this.saveProgress();
          console.log(`\n📊 Progress: ${searchesCompleted} searches, ${this.totalCompaniesFound} companies found\n`);
        }
      }
    }

    await this.saveProgress();
    
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  DISCOVERY COMPLETE!                                         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`📊 Total searches: ${this.totalSearches}`);
    console.log(`🏢 Companies found: ${this.totalCompaniesFound}`);
  }
}

// State code mapping
const STATE_CODES = {
  'california': 'CA', 'texas': 'TX', 'florida': 'FL', 'new york': 'NY',
  'illinois': 'IL', 'pennsylvania': 'PA', 'ohio': 'OH', 'georgia': 'GA',
  'north carolina': 'NC', 'michigan': 'MI', 'new jersey': 'NJ', 'virginia': 'VA',
  'washington': 'WA', 'arizona': 'AZ', 'massachusetts': 'MA', 'tennessee': 'TN',
  'indiana': 'IN', 'missouri': 'MO', 'maryland': 'MD', 'wisconsin': 'WI',
  'colorado': 'CO', 'minnesota': 'MN', 'south carolina': 'SC', 'alabama': 'AL',
  'louisiana': 'LA', 'kentucky': 'KY', 'oregon': 'OR', 'oklahoma': 'OK',
  'connecticut': 'CT', 'utah': 'UT', 'iowa': 'IA', 'nevada': 'NV',
  'arkansas': 'AR', 'mississippi': 'MS', 'kansas': 'KS', 'new mexico': 'NM',
  'nebraska': 'NE', 'west virginia': 'WV', 'idaho': 'ID', 'hawaii': 'HI',
  'new hampshire': 'NH', 'maine': 'ME', 'montana': 'MT', 'rhode island': 'RI',
  'delaware': 'DE', 'south dakota': 'SD', 'north dakota': 'ND', 'alaska': 'AK',
  'vermont': 'VT', 'wyoming': 'WY'
};

if (require.main === module) {
  const city = process.argv[2];
  const state = process.argv[3];
  const limit = parseInt(process.argv[4]) || null;

  if (!city || !state) {
    console.log('Usage: node discover-us-companies.js <city> <state> [limit]');
    console.log('\nExamples:');
    console.log('  node discover-us-companies.js "Los Angeles" "California" 500');
    console.log('  node discover-us-companies.js "Miami" "Florida" 300');
    console.log('  node discover-us-companies.js "Chicago" "Illinois" 400');
    console.log('  node discover-us-companies.js "Austin" "Texas"');
    process.exit(1);
  }

  const stateCode = STATE_CODES[state.toLowerCase()];
  if (!stateCode) {
    console.error(`❌ Unknown state: ${state}`);
    process.exit(1);
  }

  const discovery = new USCompanyDiscovery(city, state, stateCode);
  
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down - saving progress...');
    await discovery.saveProgress();
    process.exit(0);
  });

  discovery.discover(limit)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

module.exports = USCompanyDiscovery;
