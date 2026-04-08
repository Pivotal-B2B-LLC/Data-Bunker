#!/usr/bin/env node
/**
 * Practical US Company Discovery - Uses Real Business Lists
 * Combines multiple free sources to discover companies
 */

const axios = require('axios');
const { pool } = require('../src/db/connection');
const webScraperService = require('../src/services/webScraperService');

// Sample companies database for New York (expandable)
const NY_TECH_COMPANIES = [
  { name: 'Google New York', website: 'google.com', city: 'New York City' },
  { name: 'Facebook New York', website: 'facebook.com', city: 'New York City' },
  { name: 'Amazon NYC', website: 'amazon.com', city: 'New York City' },
  { name: 'Bloomberg LP', website: 'bloomberg.com', city: 'New York City' },
  { name: 'IBM', website: 'ibm.com', city: 'Armonk' },
  { name: 'Spotify', website: 'spotify.com', city: 'New York City' },
  { name: 'Twitter NYC', website: 'twitter.com', city: 'New York City' },
  { name: 'Squarespace', website: 'squarespace.com', city: 'New York City' },
  { name: 'Etsy', website: 'etsy.com', city: 'Brooklyn' },
  { name: 'Kickstarter', website: 'kickstarter.com', city: 'Brooklyn' },
  { name: 'Warby Parker', website: 'warbyparker.com', city: 'New York City' },
  { name: 'WeWork', website: 'wework.com', city: 'New York City' },
  { name: 'BuzzFeed', website: 'buzzfeed.com', city: 'New York City' },
  { name: 'Grubhub', website: 'grubhub.com', city: 'New York City' },
  { name: 'Peloton', website: 'onepeloton.com', city: 'New York City' },
  { name: 'Oscar Health', website: 'hioscar.com', city: 'New York City' },
  { name: 'MongoDB', website: 'mongodb.com', city: 'New York City' },
  { name: 'Datadog', website: 'datadoghq.com', city: 'New York City' },
  { name: 'Cockroach Labs', website: 'cockroachlabs.com', city: 'New York City' },
  { name: 'AppNexus', website: 'appnexus.com', city: 'New York City' },
  { name: 'Gilt Groupe', website: 'gilt.com', city: 'New York City' },
  { name: 'Birchbox', website: 'birchbox.com', city: 'New York City' },
  { name: 'Foursquare', website: 'foursquare.com', city: 'New York City' },
  { name: 'Tumblr', website: 'tumblr.com', city: 'New York City' },
  { name: 'Venmo', website: 'venmo.com', city: 'New York City' },
  { name: 'Blue Apron', website: 'blueapron.com', city: 'New York City' },
  { name: 'ClassPass', website: 'classpass.com', city: 'New York City' },
  { name: 'Rent the Runway', website: 'renttherunway.com', city: 'New York City' },
  { name: 'Casper', website: 'casper.com', city: 'New York City' },
  { name: 'Harry\'s', website: 'harrys.com', city: 'New York City' },
  { name: 'Glossier', website: 'glossier.com', city: 'New York City' },
  { name: 'Away', website: 'awaytravel.com', city: 'New York City' },
  { name: 'Allbirds', website: 'allbirds.com', city: 'New York City' },
  { name: 'Compass', website: 'compass.com', city: 'New York City' },
  { name: 'Ro', website: 'ro.co', city: 'New York City' },
  { name: 'Flatiron Health', website: 'flatiron.com', city: 'New York City' },
  { name: 'Zocdoc', website: 'zocdoc.com', city: 'New York City' },
  { name: 'Medidata', website: 'medidata.com', city: 'New York City' },
  { name: 'Namely', website: 'namely.com', city: 'New York City' },
  { name: 'Greenhouse', website: 'greenhouse.io', city: 'New York City' },
  { name: 'Managed by Q', website: 'managedbyq.com', city: 'New York City' },
  { name: 'Sprinklr', website: 'sprinklr.com', city: 'New York City' },
  { name: 'Intersection', website: 'intersection.com', city: 'New York City' },
  { name: 'Digital Ocean', website: 'digitalocean.com', city: 'New York City' },
  { name: 'Amplify', website: 'amplify.com', city: 'Brooklyn' },
  { name: 'Intersection', website: 'intersection.com', city: 'New York City' },
  { name: 'Magnetic', website: 'magnetic.com', city: 'New York City' },
  { name: 'MediaMath', website: 'mediamath.com', city: 'New York City' },
  { name: 'Vimeo', website: 'vimeo.com', city: 'New York City' },
  { name: 'Shutterstock', website: 'shutterstock.com', city: 'New York City' }
];

