#!/usr/bin/env node

/**
 * FAST EMAIL FORMAT DETECTION
 *
 * Parallel processing for speed + same accuracy
 * Detects patterns like: {first}.{last}@company.com
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// Speed Configuration
const PARALLEL_COMPANIES = 10;      // Process 10 companies at once
const BATCH_SIZE = 50;              // Larger batches
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches
const REQUEST_TIMEOUT = 5000;       // 5 second timeout (faster fail)

// Generic email prefixes to SKIP
const GENERIC_PREFIXES = new Set([
  'info', 'contact', 'hello', 'hi', 'enquiries', 'enquiry', 'admin',
  'sales', 'support', 'help', 'office', 'reception', 'mail', 'email',
  'customercare', 'customerservice', 'customer', 'service', 'services',
  'bookings', 'booking', 'reservations', 'orders', 'order', 'accounts',
  'billing', 'invoices', 'payments', 'hr', 'jobs', 'careers', 'recruitment',
  'marketing', 'press', 'media', 'pr', 'news', 'team', 'general', 'main',
  'feedback', 'complaints', 'webmaster', 'postmaster', 'noreply', 'no-reply',
  'donotreply', 'auto', 'automated', 'system', 'notify', 'notifications'
]);

// Common first names for pattern detection
const COMMON_NAMES = new Set([
  'james', 'john', 'robert', 'michael', 'david', 'william', 'richard', 'joseph',
  'thomas', 'christopher', 'charles', 'daniel', 'matthew', 'anthony', 'mark',
  'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian', 'george',
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan',
  'jessica', 'sarah', 'karen', 'lisa', 'nancy', 'margaret', 'ashley', 'emily',
  'oliver', 'jack', 'harry', 'charlie', 'oscar', 'leo', 'alfie', 'henry',
  'amelia', 'isla', 'ava', 'mia', 'ivy', 'lily', 'isabella', 'rosie', 'sophia',
  'peter', 'simon', 'ian', 'neil', 'graham', 'stuart', 'alan', 'martin', 'colin'
]);

let stats = {
  processed: 0,
  formatsFound: 0,
  websitesFound: 0,
  errors: 0,
  startTime: Date.now()
};

// Axios instance with fast timeout
const http = axios.create({
  timeout: REQUEST_TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 2
});

/**
 * Check if email is generic
 */
function isGenericEmail(email) {
  if (!email) return true;
  const local = email.split('@')[0].toLowerCase();

  // Skip if starts with numbers or is in generic list
  if (/^\d/.test(local)) return true;
  for (const prefix of GENERIC_PREFIXES) {
    if (local === prefix || local.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Detect email format pattern
 */
function detectFormat(email, domain) {
  if (!email || isGenericEmail(email)) return null;

  const local = email.split('@')[0].toLowerCase();

  // Pattern: first.last
  if (/^[a-z]+\.[a-z]+$/.test(local)) {
    const [first] = local.split('.');
    if (COMMON_NAMES.has(first) || first.length >= 3) {
      return `{first}.{last}@${domain}`;
    }
  }

  // Pattern: first_last
  if (/^[a-z]+_[a-z]+$/.test(local)) {
    return `{first}_{last}@${domain}`;
  }

  // Pattern: f.last (initial.lastname)
  if (/^[a-z]\.[a-z]+$/.test(local)) {
    return `{f}.{last}@${domain}`;
  }

  // Pattern: flast (initial + lastname)
  if (/^[a-z][a-z]{4,}$/.test(local) && !COMMON_NAMES.has(local)) {
    return `{f}{last}@${domain}`;
  }

  // Pattern: firstl (firstname + initial)
  if (/^[a-z]+[a-z]$/.test(local) && COMMON_NAMES.has(local.slice(0, -1))) {
    return `{first}{l}@${domain}`;
  }

  return null;
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  if (!url) return null;
  try {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/]+)/);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Fast website search using DuckDuckGo
 */
async function findWebsite(companyName, city) {
  const cleanName = companyName.replace(/\s*(ltd|limited|llc|inc|plc|corp)\.?\s*$/i, '').trim();
  const query = `"${cleanName}" ${city || ''} official website`;

  try {
    const response = await http.get(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    );

    const $ = cheerio.load(response.data);
    const skipDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com',
                        'wikipedia.org', 'yelp.com', 'tripadvisor.com', 'yell.com'];

    let website = null;
    $('.result__url').each((i, el) => {
      if (i > 5 || website) return false;
      const url = $(el).text().trim();
      if (url && !skipDomains.some(d => url.includes(d)) && url.includes('.')) {
        website = url.startsWith('http') ? url : `https://${url}`;
        return false;
      }
    });

    return website;
  } catch {
    return null;
  }
}

/**
 * Fast email scraping from website
 */
async function scrapeEmails(websiteUrl) {
  if (!websiteUrl) return [];

  const domain = extractDomain(websiteUrl);
  if (!domain) return [];

  const emails = [];
  const baseUrl = websiteUrl.replace(/\/$/, '');

  // Try main pages in parallel
  const pages = [baseUrl, `${baseUrl}/about`, `${baseUrl}/team`, `${baseUrl}/contact`];

  const results = await Promise.allSettled(
    pages.map(url => http.get(url).catch(() => null))
  );

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value) continue;

    const html = result.value.data;
    const emailRegex = new RegExp(`[a-zA-Z0-9._%+-]+@${domain.replace('.', '\\.')}`, 'gi');
    const found = html.match(emailRegex) || [];

    for (const email of found) {
      const lower = email.toLowerCase();
      if (!isGenericEmail(lower) && !emails.includes(lower)) {
        emails.push(lower);
        if (emails.length >= 3) break;
      }
    }

    if (emails.length >= 3) break;
  }

  return emails.map(e => ({ email: e, domain }));
}

