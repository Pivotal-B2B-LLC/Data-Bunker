#!/usr/bin/env node

/**
 * PHONE & ADDRESS ENRICHMENT
 *
 * Scrapes company websites for:
 * - Phone numbers (UK/US formats)
 * - Physical addresses
 *
 * Runs alongside email format detection
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const PARALLEL = 10;
const BATCH_SIZE = 50;
const TIMEOUT = 6000;

let stats = { processed: 0, phones: 0, addresses: 0, errors: 0, start: Date.now() };

const http = axios.create({
  timeout: TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 2
});

/**
 * Extract phone numbers from text
 */
function extractPhones(text) {
  const phones = [];

  // UK formats
  const ukPatterns = [
    /(?:\+44|0044|44)[\s.-]?\(?0?\)?[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
    /0\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
    /\(?0\d{2,4}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g
  ];

  // US formats
  const usPatterns = [
    /\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g
  ];

  const allPatterns = [...ukPatterns, ...usPatterns];

  for (const pattern of allPatterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const cleaned = match.replace(/[\s.-]/g, '').replace(/^\+?44/, '0').replace(/^\+?1/, '');
      if (cleaned.length >= 10 && cleaned.length <= 15 && !phones.includes(cleaned)) {
        // Validate it looks like a real phone
        if (/^0[1-9]\d{8,10}$/.test(cleaned) || /^\d{10}$/.test(cleaned)) {
          phones.push(cleaned);
        }
      }
    }
  }

  return phones[0] || null;
}

/**
 * Extract address from HTML
 */
function extractAddress(html, $) {
  // Look for structured address data
  const addressSelectors = [
    '[itemprop="address"]',
    '[itemtype*="PostalAddress"]',
    '.address',
    '#address',
    '[class*="address"]',
    'address'
  ];

  for (const selector of addressSelectors) {
    const el = $(selector).first();
    if (el.length) {
      const text = el.text().trim().replace(/\s+/g, ' ');
      if (text.length > 10 && text.length < 200) {
        return text;
      }
    }
  }

  // Look for UK postcodes in text
  const postcodeRegex = /([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})/gi;
  const text = $('body').text();
  const postcodeMatch = text.match(postcodeRegex);

  if (postcodeMatch) {
    // Try to extract surrounding address context
    const postcode = postcodeMatch[0];
    const idx = text.indexOf(postcode);
    if (idx > 0) {
      // Get ~100 chars before postcode
      let start = Math.max(0, idx - 100);
      let addressText = text.substring(start, idx + postcode.length + 10).trim();

      // Clean up
      addressText = addressText
        .replace(/\s+/g, ' ')
        .replace(/^[^A-Za-z0-9]+/, '')
        .trim();

      if (addressText.length > 15 && addressText.length < 150) {
        return addressText;
      }
    }

    return postcode; // At least return the postcode
  }

  return null;
}

/**
 * Scrape contact info from website
 */
async function scrapeContactInfo(website) {
  const result = { phone: null, address: null };

  if (!website) return result;

  const base = website.replace(/\/$/, '');
  const pages = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`];

  const responses = await Promise.allSettled(
    pages.map(url => http.get(url).catch(() => null))
  );

  for (const res of responses) {
    if (res.status !== 'fulfilled' || !res.value?.data) continue;

    const html = res.value.data;
    const $ = cheerio.load(html);
    const text = $('body').text();

    // Extract phone
    if (!result.phone) {
      // Check tel: links first
      const telLink = $('a[href^="tel:"]').first().attr('href');
      if (telLink) {
        const phone = telLink.replace('tel:', '').replace(/[\s.-]/g, '');
        if (phone.length >= 10) {
          result.phone = phone.replace(/^\+44/, '0');
        }
      }

      // Fallback to regex
      if (!result.phone) {
        result.phone = extractPhones(text);
      }
    }

    // Extract address
    if (!result.address) {
      result.address = extractAddress(html, $);
    }

    if (result.phone && result.address) break;
  }

  return result;
}

/**
 * Process single company
 */
async function processCompany(company) {
  try {
    const info = await scrapeContactInfo(company.website);

    const updates = [];
    const values = [];
    let idx = 1;

    if (info.phone && !company.phone_number) {
      updates.push(`phone_number = $${idx++}`);
      values.push(info.phone);
      stats.phones++;
    }

    if (info.address && !company.address) {
      updates.push(`address = $${idx++}`);
      values.push(info.address);
      stats.addresses++;
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      values.push(company.account_id);
      await pool.query(
        `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $${idx}`,
        values
      );
      return { name: company.company_name, phone: info.phone, address: info.address };
    }

    stats.processed++;
    return null;

  } catch (e) {
    stats.errors++;
    stats.processed++;
    return null;
  }
}

/**
 * Get companies with websites missing phone/address
 */
async function getCompanies(limit) {
  const result = await pool.query(`
    SELECT account_id, company_name, website, phone_number, address
    FROM accounts
    WHERE website IS NOT NULL AND website != ''
      AND (phone_number IS NULL OR phone_number = '' OR address IS NULL OR address = '')
    ORDER BY RANDOM()
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Main loop
 */
async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   PHONE & ADDRESS ENRICHMENT');
  console.log('='.repeat(60));
  console.log('   Extracting: Phone numbers, Addresses');
  console.log('   Focus: Companies with websites');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    console.log(`[Batch ${batch}] Loading...`);

    try {
      const companies = await getCompanies(BATCH_SIZE);

      if (companies.length === 0) {
        console.log('  All done! Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      console.log(`  Processing ${companies.length} companies...\n`);

      for (let i = 0; i < companies.length; i += PARALLEL) {
        const chunk = companies.slice(i, i + PARALLEL);
        const results = await Promise.all(chunk.map(c => processCompany(c)));

        results.filter(r => r).forEach(r => {
          if (r.phone) console.log(`    + ${r.name}: Phone ${r.phone}`);
          if (r.address) console.log(`    + ${r.name}: Address found`);
        });
      }

      const elapsed = Math.floor((Date.now() - stats.start) / 1000);
      const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;

      console.log(`\n[Stats] Processed: ${stats.processed} | Phones: ${stats.phones} | Addresses: ${stats.addresses} | Rate: ${rate}/min`);

      await new Promise(r => setTimeout(r, 2000));

    } catch (e) {
      console.error(`[Error] ${e.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\nStopped.');
  console.log(`Phones: ${stats.phones} | Addresses: ${stats.addresses}`);
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
