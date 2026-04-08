#!/usr/bin/env node

/**
 * CONTINUOUS ENRICHMENT SCRIPT
 * Runs forever, enriching all companies with:
 * - Website discovery
 * - Email patterns
 * - Phone numbers
 * - Contact information
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const BATCH_SIZE = 50;           // Companies per batch
const DELAY_BETWEEN_BATCHES = 5000;  // 5 seconds between batches
const DELAY_BETWEEN_COMPANIES = 1000; // 1 second between companies

let stats = {
  processed: 0,
  enriched: 0,
  contacts_found: 0,
  errors: 0,
  startTime: Date.now()
};

/**
 * Get companies that need enrichment
 */
async function getCompaniesToEnrich(limit = BATCH_SIZE) {
  const result = await pool.query(`
    SELECT account_id, company_name, city, state_region, country, website
    FROM accounts
    WHERE (website IS NULL OR website = '' OR email_format IS NULL OR email_format = '')
      AND company_name IS NOT NULL
      AND company_name != ''
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows;
}

/**
 * Search for company website using DuckDuckGo
 */
async function findWebsite(companyName, city, country) {
  const cleanName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.|company)\.?\s*$/i, '')
    .trim();

  const locationContext = city ? `${city} ${country || ''}` : (country || '');
  const query = `"${cleanName}" ${locationContext} official website`;

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await axios.get(searchUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);

    // Skip social media and directories
    const skipDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com',
                        'wikipedia.org', 'yelp.com', 'tripadvisor.com', 'glassdoor.com',
                        'indeed.com', 'crunchbase.com', 'bloomberg.com', 'gov.uk',
                        'companies-house.gov.uk', 'yell.com', 'thomsonlocal.com',
                        'duckduckgo.com', 'bing.com', 'google.com', 'yahoo.com',
                        'brave.com', 'search.brave.com', 'ecosia.org', 'mojeek.com',
                        'aol.com', 'search.aol.com', 'instagram.com', 'tiktok.com',
                        'pinterest.com', 'reddit.com', 'trustpilot.com'];

    let website = null;

    $('.result__url').each((i, el) => {
      if (i > 10 || website) return false;
      const url = $(el).text().trim();

      if (url && !skipDomains.some(domain => url.includes(domain)) && url.includes('.')) {
        website = url.startsWith('http') ? url : `https://${url}`;
        return false;
      }
    });

    return website;
  } catch (error) {
    return null;
  }
}

/**
 * Scrape website for contact information
 */
