#!/usr/bin/env node

/**
 * CONTACT PHONE ENRICHMENT
 *
 * Finds phone numbers for contacts/people at companies
 * Searches team pages, about pages, LinkedIn-style profiles
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

const PARALLEL = 8;
const BATCH_SIZE = 40;
const TIMEOUT = 6000;

let stats = { processed: 0, phones: 0, errors: 0, start: Date.now() };

const http = axios.create({
  timeout: TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 2
});

/**
 * Extract phone from text near a person's name
 */
function extractPhoneNearName(html, name) {
  // UK phone patterns
  const phonePatterns = [
    /(?:\+44|0044|0)[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
    /\d{5}\s?\d{6}/g,
    /\d{4}\s?\d{3}\s?\d{4}/g
  ];

  // Find name in HTML and look nearby for phone
  const nameLower = name.toLowerCase();
  const htmlLower = html.toLowerCase();
  const idx = htmlLower.indexOf(nameLower);

  if (idx === -1) return null;

  // Get context around name (500 chars)
  const context = html.substring(Math.max(0, idx - 200), Math.min(html.length, idx + 300));

  for (const pattern of phonePatterns) {
    const matches = context.match(pattern) || [];
    for (const match of matches) {
      const cleaned = match.replace(/[\s.-]/g, '').replace(/^\+?44/, '0');
      if (cleaned.length >= 10 && cleaned.length <= 12) {
        if (/^0[1-9]\d{8,10}$/.test(cleaned)) {
          return cleaned;
        }
      }
    }
  }

  return null;
}

/**
 * Find phone for contact from company website
 */
async function findContactPhone(contact, companyWebsite) {
  if (!companyWebsite || !contact.first_name) return null;

  const fullName = `${contact.first_name} ${contact.last_name || ''}`.trim();
  const base = companyWebsite.replace(/\/$/, '');

  // Pages likely to have team info
  const pages = [
    `${base}/team`,
    `${base}/about`,
    `${base}/our-team`,
    `${base}/people`,
    `${base}/staff`,
    `${base}/about-us`,
    `${base}/meet-the-team`,
    `${base}/contact`
  ];

  const results = await Promise.allSettled(
    pages.slice(0, 4).map(url => http.get(url).catch(() => null))
  );

  for (const res of results) {
    if (res.status !== 'fulfilled' || !res.value?.data) continue;

    const html = res.value.data;

    // Look for phone near person's name
    const phone = extractPhoneNearName(html, fullName);
    if (phone) return phone;

    // Also try first name only
    if (contact.first_name) {
      const phoneByFirst = extractPhoneNearName(html, contact.first_name);
      if (phoneByFirst) return phoneByFirst;
    }
  }

  return null;
}

/**
 * Search web for contact phone
 */
async function searchContactPhone(contact, companyName) {
  const fullName = `${contact.first_name} ${contact.last_name || ''}`.trim();

  try {
    const query = `"${fullName}" "${companyName}" phone`;
    const response = await http.get(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    );

    const text = response.data;

    // UK phone patterns
    const phoneMatch = text.match(/(?:\+44|0044|0)[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/);
    if (phoneMatch) {
      const cleaned = phoneMatch[0].replace(/[\s.-]/g, '').replace(/^\+?44/, '0');
      if (cleaned.length >= 10 && /^0[1-9]\d{8,10}$/.test(cleaned)) {
        return cleaned;
      }
    }
  } catch (e) {
    // Ignore search errors
  }

  return null;
}

/**
 * Process a contact
 */
async function processContact(contact) {
  try {
    // Try website first
    let phone = await findContactPhone(contact, contact.website);

    // Try web search if no result
    if (!phone && contact.company_name) {
      phone = await searchContactPhone(contact, contact.company_name);
    }

    if (phone) {
      await pool.query(
        'UPDATE contacts SET phone_number = $1, updated_at = NOW() WHERE contact_id = $2',
        [phone, contact.contact_id]
      );
      stats.phones++;
      return { name: `${contact.first_name} ${contact.last_name || ''}`, phone };
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
 * Get contacts missing phone numbers
 */
async function getContacts(limit) {
  const result = await pool.query(`
    SELECT c.contact_id, c.first_name, c.last_name, c.email,
           a.company_name, a.website
    FROM contacts c
    LEFT JOIN accounts a ON c.linked_account_id = a.account_id
    WHERE (c.phone_number IS NULL OR c.phone_number = '')
      AND c.first_name IS NOT NULL
      AND c.first_name != ''
      AND c.first_name != 'General'
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
  console.log('   CONTACT PHONE ENRICHMENT');
  console.log('='.repeat(60));
  console.log('   Finding phone numbers for people/contacts');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    console.log(`[Batch ${batch}] Loading contacts...`);

    try {
      const contacts = await getContacts(BATCH_SIZE);

      if (contacts.length === 0) {
        console.log('  No more contacts to process! Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      console.log(`  Processing ${contacts.length} contacts...\n`);

      for (let i = 0; i < contacts.length; i += PARALLEL) {
        const chunk = contacts.slice(i, i + PARALLEL);
        const results = await Promise.all(chunk.map(c => processContact(c)));

        results.filter(r => r).forEach(r => {
          console.log(`    + ${r.name}: ${r.phone}`);
        });
      }

      const elapsed = Math.floor((Date.now() - stats.start) / 1000);
      const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;

      console.log(`\n[Stats] Processed: ${stats.processed} | Phones Found: ${stats.phones} | Rate: ${rate}/min`);

      await new Promise(r => setTimeout(r, 3000));

    } catch (e) {
      console.error(`[Error] ${e.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\nStopped.');
  console.log(`Contact phones found: ${stats.phones}`);
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