/**
 * Determine best format from emails
 */
function getBestFormat(emails) {
  if (!emails.length) return null;

  const formats = {};
  for (const { email, domain } of emails) {
    const format = detectFormat(email, domain);
    if (format) {
      formats[format] = (formats[format] || 0) + 1;
    }
  }

  // Return most common format
  let best = null, max = 0;
  for (const [fmt, count] of Object.entries(formats)) {
    if (count > max) { max = count; best = fmt; }
  }

  // Fallback: infer from email structure
  if (!best && emails.length > 0) {
    const { email, domain } = emails[0];
    const local = email.split('@')[0];
    if (local.includes('.')) best = `{first}.{last}@${domain}`;
    else if (local.includes('_')) best = `{first}_{last}@${domain}`;
  }

  return best;
}

/**
 * Process a single company
 */
async function processCompany(company) {
  try {
    let website = company.website;
    let emailFormat = null;

    // Find website if missing
    if (!website) {
      website = await findWebsite(company.company_name, company.city);
      if (website) stats.websitesFound++;
    }

    // Scrape for employee emails
    if (website) {
      const emails = await scrapeEmails(website);
      if (emails.length > 0) {
        emailFormat = getBestFormat(emails);
        if (emailFormat) stats.formatsFound++;
      }
    }

    // Update database if we found something
    if (website !== company.website || emailFormat) {
      const updates = [];
      const values = [];
      let idx = 1;

      if (website && website !== company.website) {
        updates.push(`website = $${idx++}`);
        values.push(website);
      }
      if (emailFormat) {
        updates.push(`email_format = $${idx++}`);
        values.push(emailFormat);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        values.push(company.account_id);
        await pool.query(
          `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $${idx}`,
          values
        );
      }
    }

    stats.processed++;
    return { name: company.company_name, format: emailFormat };

  } catch (e) {
    stats.errors++;
    stats.processed++;
    return { name: company.company_name, error: e.message };
  }
}

/**
 * Process companies in parallel batches
 */
async function processBatch(companies) {
  const results = [];

  // Process in parallel chunks
  for (let i = 0; i < companies.length; i += PARALLEL_COMPANIES) {
    const chunk = companies.slice(i, i + PARALLEL_COMPANIES);
    const chunkResults = await Promise.all(chunk.map(c => processCompany(c)));
    results.push(...chunkResults);

    // Log progress
    const found = chunkResults.filter(r => r.format);
    if (found.length > 0) {
      found.forEach(r => console.log(`    + ${r.name}: ${r.format}`));
    }
  }

  return results;
}

/**
 * Get companies needing enrichment
 */
async function getCompanies(limit) {
  const result = await pool.query(`
    SELECT account_id, company_name, city, country, website
    FROM accounts
    WHERE (email_format IS NULL OR email_format = '' OR email_format NOT LIKE '{%')
      AND company_name IS NOT NULL AND company_name != ''
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Main loop
 */
async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   FAST EMAIL FORMAT DETECTION');
  console.log('='.repeat(60));
  console.log(`   Parallel: ${PARALLEL_COMPANIES} companies at once`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Detecting: {first}.{last}@domain.com patterns`);
  console.log(`   Press Ctrl+C to stop\n`);

  let batch = 0;

  while (true) {
    batch++;
    console.log(`\n[Batch ${batch}] Loading companies...`);

    try {
      const companies = await getCompanies(BATCH_SIZE);

      if (companies.length === 0) {
        console.log('  No more companies! Waiting 60s...');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      console.log(`  Processing ${companies.length} companies (${PARALLEL_COMPANIES} parallel)...\n`);

      await processBatch(companies);

      // Stats
      const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
      const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;

      console.log(`\n[Stats] Processed: ${stats.processed} | Formats: ${stats.formatsFound} | Websites: ${stats.websitesFound} | Rate: ${rate}/min | Errors: ${stats.errors}`);

      console.log(`Waiting ${DELAY_BETWEEN_BATCHES/1000}s...`);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));

    } catch (e) {
      console.error(`[Error] ${e.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
  const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;

  console.log('\n\n' + '='.repeat(60));
  console.log('   STOPPED');
  console.log('='.repeat(60));
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   Formats Found: ${stats.formatsFound}`);
  console.log(`   Websites Found: ${stats.websitesFound}`);
  console.log(`   Rate: ${rate} companies/min`);
  process.exit(0);
});

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