async function scrapeContactInfo(websiteUrl) {
  const result = { email: null, phone: null };

  if (!websiteUrl) return result;

  const pagesToTry = [websiteUrl];
  const baseUrl = websiteUrl.replace(/\/$/, '');

  if (!websiteUrl.includes('/contact')) {
    pagesToTry.push(`${baseUrl}/contact`);
    pagesToTry.push(`${baseUrl}/contact-us`);
    pagesToTry.push(`${baseUrl}/about`);
  }

  for (const pageUrl of pagesToTry) {
    try {
      const response = await axios.get(pageUrl, {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        maxRedirects: 3
      });

      const $ = cheerio.load(response.data);
      const text = $('body').text();
      const html = response.data;

      // Find email
      if (!result.email) {
        const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
        if (mailtoMatch) {
          result.email = mailtoMatch[1].toLowerCase();
        } else {
          const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (emailMatch && !emailMatch[0].includes('example') && !emailMatch[0].includes('test')) {
            result.email = emailMatch[0].toLowerCase();
          }
        }
      }

      // Find phone
      if (!result.phone) {
        const telMatch = html.match(/tel:([+\d\s()-]{10,})/i);
        if (telMatch) {
          result.phone = telMatch[1].replace(/[^\d+]/g, '');
        } else {
          const phonePatterns = [
            /\+?44[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/,  // UK
            /0\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/,                    // UK local
            /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/          // US
          ];

          for (const pattern of phonePatterns) {
            const match = text.match(pattern);
            if (match) {
              const phone = match[0].replace(/[^\d+]/g, '');
              if (phone.length >= 10) {
                result.phone = phone;
                break;
              }
            }
          }
        }
      }

      if (result.email && result.phone) break;

    } catch (e) {
      continue;
    }
  }

  return result;
}

/**
 * Update company with enriched data
 */
async function updateCompany(accountId, data) {
  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (data.website) {
    updates.push(`website = $${paramIndex++}`);
    values.push(data.website);
  }

  if (data.email) {
    updates.push(`email_format = $${paramIndex++}`);
    values.push(data.email);
  }

  if (data.phone) {
    updates.push(`phone_number = $${paramIndex++}`);
    values.push(data.phone);
  }

  if (updates.length === 0) return false;

  updates.push(`updated_at = NOW()`);
  values.push(accountId);

  await pool.query(
    `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $${paramIndex}`,
    values
  );

  return true;
}

/**
 * Create contact record if we found contact info
 */
async function createContact(accountId, companyName, data) {
  if (!data.email && !data.phone) return false;

  try {
    await pool.query(`
      INSERT INTO contacts (
        linked_account_id,
        first_name,
        last_name,
        email,
        phone_number,
        job_title,
        data_source,
        verified,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT DO NOTHING
    `, [
      accountId,
      'General',
      'Contact',
      data.email,
      data.phone,
      'Company Contact',
      'Website Scrape',
      false
    ]);

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Process a single company
 */
async function processCompany(company) {
  console.log(`  Processing: ${company.company_name}`);

  let enrichedData = {
    website: company.website,
    email: null,
    phone: null
  };

  // Find website if missing
  if (!enrichedData.website) {
    enrichedData.website = await findWebsite(company.company_name, company.city, company.country);
    if (enrichedData.website) {
      console.log(`    ✓ Found website: ${enrichedData.website}`);
    }
  }

  // Scrape contact info from website
  if (enrichedData.website) {
    const contactInfo = await scrapeContactInfo(enrichedData.website);
    enrichedData.email = contactInfo.email;
    enrichedData.phone = contactInfo.phone;

    if (contactInfo.email) console.log(`    ✓ Found email: ${contactInfo.email}`);
    if (contactInfo.phone) console.log(`    ✓ Found phone: ${contactInfo.phone}`);
  }

  // Update company record
  const updated = await updateCompany(company.account_id, enrichedData);

  // Create contact if we found info
  if (enrichedData.email || enrichedData.phone) {
    const contactCreated = await createContact(company.account_id, company.company_name, enrichedData);
    if (contactCreated) stats.contacts_found++;
  }

  if (updated) stats.enriched++;
  stats.processed++;

  return updated;
}

/**
 * Main enrichment loop
 */
async function runEnrichment() {
  console.log('\n' + '='.repeat(60));
  console.log('   CONTINUOUS ENRICHMENT SYSTEM');
  console.log('='.repeat(60));
  console.log(`   Batch Size: ${BATCH_SIZE}`);
  console.log(`   Delay between batches: ${DELAY_BETWEEN_BATCHES}ms`);
  console.log(`   Press Ctrl+C to stop\n`);

  let batchNumber = 0;

  while (true) {
    batchNumber++;
    console.log(`\n[Batch ${batchNumber}] Fetching companies to enrich...`);

    try {
      const companies = await getCompaniesToEnrich();

      if (companies.length === 0) {
        console.log('  No more companies to enrich! Waiting 60 seconds...');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      console.log(`  Found ${companies.length} companies to process\n`);

      for (const company of companies) {
        try {
          await processCompany(company);
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_COMPANIES));
        } catch (error) {
          console.log(`    ✗ Error: ${error.message}`);
          stats.errors++;
        }
      }

      // Print stats
      const duration = Math.floor((Date.now() - stats.startTime) / 1000);
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;

      console.log(`\n[Stats] Processed: ${stats.processed} | Enriched: ${stats.enriched} | Contacts: ${stats.contacts_found} | Errors: ${stats.errors} | Time: ${minutes}m ${seconds}s`);

      // Wait before next batch
      console.log(`\nWaiting ${DELAY_BETWEEN_BATCHES/1000}s before next batch...`);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));

    } catch (error) {
      console.error(`[Batch Error] ${error.message}`);
      console.log('Waiting 30 seconds before retry...');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n' + '='.repeat(60));
  console.log('   ENRICHMENT STOPPED');
  console.log('='.repeat(60));
  console.log(`   Total Processed: ${stats.processed}`);
  console.log(`   Total Enriched: ${stats.enriched}`);
  console.log(`   Contacts Found: ${stats.contacts_found}`);
  console.log(`   Errors: ${stats.errors}`);
  process.exit(0);
});

// Start enrichment
runEnrichment().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
