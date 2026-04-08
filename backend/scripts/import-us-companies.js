#!/usr/bin/env node
/**
 * US Companies Bulk Import Script
 * Imports US companies from OpenCorporates API for specific states
 * Similar to UK Companies House import but for US states
 */

const axios = require('axios');
const { pool } = require('../src/db/connection');

const OPENCORPORATES_API_KEY = process.env.OPENCORPORATES_API_KEY;
const OPENCORPORATES_BASE_URL = 'https://api.opencorporates.com/v0.4';

// US States configuration
const US_STATES = {
  ca: 'California',
  ny: 'New York',
  tx: 'Texas',
  fl: 'Florida',
  il: 'Illinois',
  pa: 'Pennsylvania',
  oh: 'Ohio',
  ga: 'Georgia',
  nc: 'North Carolina',
  mi: 'Michigan',
  nj: 'New Jersey',
  va: 'Virginia',
  wa: 'Washington',
  az: 'Arizona',
  ma: 'Massachusetts',
  tn: 'Tennessee',
  in: 'Indiana',
  mo: 'Missouri',
  md: 'Maryland',
  wi: 'Wisconsin',
  co: 'Colorado',
  mn: 'Minnesota',
  sc: 'South Carolina',
  al: 'Alabama',
  la: 'Louisiana',
  ky: 'Kentucky',
  or: 'Oregon',
  ok: 'Oklahoma',
  ct: 'Connecticut',
  ut: 'Utah',
  ia: 'Iowa',
  nv: 'Nevada',
  ar: 'Arkansas',
  ms: 'Mississippi',
  ks: 'Kansas',
  nm: 'New Mexico',
  ne: 'Nebraska',
  wv: 'West Virginia',
  id: 'Idaho',
  hi: 'Hawaii',
  nh: 'New Hampshire',
  me: 'Maine',
  mt: 'Montana',
  ri: 'Rhode Island',
  de: 'Delaware',
  sd: 'South Dakota',
  nd: 'North Dakota',
  ak: 'Alaska',
  vt: 'Vermont',
  wy: 'Wyoming'
};

class USCompanyImporter {
  constructor(states = [], options = {}) {
    this.states = states.length > 0 ? states : ['ca', 'ny', 'tx']; // Default to top 3 states
    this.batchSize = options.batchSize || 100;
    this.maxPages = options.maxPages || 10; // Limit pages per state to avoid rate limits
    this.companiesPerState = options.companiesPerState || 1000;
    this.delayBetweenRequests = options.delay || 1000; // 1 second delay
    this.stats = {
      total: 0,
      inserted: 0,
      updated: 0,
      errors: 0,
      byState: {}
    };
  }

  async init() {
    if (!OPENCORPORATES_API_KEY) {
      throw new Error('OPENCORPORATES_API_KEY not configured in .env file');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('           US COMPANIES BULK IMPORT');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`States: ${this.states.map(s => US_STATES[s] || s).join(', ')}`);
    console.log(`Target: ~${this.companiesPerState} companies per state`);
    console.log(`Batch size: ${this.batchSize}`);
    console.log(`API: OpenCorporates`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }

  async searchCompaniesByState(state, page = 1) {
    try {
      const response = await axios.get(`${OPENCORPORATES_BASE_URL}/companies/search`, {
        params: {
          jurisdiction_code: `us_${state}`,
          api_token: OPENCORPORATES_API_KEY,
          per_page: this.batchSize,
          page: page,
          order: 'score'
        },
        timeout: 15000
      });

      await this.sleep(this.delayBetweenRequests);
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        console.log(`⚠️  Rate limited, waiting 60s...`);
        await this.sleep(60000);
        return this.searchCompaniesByState(state, page);
      }
      throw error;
    }
  }

  async importState(state) {
    const stateName = US_STATES[state] || state;
    console.log(`\n🏛️  Importing ${stateName} (${state})...`);

    this.stats.byState[state] = { total: 0, inserted: 0, updated: 0, errors: 0 };
    let page = 1;
    let totalImported = 0;

    while (page <= this.maxPages && totalImported < this.companiesPerState) {
      try {
        console.log(`   Page ${page}/${this.maxPages}...`);

        const data = await this.searchCompaniesByState(state, page);

        if (!data.results?.companies || data.results.companies.length === 0) {
          console.log(`   ✓ No more companies found`);
          break;
        }

        const companies = data.results.companies.map(item => item.company);
        const imported = await this.saveCompanies(companies, state);

        totalImported += imported;
        this.stats.byState[state].total += companies.length;
        this.stats.byState[state].inserted += imported;

        console.log(`   ✓ Imported ${imported}/${companies.length} companies (Total: ${totalImported})`);

        page++;
      } catch (error) {
        console.error(`   ❌ Error on page ${page}:`, error.message);
        this.stats.byState[state].errors++;
        break;
      }
    }

    console.log(`✅ ${stateName} complete: ${totalImported} companies imported`);
    return totalImported;
  }

