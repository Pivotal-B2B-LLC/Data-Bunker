#!/usr/bin/env node
/**
 * Import NY Companies from Curated List
 * Imports real small-to-large businesses and enriches them
 */

const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { pool } = require('../src/db/connection');

const COMPANIES_FILE = '/tmp/ny_companies.txt';

class CuratedNYImporter {
  constructor() {
    this.companies = [];
    this.stats = {
      total: 0,
      saved: 0,
      enriched: 0,
      errors: 0
    };
  }

  async loadCompanies() {
    const content = fs.readFileSync(COMPANIES_FILE, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));

    for (const line of lines) {
      const [name, website, industry, location] = line.split('|');
      if (name && website) {
        this.companies.push({
          name: name.trim(),
          website: website.trim().startsWith('http') ? website.trim() : `https://${website.trim()}`,
          industry: industry?.trim() || 'Unknown',
          locality: location?.trim() || 'New York'
        });
      }
    }

    console.log(`Loaded ${this.companies.length} companies from list\n`);
  }

  async enrichFromWebsite(company) {
    try {
      console.log(`   Enriching: ${company.name}`);
      
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
      const emails = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g) || [];
      const goodEmails = emails.filter(e => 
        !e.includes('example.com') && 
        !e.includes('test.com') &&
        !e.includes('wix.com') &&
        !e.includes('sentry.io')
      );
      const email = goodEmails[0] || null;

      // Extract phone (US format)
      const phoneMatch = text.match(/(\+?1?[-.\s]?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
      let phone = phoneMatch ? phoneMatch[1] : null;
      if (phone) {
        phone = phone.replace(/[^\d+]/g, '');
        if (phone.length === 10) phone = '+1' + phone;
        if (phone.length === 11 && phone.startsWith('1')) phone = '+' + phone;
      }

      // Get description
      const metaDesc = $('meta[name="description"]').attr('content') || 
                       $('meta[property="og:description"]').attr('content') ||
                       company.description;

      if (email || phone) {
        console.log(`      ${email ? '✉️ ' + email : ''} ${phone ? '📞 ' + phone : ''}`);
      }

      return {
        ...company,
        email,
        phone,
        description: metaDesc
      };
    } catch (error) {
      console.log(`      ⚠️ ${error.message}`);
      return company;
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
          industry = EXCLUDED.industry,
          last_updated = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted`,
        [
          companyNumber,
          company.name,
          'us_ny',
          company.locality,
          'New York',
          'United States',
          company.website,
          company.phone,
          company.email,
          company.description,
          company.industry,
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
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   CURATED NEW YORK COMPANIES IMPORT');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Source: Curated list of real businesses`);
    console.log(`Size: Small, medium, and large companies`);
    console.log(`Industries: Multiple (restaurants, retail, tech, finance, etc.)`);
    console.log('═══════════════════════════════════════════════════════════\n');

    await this.loadCompanies();

    console.log('💾 Processing companies...\n');

    for (const company of this.companies) {
      try {
        this.stats.total++;

        // Enrich with website data
        const enriched = await this.enrichFromWebsite(company);

        // Save to database
        const inserted = await this.saveCompany(enriched);

        if (inserted) {
          this.stats.saved++;
        }

        if (enriched.email || enriched.phone) {
          this.stats.enriched++;
        }

        console.log(`   ✓ Saved: ${company.name}\n`);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (error) {
        console.error(`   ❌ ${company.name}: ${error.message}\n`);
        this.stats.errors++;
      }
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('           IMPORT COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total: ${this.stats.total}`);
    console.log(`Saved: ${this.stats.saved}`);
    console.log(`Enriched with contact info: ${this.stats.enriched}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log('═══════════════════════════════════════════════════════════');
  }
}

const importer = new CuratedNYImporter();
importer.run()
  .then(() => {
    console.log('\n✅ Import completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Import failed:', error.message);
    process.exit(1);
  });
