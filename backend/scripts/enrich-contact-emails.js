#!/usr/bin/env node

/**
 * CONTACT EMAIL ENRICHMENT
 *
 * Finds actual email addresses for people/contacts at companies
 * - Scrapes team/about pages for employee emails
 * - Searches web for person + company emails
 * - Generates likely emails from detected patterns
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

const PARALLEL = 8;
const BATCH_SIZE = 40;
const TIMEOUT = 6000;

// Generic emails to skip
const GENERIC = new Set([
  'info', 'contact', 'hello', 'enquiries', 'admin', 'sales', 'support',
  'help', 'office', 'reception', 'mail', 'customer', 'service', 'bookings',
  'orders', 'accounts', 'hr', 'jobs', 'careers', 'marketing', 'press',
  'team', 'general', 'feedback', 'noreply', 'newsletter'
]);

let stats = { processed: 0, emails: 0, errors: 0, start: Date.now() };

const http = axios.create({
  timeout: TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 2
});

/**
 * Check if email looks like a person's email (not generic)
 */
function isPersonalEmail(email) {
  if (!email) return false;
  const local = email.split('@')[0].toLowerCase();

  // Skip generic
  for (const g of GENERIC) {
    if (local === g || local.startsWith(g + '.') || local.startsWith(g + '_')) return false;
  }

  // Skip if starts with numbers
  if (/^\d/.test(local)) return false;

  // Looks like personal email patterns
  if (/^[a-z]+\.[a-z]+$/.test(local)) return true;  // first.last
  if (/^[a-z]+_[a-z]+$/.test(local)) return true;   // first_last
  if (/^[a-z]\.[a-z]+$/.test(local)) return true;   // f.last
  if (/^[a-z][a-z]{4,}$/.test(local)) return true;  // flast

  return false;
}

/**
 * Extract domain from URL
 */
function getDomain(url) {
  if (!url) return null;
  try {
    return url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
  } catch {
    return null;
  }
}

/**
 * Generate likely email from name and domain
 */
function generateLikelyEmails(firstName, lastName, domain) {
  if (!firstName || !domain) return [];

  const first = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const last = lastName ? lastName.toLowerCase().replace(/[^a-z]/g, '') : '';

  if (!first) return [];

  const emails = [];

  if (last) {
    emails.push(`${first}.${last}@${domain}`);
    emails.push(`${first}${last}@${domain}`);
    emails.push(`${first[0]}${last}@${domain}`);
    emails.push(`${first[0]}.${last}@${domain}`);
    emails.push(`${first}_${last}@${domain}`);
    emails.push(`${first}@${domain}`);
  } else {
    emails.push(`${first}@${domain}`);
  }

  return emails;
}

/**
 * Search website for emails matching a person
 */
