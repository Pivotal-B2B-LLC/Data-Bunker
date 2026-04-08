#!/usr/bin/env node

/**
 * AGENT: PHONE FINDER
 *
 * Finds phone numbers for companies and contacts from:
 * - Company websites (contact pages, about pages, footer)
 * - Companies House data
 * - Business directories
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');
const TURBO_CONFIG = require('./turbo-config');

const AGENT_NAME = 'PHONE-FINDER';
const CONFIG = TURBO_CONFIG.PHONE;

const http = axios.create({
  timeout: CONFIG.TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 3
});

let stats = {
  companies: 0,
  phonesFound: 0,
  addressesFound: 0,
  errors: 0,
  start: Date.now()
};

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${AGENT_NAME}] ${msg}`);
}

// Extract UK phone numbers from text
function extractPhones(text) {
  const phones = [];
  const patterns = [
    /(?:\+44|0044|0)[\s.-]?(?:\d[\s.-]?){9,10}/g,
    /\d{5}\s?\d{6}/g,
    /\d{4}\s?\d{3}\s?\d{4}/g,
    /\d{3}\s?\d{4}\s?\d{4}/g
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const cleaned = match.replace(/[\s.-]/g, '').replace(/^\+?44/, '0');
      if (cleaned.length >= 10 && cleaned.length <= 12 && /^0[1-9]/.test(cleaned)) {
        phones.push(cleaned);
      }
    }
  }

  return [...new Set(phones)];
}

// Extract UK postcodes/addresses
function extractAddress(html) {
  const postcodeMatch = html.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i);
  if (postcodeMatch) {
    const idx = html.indexOf(postcodeMatch[0]);
    const context = html.substring(Math.max(0, idx - 150), idx + 20);
    const cleanContext = context
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanContext.length > 15 && cleanContext.length < 200) {
      // Extract just the address part
      const addressMatch = cleanContext.match(/[\d\w\s,]+[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i);
      if (addressMatch) {
        return addressMatch[0].trim();
      }
    }
  }
  return null;
}

async function scrapeCompanyWebsite(website) {
  const result = { phones: [], address: null };

  const base = website.replace(/\/$/, '');
  const pages = [
    base,
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/about`,
    `${base}/about-us`
  ];

  for (const url of pages) {
    try {
      const response = await http.get(url);
      const html = response.data;

      // Extract phones
      const phones = extractPhones(html);
      result.phones.push(...phones);

      // Extract address
      if (!result.address) {
        result.address = extractAddress(html);
      }

      if (result.phones.length > 0 && result.address) break;
    } catch (e) {
      // Continue to next page
    }
  }

  result.phones = [...new Set(result.phones)];
  return result;
}

async function getCompaniesWithoutPhone() {
  const result = await pool.query(`
    SELECT account_id, company_name, website
    FROM accounts
    WHERE website IS NOT NULL
    AND website != ''
    AND (phone_number IS NULL OR phone_number = '')
    ORDER BY
      -- Prioritize half-enriched: companies closest to being fully complete
      (CASE WHEN email_format IS NOT NULL AND email_format != '' THEN 4 ELSE 0 END +
       CASE WHEN linkedin_url IS NOT NULL AND linkedin_url != '' THEN 3 ELSE 0 END +
       CASE WHEN address IS NOT NULL AND address != '' THEN 2 ELSE 0 END +
       CASE WHEN industry IS NOT NULL AND industry != '' THEN 1 ELSE 0 END) DESC,
      RANDOM()
    LIMIT $1
  `, [CONFIG.BATCH_SIZE]);
  return result.rows;
}

async function updateCompany(accountId, phone, address) {
  const updates = [];
  const values = [accountId];
  let idx = 2;

  if (phone) {
    updates.push(`phone_number = $${idx++}`);
    values.push(phone);
  }
  if (address) {
    updates.push(`address = $${idx++}`);
    values.push(address);
  }

  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    await pool.query(
      `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $1`,
      values
    );
  }
}

async function processCompany(company) {
  if (!company.website) return { phone: null, address: null };

  try {
    const result = await scrapeCompanyWebsite(company.website);

    const phone = result.phones[0] || null;
    const address = result.address;

    if (phone || address) {
      await updateCompany(company.account_id, phone, address);
    }

    return { phone, address };
  } catch (e) {
    stats.errors++;
    return { phone: null, address: null };
  }
}

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000 / 60);
  log('');
  log('='.repeat(50));
  log(`STATS after ${elapsed} minutes:`);
  log(`  Companies processed: ${stats.companies}`);
  log(`  Phones found: ${stats.phonesFound}`);
  log(`  Addresses found: ${stats.addressesFound}`);
  log(`  Errors: ${stats.errors}`);
  log('='.repeat(50));
  log('');
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log(`   AGENT: ${AGENT_NAME}`);
  console.log('='.repeat(60));
  console.log('   Finds phone numbers and addresses from company websites');
  console.log('   Scrapes: contact pages, about pages, footers');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    log(`Batch ${batch}: Loading companies without phone...`);

    try {
      const companies = await getCompaniesWithoutPhone();

      if (companies.length === 0) {
        log('All companies have phones. Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      log(`Processing ${companies.length} companies...`);

      for (let i = 0; i < companies.length; i += CONFIG.PARALLEL) {
        const chunk = companies.slice(i, i + CONFIG.PARALLEL);
        const results = await Promise.all(chunk.map(c => processCompany(c)));

        for (let j = 0; j < results.length; j++) {
          stats.companies++;
          const r = results[j];
          const c = chunk[j];

          if (r.phone || r.address) {
            const parts = [];
            if (r.phone) { parts.push(`phone: ${r.phone}`); stats.phonesFound++; }
            if (r.address) { parts.push('address'); stats.addressesFound++; }
            log(`  + ${c.company_name}: ${parts.join(', ')}`);
          }
        }
      }

      if (batch % 5 === 0) printStats();

      await new Promise(r => setTimeout(r, CONFIG.DELAY));
    } catch (e) {
      log(`Error: ${e.message}`);
      stats.errors++;
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n');
  printStats();
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
