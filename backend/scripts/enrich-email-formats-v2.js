#!/usr/bin/env node

/**
 * EMAIL FORMAT DETECTION v2
 *
 * Focuses on companies WITH websites for better results
 * Ensures proper domain extraction (.com, .co.uk, etc)
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const PARALLEL = 10;
const BATCH_SIZE = 50;
const TIMEOUT = 6000;

// Generic prefixes to skip
const GENERIC = new Set([
  'info', 'contact', 'hello', 'hi', 'enquiries', 'admin', 'sales', 'support',
  'help', 'office', 'reception', 'mail', 'email', 'customercare', 'customer',
  'service', 'bookings', 'orders', 'accounts', 'billing', 'hr', 'jobs',
  'careers', 'marketing', 'press', 'media', 'team', 'general', 'feedback',
  'webmaster', 'noreply', 'no-reply', 'newsletter', 'enquiry'
]);

// Common names for pattern matching
const NAMES = new Set([
  'james', 'john', 'robert', 'michael', 'david', 'william', 'richard',
  'thomas', 'daniel', 'matthew', 'mark', 'steven', 'paul', 'andrew',
  'mary', 'jennifer', 'linda', 'elizabeth', 'susan', 'jessica', 'sarah',
  'karen', 'lisa', 'nancy', 'ashley', 'emily', 'amanda', 'melissa',
  'oliver', 'jack', 'harry', 'charlie', 'george', 'peter', 'simon',
  'amelia', 'isla', 'ava', 'mia', 'lily', 'sophia', 'grace', 'emma'
]);

let stats = { processed: 0, formats: 0, errors: 0, start: Date.now() };

const http = axios.create({
  timeout: TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 2
});

/**
 * Extract full domain from URL (including TLD)
 */
function getDomain(url) {
  if (!url) return null;
  try {
    // Handle various URL formats
    let domain = url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0];

    // Must have a TLD
    if (!domain.includes('.')) return null;
    return domain;
  } catch {
    return null;
  }
}

/**
 * Check if email is generic
 */
function isGeneric(email) {
  if (!email) return true;
  const local = email.split('@')[0].toLowerCase();
  if (/^\d/.test(local)) return true;
  for (const g of GENERIC) {
    if (local === g || local.startsWith(g)) return true;
  }
  return false;
}

/**
 * Detect format pattern from email
 */
function detectFormat(email, domain) {
  if (!email || !domain || isGeneric(email)) return null;

  const local = email.split('@')[0].toLowerCase();

  // first.last pattern
  if (/^[a-z]+\.[a-z]+$/.test(local)) {
    const [first] = local.split('.');
    if (NAMES.has(first) || first.length >= 3) {
      return `{first}.{last}@${domain}`;
    }
  }

  // first_last pattern
  if (/^[a-z]+_[a-z]+$/.test(local)) {
    return `{first}_{last}@${domain}`;
  }

  // f.last pattern (initial.lastname)
  if (/^[a-z]\.[a-z]+$/.test(local)) {
    return `{f}.{last}@${domain}`;
  }

  // flast pattern (initial + lastname)
  if (/^[a-z][a-z]{4,}$/.test(local) && !NAMES.has(local)) {
    return `{f}{last}@${domain}`;
  }

  return null;
}

/**
 * Scrape emails from website pages
 */
async function scrapeEmails(website) {
  const domain = getDomain(website);
  if (!domain) return [];

  const emails = [];
  const base = website.replace(/\/$/, '');
  const pages = [base, `${base}/about`, `${base}/about-us`, `${base}/team`, `${base}/contact`];

  // Fetch pages in parallel
  const results = await Promise.allSettled(
    pages.map(url => http.get(url).catch(() => null))
  );

  for (const result of results) {
    if (result.status !== 'fulfilled' || !result.value?.data) continue;

    const html = result.value.data;

    // Look for emails matching company domain
    const emailRegex = new RegExp(`[a-zA-Z0-9._%+-]+@${domain.replace(/\./g, '\\.')}`, 'gi');
    const found = html.match(emailRegex) || [];

    // Also check for mailto links
    const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let match;
    while ((match = mailtoRegex.exec(html)) !== null) {
      const email = match[1].toLowerCase();
      if (email.includes(domain.split('.')[0])) { // Same company
        found.push(email);
      }
    }

    for (const email of found) {
      const lower = email.toLowerCase();
      if (!isGeneric(lower) && !emails.find(e => e.email === lower)) {
        emails.push({ email: lower, domain });
        if (emails.length >= 5) break;
      }
    }

    if (emails.length >= 5) break;
  }

  return emails;
}

/**
 * Get best format from found emails
 */
function getBestFormat(emails) {
  if (!emails.length) return null;

  const counts = {};
  for (const { email, domain } of emails) {
    const fmt = detectFormat(email, domain);
    if (fmt) counts[fmt] = (counts[fmt] || 0) + 1;
  }

  let best = null, max = 0;
  for (const [fmt, cnt] of Object.entries(counts)) {
    if (cnt > max) { max = cnt; best = fmt; }
  }

  // Fallback inference
  if (!best && emails.length > 0) {
    const { email, domain } = emails[0];
    const local = email.split('@')[0];
    if (local.includes('.')) best = `{first}.{last}@${domain}`;
    else if (local.includes('_')) best = `{first}_{last}@${domain}`;
  }

  return best;
}

/**
 * Process single company
 */
async function processCompany(company) {
  try {
    const emails = await scrapeEmails(company.website);

    if (emails.length > 0) {
      const format = getBestFormat(emails);

      if (format && format.includes('.')) { // Must have domain TLD
        await pool.query(
          'UPDATE accounts SET email_format = $1, updated_at = NOW() WHERE account_id = $2',
          [format, company.account_id]
        );
        stats.formats++;
        return { name: company.company_name, format };
      }
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
 * Get companies WITH websites that need email format
 */
async function getCompanies(limit) {
  const result = await pool.query(`
    SELECT account_id, company_name, website
    FROM accounts
    WHERE website IS NOT NULL
      AND website != ''
      AND (email_format IS NULL OR email_format = '' OR email_format NOT LIKE '{%')
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
  console.log('   EMAIL FORMAT DETECTION v2');
  console.log('='.repeat(60));
  console.log('   Focus: Companies WITH websites');
  console.log('   Detecting: {first}.{last}@domain.com patterns');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    console.log(`[Batch ${batch}] Loading...`);

    try {
      const companies = await getCompanies(BATCH_SIZE);

      if (companies.length === 0) {
        console.log('  All companies with websites processed! Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      console.log(`  Processing ${companies.length} companies with websites...\n`);

      // Process in parallel chunks
      for (let i = 0; i < companies.length; i += PARALLEL) {
        const chunk = companies.slice(i, i + PARALLEL);
        const results = await Promise.all(chunk.map(c => processCompany(c)));

        // Log found formats
        results.filter(r => r?.format).forEach(r => {
          console.log(`    + ${r.name}: ${r.format}`);
        });
      }

      const elapsed = Math.floor((Date.now() - stats.start) / 1000);
      const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;

      console.log(`\n[Stats] Processed: ${stats.processed} | Formats: ${stats.formats} | Rate: ${rate}/min | Errors: ${stats.errors}`);

      await new Promise(r => setTimeout(r, 2000));

    } catch (e) {
      console.error(`[Error] ${e.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\nStopped.');
  console.log(`Processed: ${stats.processed} | Formats Found: ${stats.formats}`);
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