class PracticalCompanyImport {
  constructor(options = {}) {
    this.state = options.state || 'New York';
    this.limit = options.limit || 50;
    this.companies = NY_TECH_COMPANIES.slice(0, this.limit);
    
    this.stats = {
      total: 0,
      saved: 0,
      enriched: 0,
      errors: 0
    };
  }

  async init() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('     PRACTICAL US COMPANY IMPORT (Real Data)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`State: ${this.state}`);
    console.log(`Companies: ${this.companies.length} known businesses`);
    console.log(`Method: Curated list + Web enrichment`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }

  async enrichCompany(company) {
    try {
      const website = company.website.startsWith('http') 
        ? company.website 
        : `https://${company.website}`;

      console.log(`   Enriching: ${company.name}`);

      // Scrape website for additional data
      const scrapedData = await webScraperService.scrapeWebsite(website);

      if (scrapedData) {
        return {
          ...company,
          website: website,
          email: scrapedData.email,
          phone: scrapedData.phone,
          description: scrapedData.description
        };
      }

      return { ...company, website };
    } catch (error) {
      console.error(`   ⚠️  ${error.message}`);
      return { ...company, website: company.website.startsWith('http') ? company.website : `https://${company.website}` };
    }
  }

  async saveCompany(company) {
    const client = await pool.connect();

    try {
      const domain = company.website.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
      const companyNumber = `us_ny_${domain.replace(/[^a-z0-9]/g, '_')}`;

      const result = await client.query(
        `INSERT INTO companies (
          company_number, name, jurisdiction, 
          locality, region, country,
          website, phone, email, description,
          industry, data_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
          company.city || 'New York City',
          'New York',
          'United States',
          company.website,
          company.phone,
          company.email,
          company.description,
          'technology',
          'curated_list'
        ]
      );

      client.release();
      return result.rows[0].inserted;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async run() {
    await this.init();

    const startTime = Date.now();

    console.log('💾 Processing companies...\n');

    for (const company of this.companies) {
      try {
        this.stats.total++;

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

        const indicators = [
          enriched.email ? '✉️' : '',
          enriched.phone ? '📞' : ''
        ].filter(Boolean).join(' ');

        console.log(`   ✓ ${company.name} ${indicators}`);

        await this.sleep(1500); // Rate limiting
      } catch (error) {
        console.error(`   ❌ ${company.name}: ${error.message}`);
        this.stats.errors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('           IMPORT COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Duration: ${duration}s`);
    console.log(`Processed: ${this.stats.total}`);
    console.log(`Saved: ${this.stats.saved}`);
    console.log(`Enriched (email/phone): ${this.stats.enriched}`);
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
Practical US Company Import

Imports a curated list of real companies from New York and enriches them
with website, email, and phone data.

Usage:
  node import-ny-companies-practical.js [options]

Options:
  --limit <number>    Number of companies to import (default: 50, max: 50)
  --help, -h          Show this help

Example:
  node import-ny-companies-practical.js --limit 30

What it does:
  1. Loads list of known New York tech companies
  2. Visits each company website
  3. Extracts email, phone, description
  4. Saves to database
  5. Your workers continue enriching automatically
`);
    process.exit(0);
  }

  let limit = 50;
  if (args.includes('--limit')) {
    limit = Math.min(50, parseInt(args[args.indexOf('--limit') + 1]));
  }

  const importer = new PracticalCompanyImport({ limit });

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

module.exports = PracticalCompanyImport;
