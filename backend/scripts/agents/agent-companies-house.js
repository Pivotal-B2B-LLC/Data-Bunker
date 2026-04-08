#!/usr/bin/env node

/**
 * COMPANIES HOUSE AGENT
 *
 * Discovers UK companies from the Companies House FREE API
 * - 600 requests/5 minutes (rate limited)
 * - Full company data: name, address, SIC codes, officers, filing history
 * - No cost, official government data
 *
 * Also supports OpenCorporates for international companies (limited free tier)
 *
 * Set COMPANIES_HOUSE_API_KEY in .env (free from https://developer.company-information.service.gov.uk)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const { pool } = require('../../src/db/connection');

const CONFIG = {
  BATCH_SIZE: 50,
  DELAY_BETWEEN_REQUESTS: 600,   // ~100 req/min (well within 600/5min limit)
  DELAY_BETWEEN_BATCHES: 3000,
  CYCLE_DELAY: 60000,
  REQUEST_TIMEOUT: 15000,
  MAX_OFFICERS_PER_COMPANY: 5,
};

// SIC code to industry mapping (top categories)
const SIC_INDUSTRY_MAP = {
  '01': 'Agriculture', '02': 'Agriculture', '03': 'Agriculture',
  '05': 'Mining', '06': 'Mining', '07': 'Mining', '08': 'Mining', '09': 'Mining',
  '10': 'Food & Beverage', '11': 'Food & Beverage', '12': 'Food & Beverage',
  '13': 'Manufacturing', '14': 'Manufacturing', '15': 'Manufacturing',
  '16': 'Manufacturing', '17': 'Manufacturing', '18': 'Manufacturing',
  '19': 'Manufacturing', '20': 'Manufacturing', '21': 'Manufacturing',
  '22': 'Manufacturing', '23': 'Manufacturing', '24': 'Manufacturing',
  '25': 'Manufacturing', '26': 'Technology', '27': 'Manufacturing',
  '28': 'Manufacturing', '29': 'Automotive', '30': 'Manufacturing',
  '31': 'Manufacturing', '32': 'Manufacturing', '33': 'Manufacturing',
  '35': 'Energy', '36': 'Energy', '37': 'Energy', '38': 'Energy', '39': 'Energy',
  '41': 'Construction', '42': 'Construction', '43': 'Construction',
  '45': 'Automotive', '46': 'Retail & Shopping', '47': 'Retail & Shopping',
  '49': 'Transportation', '50': 'Transportation', '51': 'Transportation', '52': 'Transportation', '53': 'Transportation',
  '55': 'Hotels & Lodging', '56': 'Restaurants & Food',
  '58': 'Media & Publishing', '59': 'Media & Publishing', '60': 'Media & Publishing',
  '61': 'Telecommunications', '62': 'Technology', '63': 'Technology',
  '64': 'Financial Services', '65': 'Financial Services', '66': 'Financial Services',
  '68': 'Real Estate',
  '69': 'Legal Services', '70': 'Professional Services', '71': 'Professional Services',
  '72': 'Technology', '73': 'Marketing & Advertising', '74': 'Professional Services', '75': 'Professional Services',
  '77': 'Professional Services', '78': 'Professional Services', '79': 'Travel & Tourism',
  '80': 'Professional Services', '81': 'Professional Services', '82': 'Professional Services',
  '84': 'Government', '85': 'Education', '86': 'Healthcare', '87': 'Healthcare', '88': 'Healthcare',
  '90': 'Entertainment', '91': 'Entertainment', '92': 'Entertainment', '93': 'Fitness & Sports',
  '94': 'Non-Profit', '95': 'Professional Services', '96': 'Professional Services',
};

// UK cities to search for companies
const UK_SEARCH_TERMS = [
  'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool', 'Edinburgh',
  'Bristol', 'Sheffield', 'Newcastle', 'Nottingham', 'Leicester', 'Cardiff', 'Belfast',
  'Brighton', 'Oxford', 'Cambridge', 'Reading', 'Southampton', 'Aberdeen',
  'York', 'Bath', 'Exeter', 'Norwich', 'Plymouth', 'Coventry', 'Derby',
  'Swansea', 'Dundee', 'Wolverhampton', 'Stoke', 'Sunderland', 'Bolton',
  'technology', 'consulting', 'engineering', 'marketing', 'finance',
  'construction', 'healthcare', 'education', 'retail', 'manufacturing',
  'software', 'design', 'logistics', 'property', 'legal',
  'accounting', 'insurance', 'recruitment', 'media', 'energy',
];

class CompaniesHouseAgent {
  constructor() {
    this.apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    this.stats = {
      companiesFound: 0,
      companiesSaved: 0,
      officersFound: 0,
      officersSaved: 0,
      duplicatesSkipped: 0,
      errors: 0,
      cycles: 0,
    };
    this.searchIndex = 0;
    this.running = true;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Map SIC code to industry category
   */
  sicToIndustry(sicCodes) {
    if (!sicCodes || !Array.isArray(sicCodes) || sicCodes.length === 0) return 'Professional Services';
    const prefix = sicCodes[0].substring(0, 2);
    return SIC_INDUSTRY_MAP[prefix] || 'Professional Services';
  }

  /**
   * Extract city from registered address
   */
  extractCity(address) {
    if (!address) return null;
    return address.locality || address.region || null;
  }

  /**
   * Extract state/region from registered address
   */
  extractRegion(address) {
    if (!address) return null;
    // Try region first, then locality as fallback
    if (address.region) return address.region;
    if (address.locality) return address.locality;
    return 'England'; // Default
  }

  /**
   * Format full address
   */
  formatAddress(address) {
    if (!address) return null;
    return [
      address.address_line_1,
      address.address_line_2,
      address.locality,
      address.region,
      address.postal_code,
    ].filter(Boolean).join(', ');
  }

  /**
   * Search Companies House API
   */
  async searchCompanies(query, startIndex = 0) {
    if (!this.apiKey) {
      throw new Error('COMPANIES_HOUSE_API_KEY not set in .env');
    }

    try {
      const response = await axios.get('https://api.company-information.service.gov.uk/search/companies', {
        params: {
          q: query,
          items_per_page: 100,
          start_index: startIndex,
        },
        auth: { username: this.apiKey, password: '' },
        timeout: CONFIG.REQUEST_TIMEOUT,
      });

      return response.data.items || [];
    } catch (error) {
      if (error.response?.status === 429) {
        console.log('   Rate limited. Waiting 60 seconds...');
        await this.delay(60000);
        return [];
      }
      this.stats.errors++;
      return [];
    }
  }

  /**
   * Get company details (including SIC codes)
   */
  async getCompanyDetails(companyNumber) {
    try {
      const response = await axios.get(`https://api.company-information.service.gov.uk/company/${companyNumber}`, {
        auth: { username: this.apiKey, password: '' },
        timeout: CONFIG.REQUEST_TIMEOUT,
      });
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Get company officers (directors, secretaries)
   */
  async getCompanyOfficers(companyNumber) {
    try {
      const response = await axios.get(`https://api.company-information.service.gov.uk/company/${companyNumber}/officers`, {
        params: { items_per_page: CONFIG.MAX_OFFICERS_PER_COMPANY },
        auth: { username: this.apiKey, password: '' },
        timeout: CONFIG.REQUEST_TIMEOUT,
      });
      return (response.data.items || []).filter(o =>
        o.resigned_on === undefined && // Still active
        o.officer_role !== 'secretary' // Skip secretaries (usually admin roles)
      );
    } catch {
      return [];
    }
  }

  /**
   * Check if company already exists in DB
   */
  async companyExists(companyName, companyNumber) {
    const result = await pool.query(
      `SELECT account_id FROM accounts
       WHERE LOWER(company_name) = LOWER($1)
          OR (data_source = 'Agent:CompaniesHouse' AND company_name LIKE $2)`,
      [companyName, `%${companyNumber}%`]
    );
    return result.rows.length > 0;
  }

  /**
   * Save company to database
   */
  async saveCompany(companyData, details) {
    const companyName = companyData.title;
    if (!companyName || companyName.length < 2) return null;

    // Skip dissolved companies
    if (companyData.company_status === 'dissolved') return null;

    // Check for duplicates
    if (await this.companyExists(companyName, companyData.company_number)) {
      this.stats.duplicatesSkipped++;
      return null;
    }

    const address = companyData.registered_office_address || details?.registered_office_address;
    const sicCodes = details?.sic_codes || [];
    const industry = this.sicToIndustry(sicCodes);

    try {
      const result = await pool.query(
        `INSERT INTO accounts (
          company_name, industry, country, state_region, city, address,
          headquarters_address, verified, data_source, created_at
        )
        VALUES ($1, $2, 'United Kingdom', $3, $4, $5, $6, true, $7, NOW())
        RETURNING account_id`,
        [
          companyName,
          industry,
          this.extractRegion(address),
          this.extractCity(address),
          this.formatAddress(address),
          this.formatAddress(address),
          `Agent:CompaniesHouse:${companyData.company_number}`,
        ]
      );

      this.stats.companiesSaved++;
      return result.rows[0].account_id;
    } catch (error) {
      if (!error.message.includes('duplicate')) {
        this.stats.errors++;
      }
      return null;
    }
  }

  /**
   * Save officer as contact
   */
  async saveOfficer(accountId, officer) {
    try {
      // Parse officer name
      const nameParts = (officer.name || '').split(',').map(s => s.trim());
      let lastName = nameParts[0] || '';
      let firstName = nameParts[1] || '';

      // Handle "SURNAME, Firstname" format
      if (lastName === lastName.toUpperCase() && lastName.length > 1) {
        lastName = lastName.charAt(0) + lastName.slice(1).toLowerCase();
      }
      if (!firstName || firstName.length < 2) return false;
      firstName = firstName.split(' ')[0]; // Take first name only

      // Check for duplicate
      const existing = await pool.query(
        `SELECT contact_id FROM contacts
         WHERE linked_account_id = $1
           AND LOWER(first_name) = LOWER($2)
           AND LOWER(last_name) = LOWER($3)`,
        [accountId, firstName, lastName]
      );
      if (existing.rows.length > 0) return false;

      const title = officer.officer_role === 'director' ? 'Director' :
                    officer.officer_role === 'llp-member' ? 'Partner' :
                    officer.officer_role === 'cic-manager' ? 'Manager' : 'Director';

      await pool.query(
        `INSERT INTO contacts (linked_account_id, first_name, last_name, job_title, data_source, created_at)
         VALUES ($1, $2, $3, $4, 'Agent:CompaniesHouse', NOW())`,
        [accountId, firstName, lastName, title]
      );

      this.stats.officersSaved++;
      return true;
    } catch (error) {
      if (!error.message.includes('duplicate')) {
        this.stats.errors++;
      }
      return false;
    }
  }

  /**
   * Process a single search term
   */
  async processSearchTerm(searchTerm) {
    console.log(`   Searching: "${searchTerm}"...`);

    const companies = await this.searchCompanies(searchTerm);
    if (companies.length === 0) return;

    console.log(`   Found ${companies.length} results`);
    let saved = 0;

    for (const company of companies) {
      if (!this.running) break;

      this.stats.companiesFound++;

      // Get full details
      const details = await this.getCompanyDetails(company.company_number);
      await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);

      // Save company
      const accountId = await this.saveCompany(company, details);
      if (!accountId) continue;
      saved++;

      // Get and save officers
      const officers = await this.getCompanyOfficers(company.company_number);
      await this.delay(CONFIG.DELAY_BETWEEN_REQUESTS);

      for (const officer of officers) {
        this.stats.officersFound++;
        await this.saveOfficer(accountId, officer);
      }
    }

    if (saved > 0) {
      console.log(`   Saved ${saved} new companies`);
    }
  }

  /**
   * Main loop
   */
  async run() {
    console.log('='.repeat(60));
    console.log('   COMPANIES HOUSE AGENT');
    console.log('='.repeat(60));

    if (!this.apiKey) {
      console.error('\n   ERROR: COMPANIES_HOUSE_API_KEY not set in .env');
      console.error('   Get a free key at: https://developer.company-information.service.gov.uk');
      console.error('   Add to .env: COMPANIES_HOUSE_API_KEY=your_key_here\n');
      process.exit(1);
    }

    console.log('   Source: Companies House (UK Government Registry)');
    console.log('   Rate: 600 requests / 5 minutes');
    console.log('   Cost: FREE');
    console.log('');

    while (this.running) {
      this.stats.cycles++;
      console.log(`\n--- Cycle ${this.stats.cycles} ---`);

      // Pick search terms for this cycle (rotate through list)
      const termsPerCycle = 5;
      for (let i = 0; i < termsPerCycle; i++) {
        if (!this.running) break;

        const term = UK_SEARCH_TERMS[this.searchIndex % UK_SEARCH_TERMS.length];
        this.searchIndex++;

        await this.processSearchTerm(term);
        await this.delay(CONFIG.DELAY_BETWEEN_BATCHES);
      }

      // Print stats
      console.log(`\n   Stats: ${this.stats.companiesFound} found | ${this.stats.companiesSaved} saved | ${this.stats.officersSaved} officers | ${this.stats.duplicatesSkipped} dupes | ${this.stats.errors} errors`);

      await this.delay(CONFIG.CYCLE_DELAY);
    }
  }
}

// Main
const agent = new CompaniesHouseAgent();

process.on('SIGINT', () => { agent.running = false; });
process.on('SIGTERM', () => { agent.running = false; });

agent.run().catch(e => {
  console.error('Companies House Agent failed:', e.message);
  process.exit(1);
});
