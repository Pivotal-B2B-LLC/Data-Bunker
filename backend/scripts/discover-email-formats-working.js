#!/usr/bin/env node

/**
 * EMAIL FORMAT DISCOVERY - FIXED VERSION
 *
 * Finds email patterns like {first}.{last}@domain.com
 * SKIPS all generic emails (info@, contact@, etc.)
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration
const PARALLEL = 5;
const BATCH_SIZE = 30;
const TIMEOUT = 8000;

// Generic emails to SKIP
const GENERIC = new Set([
  'info', 'contact', 'hello', 'hi', 'enquiries', 'admin', 'sales', 'support',
  'help', 'office', 'reception', 'mail', 'email', 'customercare', 'customer',
  'service', 'bookings', 'orders', 'accounts', 'billing', 'hr', 'jobs',
  'careers', 'marketing', 'press', 'media', 'team', 'general', 'feedback'
]);

// Common first names
const NAMES = new Set([
  'james', 'john', 'robert', 'michael', 'david', 'william', 'sarah',
  'mary', 'jennifer', 'linda', 'oliver', 'jack', 'harry', 'charlie'
]);

let stats = { processed: 0, found: 0, errors: 0, start: Date.now() };

const http = axios.create({
  timeout: TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0' },
  maxRedirects: 2
});

function isGeneric(email) {
  if (!email) return true;
  const local = email.split('@')[0].toLowerCase();
  if (/^\d/.test(local)) return true;
  for (const g of GENERIC) {
    if (local === g || local.startsWith(g)) return true;
  }
  return false;
}

function detectFormat(email, domain) {
  if (!email || !domain || isGeneric(email)) return null;

  const local = email.split('@')[0].toLowerCase();

  // first.last@domain.com
  if (/^[a-z]+\.[a-z]+$/.test(local)) {
    return `{first}.{last}@${domain}`;
  }

  // first_last@domain.com
  if (/^[a-z]+_[a-z]+$/.test(local)) {
    return `{first}_{last}@${domain}`;
  }

  // f.last@domain.com
  if (/^[a-z]\.[a-z]+$/.test(local)) {
    return `{f}.{last}@${domain}`;
  }

  // flast@domain.com
  if (/^[a-z][a-z]{4,}$/.test(local)) {
    return `{f}{last}@${domain}`;
  }

  return null;
}

function extractDomain(url) {
  if (!url) return null;
  try {
    return url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0];
  } catch {
    return null;
  }
}

async function scrapeEmails(websiteUrl) {
  if (!websiteUrl) return [];

  const domain = extractDomain(websiteUrl);
  if (!domain) return [];

  const emails = [];
  const baseUrl = websiteUrl.replace(/\/$/, '');

  // Try multiple pages
  const pages = [
    baseUrl,
    `${baseUrl}/about`,
    `${baseUrl}/team`,
    `${baseUrl}/contact`
  ];

  for (const url of pages) {
    try {
      const response = await http.get(url);
      const html = response.data;

      // Find emails matching this domain
      const emailRegex = new RegExp(`[a-zA-Z0-9._-]+@${domain.replace(/\./g, '\\.')}`, 'gi');
      const found = html.match(emailRegex) || [];

      for (const email of found) {
        const lower = email.toLowerCase();
        if (!isGeneric(lower) && !emails.includes(lower)) {
          emails.push(lower);
          if (emails.length >= 3) break;
        }
      }

      if (emails.length >= 3) break;
    } catch (e) {
      continue;
    }
  }

  return emails.map(e => ({ email: e, domain }));
}

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
    if (count > max) {
      max = count;
      best = fmt;
    }
  }

  return best;
}

async function processCompany(company) {
  try {
    const { website } = company;
    if (!website) {
      stats.processed++;
      return null;
    }

    const emails = await scrapeEmails(website);
    const emailFormat = getBestFormat(emails);

    if (emailFormat) {
      await pool.query(
        'UPDATE accounts SET email_format = $1, updated_at = NOW() WHERE account_id = $2',
        [emailFormat, company.account_id]
      );
      stats.found++;
      stats.processed++;
      return { name: company.company_name, format: emailFormat };
    }

    stats.processed++;
    return null;
  } catch (e) {
    stats.errors++;
    stats.processed++;
    return null;
  }
}

async function getCompanies(limit) {
  try {
    const result = await pool.query(`
      SELECT account_id, company_name, city, website
      FROM accounts
      WHERE website IS NOT NULL
        AND website != ''
        AND (email_format IS NULL OR email_format = '')
        AND company_name IS NOT NULL
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  } catch (e) {
    console.error('[Error]', e.message);
    return [];
  }
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   EMAIL FORMAT DISCOVERY');
  console.log('='.repeat(60));
  console.log(`   Finding patterns: {first}.{last}@company.com`);
  console.log(`   Skipping generic: info@, contact@, etc.`);
  console.log(`   Press Ctrl+C to stop\n`);

  let batch = 0;

  while (true) {
    batch++;
    console.log(`\n[Batch ${batch}] Loading companies with websites...`);

    try {
      const companies = await getCompanies(BATCH_SIZE);

      if (companies.length === 0) {
        console.log('  No more companies to process. Waiting 60s...');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }

      console.log(`  Processing ${companies.length} companies...`);

      // Process in parallel
      for (let i = 0; i < companies.length; i += PARALLEL) {
        const chunk = companies.slice(i, i + PARALLEL);
        const results = await Promise.all(chunk.map(c => processCompany(c)));

        // Log successful finds
        const found = results.filter(r => r);
        found.forEach(r => {
          console.log(`    ✓ ${r.name}`);
          console.log(`      Format: ${r.format}`);
        });
      }

      // Stats
      const elapsed = Math.floor((Date.now() - stats.start) / 1000 / 60);
      console.log(`\n  Stats: ${stats.found} formats found, ${stats.processed} processed, ${stats.errors} errors (${elapsed}m)`);

      // Delay between batches
      await new Promise(r => setTimeout(r, 3000));

    } catch (error) {
      console.error('\n[Batch Error]', error.message);
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n' + '='.repeat(60));
  console.log('   STOPPED');
  console.log('='.repeat(60));
  console.log(`   Formats found: ${stats.found}`);
  console.log(`   Processed: ${stats.processed}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log('='.repeat(60) + '\n');
  process.exit(0);
});

run().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