async function findEmailOnWebsite(firstName, lastName, website) {
  if (!website || !firstName) return null;

  const domain = getDomain(website);
  if (!domain) return null;

  const fullName = `${firstName} ${lastName || ''}`.trim().toLowerCase();
  const base = website.replace(/\/$/, '');

  // Pages likely to have team/contact info
  const pages = [
    `${base}/team`,
    `${base}/about`,
    `${base}/about-us`,
    `${base}/our-team`,
    `${base}/people`,
    `${base}/staff`,
    `${base}/contact`
  ];

  const results = await Promise.allSettled(
    pages.slice(0, 4).map(url => http.get(url).catch(() => null))
  );

  for (const res of results) {
    if (res.status !== 'fulfilled' || !res.value?.data) continue;

    const html = res.value.data;
    const htmlLower = html.toLowerCase();

    // Check if person's name is on the page
    if (!htmlLower.includes(firstName.toLowerCase())) continue;

    // Find emails on this page
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = html.match(emailRegex) || [];

    for (const email of emails) {
      const lower = email.toLowerCase();
      const emailDomain = lower.split('@')[1];

      // Must be company domain and look personal
      if (emailDomain === domain && isPersonalEmail(lower)) {
        // Check if email matches the person's name
        const local = lower.split('@')[0];
        const first = firstName.toLowerCase();
        const last = lastName ? lastName.toLowerCase() : '';

        if (local.includes(first) || (last && local.includes(last))) {
          return lower;
        }
      }
    }

    // Look for mailto links near the person's name
    const $ = cheerio.load(html);
    const nameIdx = htmlLower.indexOf(fullName);

    if (nameIdx > -1) {
      // Get surrounding HTML
      const context = html.substring(Math.max(0, nameIdx - 500), Math.min(html.length, nameIdx + 500));
      const mailtoMatch = context.match(/mailto:([^"'>\s]+)/i);

      if (mailtoMatch) {
        const email = mailtoMatch[1].toLowerCase().split('?')[0];
        if (email.includes('@') && isPersonalEmail(email)) {
          return email;
        }
      }
    }
  }

  return null;
}

/**
 * Search web for person's email
 */
async function searchWebForEmail(firstName, lastName, companyName) {
  if (!firstName || !companyName) return null;

  const fullName = `${firstName} ${lastName || ''}`.trim();

  try {
    const query = `"${fullName}" "${companyName}" email`;
    const response = await http.get(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    );

    const emails = response.data.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];

    for (const email of emails) {
      const lower = email.toLowerCase();
      if (isPersonalEmail(lower)) {
        const local = lower.split('@')[0];
        const first = firstName.toLowerCase();
        const last = lastName ? lastName.toLowerCase() : '';

        // Check if email matches the name
        if (local.includes(first) || (last && local.includes(last))) {
          return lower;
        }
      }
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

/**
 * Verify email format exists in database and generate email
 */
async function generateFromFormat(firstName, lastName, accountId) {
  if (!firstName) return null;

  try {
    const result = await pool.query(
      "SELECT email_format FROM accounts WHERE account_id = $1 AND email_format LIKE '{%'",
      [accountId]
    );

    if (result.rows.length === 0 || !result.rows[0].email_format) return null;

    const format = result.rows[0].email_format;
    const first = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const last = lastName ? lastName.toLowerCase().replace(/[^a-z]/g, '') : '';

    if (!first) return null;

    // Parse format like {first}.{last}@domain.com
    let email = format
      .replace('{first}', first)
      .replace('{last}', last || 'unknown')
      .replace('{f}', first[0] || '')
      .replace('{l}', last ? last[0] : '');

    // Only return if we have all parts
    if (!email.includes('{') && email.includes('@') && email.includes('.')) {
      return email;
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

/**
 * Process a contact
 */
async function processContact(contact) {
  try {
    let email = null;

    // Method 1: Search company website
    if (contact.website) {
      email = await findEmailOnWebsite(contact.first_name, contact.last_name, contact.website);
    }

    // Method 2: Search web
    if (!email && contact.company_name) {
      email = await searchWebForEmail(contact.first_name, contact.last_name, contact.company_name);
    }

    // Method 3: Generate from company email format
    if (!email && contact.linked_account_id) {
      email = await generateFromFormat(contact.first_name, contact.last_name, contact.linked_account_id);
    }

    if (email) {
      await pool.query(
        'UPDATE contacts SET email = $1, updated_at = NOW() WHERE contact_id = $2',
        [email, contact.contact_id]
      );
      stats.emails++;
      return { name: `${contact.first_name} ${contact.last_name || ''}`, email };
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
 * Get contacts missing emails
 */
async function getContacts(limit) {
  const result = await pool.query(`
    SELECT c.contact_id, c.first_name, c.last_name, c.linked_account_id,
           a.company_name, a.website, a.email_format
    FROM contacts c
    LEFT JOIN accounts a ON c.linked_account_id = a.account_id
    WHERE (c.email IS NULL OR c.email = '')
      AND c.first_name IS NOT NULL
      AND c.first_name != ''
      AND c.first_name != 'General'
      AND c.first_name != 'Contact'
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
  console.log('   CONTACT EMAIL ENRICHMENT');
  console.log('='.repeat(60));
  console.log('   Finding personal/business emails for contacts');
  console.log('   Methods: Website scrape, Web search, Format generation');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    console.log(`[Batch ${batch}] Loading contacts...`);

    try {
      const contacts = await getContacts(BATCH_SIZE);

      if (contacts.length === 0) {
        console.log('  No more contacts! Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      console.log(`  Processing ${contacts.length} contacts...\n`);

      for (let i = 0; i < contacts.length; i += PARALLEL) {
        const chunk = contacts.slice(i, i + PARALLEL);
        const results = await Promise.all(chunk.map(c => processContact(c)));

        results.filter(r => r).forEach(r => {
          console.log(`    + ${r.name}: ${r.email}`);
        });
      }

      const elapsed = Math.floor((Date.now() - stats.start) / 1000);
      const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;

      console.log(`\n[Stats] Processed: ${stats.processed} | Emails Found: ${stats.emails} | Rate: ${rate}/min`);

      await new Promise(r => setTimeout(r, 3000));

    } catch (e) {
      console.error(`[Error] ${e.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\nStopped.');
  console.log(`Contact emails found: ${stats.emails}`);
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
