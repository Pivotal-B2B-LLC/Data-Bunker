#!/usr/bin/env node

/**
 * COMPREHENSIVE NEW YORK COMPANY DISCOVERY
 * 
 * This script systematically discovers ALL companies in New York by:
 * - Searching EVERY borough, neighborhood, and district
 * - Covering ALL major industries
 * - Using multiple search patterns
 * - Tracking completed areas
 * - Running continuously until exhaustive
 * 
 * Goal: Find EVERY business in New York City and State
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../src/db/connection');

class ComprehensiveNYDiscovery {
  constructor() {
    this.companiesFound = new Set();
    this.searchDelay = 2500; // 2.5 seconds between searches
    this.progressFile = path.join(__dirname, '../data/ny-discovery-progress.json');
    this.completedAreasFile = path.join(__dirname, '../data/ny-completed-areas.json');
    this.statsFile = path.join(__dirname, '../data/ny-discovery-stats.json');
    
    // Track what we've searched
    this.completedAreas = [];
    this.totalSearches = 0;
    this.totalCompaniesFound = 0;
    this.startTime = new Date();
  }

  /**
   * All NYC neighborhoods by borough - COMPREHENSIVE
   */
  getLocations() {
    return {
      manhattan: [
        'Financial District', 'Tribeca', 'SoHo', 'Greenwich Village', 'East Village',
        'West Village', 'Chelsea', 'Gramercy', 'Flatiron', 'Midtown', 'Times Square',
        'Murray Hill', 'Hell\'s Kitchen', 'Upper East Side', 'Upper West Side',
        'Harlem', 'East Harlem', 'Washington Heights', 'Inwood', 'Chinatown',
        'Little Italy', 'NoHo', 'NoLita', 'Bowery', 'Lower East Side',
        'Alphabet City', 'Kips Bay', 'Lenox Hill', 'Carnegie Hill', 'Yorkville',
        'Lincoln Square', 'Columbus Circle', 'Sutton Place', 'Turtle Bay',
        'Garment District', 'Diamond District', 'Hudson Yards', 'Battery Park City',
        'Two Bridges', 'Civic Center'
      ],
      brooklyn: [
        'Williamsburg', 'DUMBO', 'Brooklyn Heights', 'Park Slope', 'Prospect Heights',
        'Crown Heights', 'Bedford-Stuyvesant', 'Bushwick', 'Greenpoint', 'Red Hook',
        'Carroll Gardens', 'Cobble Hill', 'Boerum Hill', 'Fort Greene', 'Clinton Hill',
        'Downtown Brooklyn', 'Brooklyn Navy Yard', 'Sunset Park', 'Bay Ridge',
        'Dyker Heights', 'Bensonhurst', 'Brighton Beach', 'Coney Island', 'Sheepshead Bay',
        'Marine Park', 'Mill Basin', 'Canarsie', 'East New York', 'Brownsville',
        'East Flatbush', 'Flatbush', 'Midwood', 'Ditmas Park', 'Kensington',
        'Borough Park', 'Flatlands', 'Gravesend', 'Bath Beach', 'Bay Ridge'
      ],
      queens: [
        'Long Island City', 'Astoria', 'Sunnyside', 'Woodside', 'Jackson Heights',
        'Elmhurst', 'Corona', 'Flushing', 'Forest Hills', 'Rego Park',
        'Kew Gardens', 'Jamaica', 'Richmond Hill', 'South Ozone Park', 'Howard Beach',
        'Rockaway Beach', 'Bayside', 'Whitestone', 'College Point', 'Douglaston',
        'Little Neck', 'Auburndale', 'Fresh Meadows', 'Briarwood', 'Kew Gardens Hills',
        'Middle Village', 'Glendale', 'Ridgewood', 'Maspeth', 'Woodhaven',
        'Ozone Park', 'South Richmond Hill', 'Springfield Gardens', 'Rosedale',
        'Bellerose', 'Floral Park', 'Glen Oaks', 'Queens Village'
      ],
      bronx: [
        'Mott Haven', 'Hunts Point', 'Longwood', 'Melrose', 'Morrisania',
        'East Tremont', 'Fordham', 'Belmont', 'Kingsbridge', 'Riverdale',
        'Spuyten Duyvil', 'Woodlawn', 'Wakefield', 'Williamsbridge', 'Baychester',
        'Co-op City', 'Pelham Bay', 'Throgs Neck', 'Country Club', 'City Island',
        'Parkchester', 'Soundview', 'Castle Hill', 'Clason Point', 'Westchester Square',
        'Morris Heights', 'University Heights', 'Jerome Park', 'Norwood',
        'Bedford Park', 'Allerton', 'Pelham Parkway', 'Van Nest'
      ],
      statenIsland: [
        'St. George', 'Tompkinsville', 'Stapleton', 'Clifton', 'Rosebank',
        'South Beach', 'Midland Beach', 'New Dorp', 'Oakwood', 'Bay Terrace',
        'Great Kills', 'Eltingville', 'Annadale', 'Huguenot', 'Tottenville',
        'Pleasant Plains', 'Woodrow', 'Rossville', 'Charleston', 'Richmondtown',
        'Dongan Hills', 'Todt Hill', 'Emerson Hill', 'Grymes Hill', 'Silver Lake',
        'Port Richmond', 'West Brighton', 'New Brighton', 'Randall Manor',
        'Mariners Harbor', 'Arlington', 'Graniteville', 'Bulls Head'
      ]
    };
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
      
      // Other Services
      'moving company', 'storage facility', 'security company', 'printing shop',
      'shipping store', 'copy center', 'office supply'
    ];
  }

  /**
   * Search patterns for maximum coverage
   */
  getSearchPatterns(location, industry) {
    return [
      `${industry} in ${location}`,
      `${industry} ${location} New York`,
      `best ${industry} ${location}`,
      `${location} ${industry} directory`,
      `${industry} near ${location}`,
      `${location} NY ${industry}`,
      `${industry} businesses ${location}`
    ];
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Load progress from previous runs
   */
  async loadProgress() {
    try {
      const data = await fs.readFile(this.completedAreasFile, 'utf8');
      this.completedAreas = JSON.parse(data);
      console.log(`📂 Loaded ${this.completedAreas.length} completed areas`);
    } catch (error) {
      this.completedAreas = [];
      console.log('📂 Starting fresh - no previous progress found');
    }
  }

  /**
   * Save progress
   */
  async saveProgress() {
    try {
      await fs.mkdir(path.dirname(this.completedAreasFile), { recursive: true });
      await fs.writeFile(
        this.completedAreasFile,
        JSON.stringify(this.completedAreas, null, 2)
      );
      
      // Save statistics
      const stats = {
        totalSearches: this.totalSearches,
        totalCompaniesFound: this.totalCompaniesFound,
        completedAreas: this.completedAreas.length,
        startTime: this.startTime,
        lastUpdate: new Date(),
        companiesPerHour: this.totalCompaniesFound / ((Date.now() - this.startTime) / 3600000)
      };
      
      await fs.writeFile(this.statsFile, JSON.stringify(stats, null, 2));
      console.log(`💾 Progress saved: ${this.completedAreas.length} areas completed`);
    } catch (error) {
      console.error('❌ Failed to save progress:', error.message);
    }
  }

  /**
   * Check if area already searched
   */
  isAreaCompleted(borough, neighborhood, industry) {
    const key = `${borough}:${neighborhood}:${industry}`;
    return this.completedAreas.includes(key);
  }

  /**
   * Mark area as completed
   */
  markAreaCompleted(borough, neighborhood, industry) {
    const key = `${borough}:${neighborhood}:${industry}`;
    if (!this.completedAreas.includes(key)) {
      this.completedAreas.push(key);
    }
  }

  /**
   * Search Bing for companies
   */
  async searchBing(query) {
    try {
      this.totalSearches++;
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
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

  /**
   * Extract company info from search result
   */
  extractCompanyInfo(result, location) {
    let companyName = result.title
      .replace(/\s*[\|\-–]\s*.+$/, '')
      .replace(/\s*:.*$/, '')
      .trim();

    // Skip generic or invalid names
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

  /**
   * Check if company exists
   */
  async companyExists(name, locality) {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id FROM companies 
         WHERE LOWER(name) = LOWER($1) 
         AND (jurisdiction = 'us_ny' OR LOWER(locality) = LOWER($2))
         LIMIT 1`,
        [name, locality]
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
      const companyNumber = `NY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      await client.query(
        `INSERT INTO companies (company_number, name, jurisdiction, locality, region, country, website, data_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (company_number) DO NOTHING`,
        [
          companyNumber,
          company.name,
          'us_ny',
          company.locality,
          'New York',
          'United States',
          company.website,
          'comprehensive_search'
        ]
      );

      this.totalCompaniesFound++;
      return true;
    } catch (error) {
      console.error(`❌ Save error for ${company.name}:`, error.message);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Search a specific area thoroughly
   */
  async searchArea(borough, neighborhood, industry) {
    const areaKey = `${borough}:${neighborhood}:${industry}`;
    
    if (this.isAreaCompleted(borough, neighborhood, industry)) {
      return 0; // Already searched
    }

    console.log(`\n🔍 ${borough} > ${neighborhood} > ${industry}`);
    
    let foundInArea = 0;
    const patterns = this.getSearchPatterns(neighborhood, industry);

    for (const query of patterns) {
      try {
        const results = await this.searchBing(query);
        
        for (const result of results) {
          const companyInfo = this.extractCompanyInfo(result, neighborhood);
          if (!companyInfo) continue;

          const exists = await this.companyExists(companyInfo.name, neighborhood);
          if (exists) continue;

          const saved = await this.saveCompany(companyInfo);
          if (saved) {
            foundInArea++;
            console.log(`  ✅ ${companyInfo.name}`);
          }
        }

        await this.sleep(this.searchDelay);
      } catch (error) {
        console.error(`  ❌ Error searching "${query}":`, error.message);
      }
    }

    this.markAreaCompleted(borough, neighborhood, industry);
    
    if (foundInArea > 0) {
      console.log(`  📊 Found ${foundInArea} new companies in ${neighborhood} ${industry}`);
    }

    return foundInArea;
  }

  /**
   * Main comprehensive discovery
   */
  async discover() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  COMPREHENSIVE NEW YORK COMPANY DISCOVERY                    ║');
    console.log('║  Goal: Find EVERY business in NYC                            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    await this.loadProgress();

    const locations = this.getLocations();
    const industries = this.getIndustries();
    
    const totalAreas = Object.values(locations).flat().length;
    const totalSearches = totalAreas * industries.length;
    
    console.log(`📍 Locations: ${totalAreas} neighborhoods`);
    console.log(`🏢 Industries: ${industries.length} types`);
    console.log(`🔍 Total searches: ${totalSearches}`);
    console.log(`⏱️  Estimated time: ${Math.ceil(totalSearches * this.searchDelay / 1000 / 3600)} hours\n`);
    
    let searchesCompleted = 0;

    for (const [borough, neighborhoods] of Object.entries(locations)) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📍 BOROUGH: ${borough.toUpperCase()}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      for (const neighborhood of neighborhoods) {
        for (const industry of industries) {
          await this.searchArea(borough, neighborhood, industry);
          searchesCompleted++;

          // Save progress every 50 searches
          if (searchesCompleted % 50 === 0) {
            await this.saveProgress();
            const progress = (searchesCompleted / totalSearches * 100).toFixed(1);
            console.log(`\n📊 PROGRESS: ${searchesCompleted}/${totalSearches} (${progress}%)`);
            console.log(`📈 Total companies found: ${this.totalCompaniesFound}`);
            console.log(`⏱️  Running time: ${Math.ceil((Date.now() - this.startTime) / 60000)} minutes\n`);
          }
        }
      }
    }

    await this.saveProgress();
    
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  DISCOVERY COMPLETE!                                         ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`📊 Total searches: ${this.totalSearches}`);
    console.log(`🏢 Total companies found: ${this.totalCompaniesFound}`);
    console.log(`📍 Areas completed: ${this.completedAreas.length}`);
    console.log(`⏱️  Total time: ${Math.ceil((Date.now() - this.startTime) / 60000)} minutes\n`);
  }
}

// Run if called directly
if (require.main === module) {
  const discovery = new ComprehensiveNYDiscovery();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down - saving progress...');
    await discovery.saveProgress();
    process.exit(0);
  });

  discovery.discover()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

module.exports = ComprehensiveNYDiscovery;