  async saveCompanies(companies, state) {
    const client = await pool.connect();
    let inserted = 0;

    try {
      await client.query('BEGIN');

      for (const company of companies) {
        try {
          const address = this.parseAddress(company.registered_address_in_full);

          const result = await client.query(
            `INSERT INTO companies (
              company_number, name, jurisdiction, company_type, status,
              incorporation_date, address_line_1, locality, region, postal_code, country,
              data_source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (company_number) DO UPDATE SET
              name = EXCLUDED.name,
              status = EXCLUDED.status,
              last_updated = CURRENT_TIMESTAMP
            RETURNING (xmax = 0) AS inserted`,
            [
              company.company_number,
              company.name,
              company.jurisdiction_code,
              company.company_type,
              company.current_status,
              company.incorporation_date,
              address.line1,
              address.locality,
              address.region,
              address.postalCode,
              'United States',
              'opencorporates'
            ]
          );

          if (result.rows[0].inserted) {
            inserted++;
            this.stats.inserted++;
          } else {
            this.stats.updated++;
          }
          this.stats.total++;
        } catch (error) {
          console.error(`     ⚠️  Failed to save ${company.name}:`, error.message);
          this.stats.errors++;
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return inserted;
  }

  parseAddress(fullAddress) {
    if (!fullAddress) {
      return { line1: null, locality: null, region: null, postalCode: null };
    }

    // Basic address parsing for US addresses
    const parts = fullAddress.split(',').map(p => p.trim());
    
    return {
      line1: parts[0] || null,
      locality: parts[parts.length - 3] || null,
      region: parts[parts.length - 2] || null,
      postalCode: parts[parts.length - 1] || null
    };
  }

  async run() {
    await this.init();

    const startTime = Date.now();

    for (const state of this.states) {
      await this.importState(state);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('           IMPORT COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Duration: ${duration}s`);
    console.log(`Total processed: ${this.stats.total}`);
    console.log(`Inserted: ${this.stats.inserted}`);
    console.log(`Updated: ${this.stats.updated}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log('\nBy State:');
    for (const [state, stats] of Object.entries(this.stats.byState)) {
      console.log(`  ${US_STATES[state]}: ${stats.inserted} inserted, ${stats.updated} updated`);
    }
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
US Companies Bulk Import

Usage:
  node import-us-companies.js [options]

Options:
  --states <codes>        Comma-separated state codes (e.g., ca,ny,tx)
  --all                   Import from all 50 states
  --top10                 Import from top 10 most populous states
  --limit <number>        Companies per state (default: 1000)
  --batch <number>        Batch size (default: 100)
  --help, -h              Show this help

Examples:
  node import-us-companies.js --states ca,ny,tx
  node import-us-companies.js --top10
  node import-us-companies.js --states ca --limit 5000
  node import-us-companies.js --all --limit 500

State Codes:
  ca=California, ny=New York, tx=Texas, fl=Florida, il=Illinois,
  pa=Pennsylvania, oh=Ohio, ga=Georgia, nc=North Carolina, mi=Michigan
  ... and 40 more states
`);
    process.exit(0);
  }

  let states = ['ca', 'ny', 'tx']; // Default
  let companiesPerState = 1000;
  let batchSize = 100;

  if (args.includes('--all')) {
    states = Object.keys(US_STATES);
  } else if (args.includes('--top10')) {
    states = ['ca', 'tx', 'fl', 'ny', 'pa', 'il', 'oh', 'ga', 'nc', 'mi'];
  } else if (args.includes('--states')) {
    const idx = args.indexOf('--states');
    states = args[idx + 1].split(',').map(s => s.trim().toLowerCase());
  }

  if (args.includes('--limit')) {
    const idx = args.indexOf('--limit');
    companiesPerState = parseInt(args[idx + 1]);
  }

  if (args.includes('--batch')) {
    const idx = args.indexOf('--batch');
    batchSize = parseInt(args[idx + 1]);
  }

  const importer = new USCompanyImporter(states, { companiesPerState, batchSize });
  
  importer.run()
    .then(() => {
      console.log('\n✅ Import completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Import failed:', error.message);
      process.exit(1);
    });
}

module.exports = USCompanyImporter;
