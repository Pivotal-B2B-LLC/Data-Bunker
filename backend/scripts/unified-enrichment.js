#!/usr/bin/env node

/**
 * UNIFIED ENRICHMENT SYSTEM
 *
 * All-in-one enrichment pipeline:
 * 1. Find management contacts (Directors, VPs, C-Level, Owners)
 * 2. Enrich contact emails
 * 3. Enrich contact phones
 * 4. Enrich company phones & addresses
 * 5. Detect email formats
 *
 * Runs continuously with smart prioritization
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// ==================== CONFIGURATION ====================
const CONFIG = {
  PARALLEL: 8,
  BATCH_SIZE: 40,
  TIMEOUT: 8000,
  MAX_CONTACTS_PER_COMPANY: 7,
  CYCLE_DELAY: 2000,  // Delay between enrichment cycles
};

// Management titles to find
const MANAGEMENT_TITLES = [
  'director', 'managing director', 'executive director', 'board director',
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'chief executive', 'chief technology',
  'chief financial', 'chief operating', 'chief marketing', 'chief information',
  'president', 'vice president', 'vp', 'svp', 'evp',
  'owner', 'co-owner', 'founder', 'co-founder',
  'partner', 'managing partner', 'senior partner',
  'principal', 'head of', 'general manager', 'md'
];

// Generic emails to skip
const GENERIC_EMAILS = new Set([
  'info', 'contact', 'hello', 'enquiries', 'admin', 'sales', 'support',
  'help', 'office', 'reception', 'mail', 'customer', 'service', 'bookings',
  'orders', 'accounts', 'hr', 'jobs', 'careers', 'marketing', 'press',
  'team', 'general', 'feedback', 'noreply', 'newsletter'
]);

// Stats tracking
let stats = {
  contacts: { found: 0, emails: 0, phones: 0 },
  companies: { phones: 0, addresses: 0, emailFormats: 0 },
  processed: 0,
  errors: 0,
  start: Date.now()
};

const http = axios.create({
  timeout: CONFIG.TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 2
});

// ==================== UTILITY FUNCTIONS ====================

function isPersonalEmail(email) {
  if (!email) return false;
  const local = email.split('@')[0].toLowerCase();
  if (/^\d/.test(local)) return false;
  for (const g of GENERIC_EMAILS) {
    if (local === g || local.startsWith(g)) return false;
  }
  return true;
}

function getDomain(url) {
  if (!url) return null;
  try {
    let domain = url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0];
    if (!domain.includes('.')) return null;
    return domain;
  } catch { return null; }
}

function cleanName(name) {
  if (!name) return null;
  let cleaned = name
    .replace(/\b(mr|mrs|ms|miss|dr|prof|sir|dame|lord|lady)\b\.?/gi, '')
    .replace(/\b(phd|mba|md|llb|ba|bsc|ma|msc)\b\.?/gi, '')
    .replace(/[^\w\s'-]/g, '')
    .trim();
  if (cleaned.length < 2 || !/^[a-zA-Z]/.test(cleaned)) return null;
  return cleaned.split(/\s+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractPhone(text) {
  const patterns = [
    /(?:\+44|0044|0)[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/,
    /\d{5}\s?\d{6}/,
    /\d{4}\s?\d{3}\s?\d{4}/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const cleaned = match[0].replace(/[\s.-]/g, '').replace(/^\+?44/, '0');
      if (cleaned.length >= 10 && cleaned.length <= 12) return cleaned;
    }
  }
  return null;
}

function isManagementTitle(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  for (const mgmt of MANAGEMENT_TITLES) {
    if (lower.includes(mgmt)) return true;
  }
  return false;
}

function findJobTitle(text) {
  const lower = text.toLowerCase();
  for (const title of MANAGEMENT_TITLES) {
    if (lower.includes(title)) {
      const regex = new RegExp(`([\\w\\s]*${title}[\\w\\s]*)`, 'i');
      const match = text.match(regex);
      if (match) {
        let fullTitle = match[1].trim();
        if (fullTitle.length > 50) fullTitle = fullTitle.substring(0, 50);
        return fullTitle.split(/\s+/)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }
    }
  }
  return null;
}

function detectEmailFormat(email, domain) {
  if (!email || !domain) return null;
  const emailDomain = email.split('@')[1]?.toLowerCase();
  if (emailDomain !== domain) return null;

  const local = email.split('@')[0].toLowerCase();
  if (GENERIC_EMAILS.has(local.split('.')[0])) return null;

  // Detect patterns
  if (/^[a-z]+\.[a-z]+$/.test(local)) return `{first}.{last}@${domain}`;
  if (/^[a-z]+_[a-z]+$/.test(local)) return `{first}_{last}@${domain}`;
  if (/^[a-z]\.[a-z]+$/.test(local)) return `{f}.{last}@${domain}`;
  if (/^[a-z][a-z]+$/.test(local) && local.length > 4) return `{f}{last}@${domain}`;

  return null;
}

// ==================== CONTACT DISCOVERY ====================

function extractContactsFromHTML(html, domain) {
  const $ = cheerio.load(html);
  const contacts = [];
  const seenNames = new Set();

  const selectors = [
    '.team-member', '.staff-member', '.person', '.member',
    '[class*="team"]', '[class*="staff"]', '[class*="people"]',
    '[class*="director"]', '[class*="employee"]', '[class*="partner"]',
    'article', '.card', '.profile'
  ];

  for (const selector of selectors) {
    $(selector).each((i, el) => {
      if (contacts.length >= CONFIG.MAX_CONTACTS_PER_COMPANY) return false;

      const text = $(el).text();
      const namePattern = /([A-Z][a-z]+)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;

      let match;
      while ((match = namePattern.exec(text)) !== null) {
        const fullName = match[0].trim();
        if (seenNames.has(fullName.toLowerCase()) || fullName.length < 4) continue;

        const cleaned = cleanName(fullName);
        if (!cleaned) continue;

        const parts = cleaned.split(/\s+/);
        if (parts.length < 2) continue;

        const skipWords = ['the', 'our', 'meet', 'about', 'contact', 'read', 'more', 'view', 'all'];
        if (skipWords.includes(parts[0].toLowerCase())) continue;

        const context = text.substring(
          Math.max(0, text.indexOf(fullName) - 200),
          Math.min(text.length, text.indexOf(fullName) + 300)
        );

        const jobTitle = findJobTitle(context);
        if (!isManagementTitle(jobTitle)) continue;  // Only management

        seenNames.add(fullName.toLowerCase());

        // Find email
        let email = null;
        const emailRegex = new RegExp(`[a-zA-Z0-9._%+-]+@${domain?.replace(/\./g, '\\.') || '[a-zA-Z0-9.-]+'}\\.[a-zA-Z]{2,}`, 'gi');
        const emails = context.match(emailRegex) || [];
        for (const e of emails) {
          if (isPersonalEmail(e.toLowerCase())) {
            email = e.toLowerCase();
            break;
          }
        }

        contacts.push({
          firstName: parts[0],
          lastName: parts.slice(1).join(' '),
          email,
          phone: extractPhone(context),
          jobTitle
        });
      }
    });
  }

  return contacts.slice(0, CONFIG.MAX_CONTACTS_PER_COMPANY);
}

async function discoverContacts(company) {
  if (!company.website) return [];

  const domain = getDomain(company.website);
  const base = company.website.replace(/\/$/, '');
  const contacts = [];
  const seenNames = new Set();

  const pages = [
    `${base}/team`, `${base}/about`, `${base}/about-us`, `${base}/our-team`,
    `${base}/leadership`, `${base}/directors`, `${base}/management`, base
  ];

  const results = await Promise.allSettled(
    pages.slice(0, 5).map(url => http.get(url).catch(() => null))
  );

  for (const res of results) {
    if (res.status !== 'fulfilled' || !res.value?.data) continue;

    const found = extractContactsFromHTML(res.value.data, domain);
    for (const contact of found) {
      const key = `${contact.firstName} ${contact.lastName}`.toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        contacts.push(contact);
      }
    }

    if (contacts.length >= CONFIG.MAX_CONTACTS_PER_COMPANY) break;
  }

  return contacts.slice(0, CONFIG.MAX_CONTACTS_PER_COMPANY);
}

// ==================== COMPANY ENRICHMENT ====================

async function enrichCompany(company) {
  if (!company.website) return { phone: null, address: null, emailFormat: null };

  const domain = getDomain(company.website);
  let phone = null, address = null, emailFormat = null;

  try {
    const response = await http.get(company.website);
    const html = response.data;
    const $ = cheerio.load(html);

    // Extract phone
    if (!company.phone_number) {
      phone = extractPhone(html);
    }

    // Extract address (look for postcode)
    if (!company.address) {
      const postcodeMatch = html.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i);
      if (postcodeMatch) {
        const idx = html.indexOf(postcodeMatch[0]);
        const context = html.substring(Math.max(0, idx - 100), idx + 20);
        const cleanContext = context.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanContext.length > 10 && cleanContext.length < 200) {
          address = cleanContext;
        }
      }
    }

    // Detect email format
    if (!company.email_format) {
      const emails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      for (const email of emails) {
        const format = detectEmailFormat(email.toLowerCase(), domain);
        if (format) {
          emailFormat = format;
          break;
        }
      }
    }

  } catch (e) {
    // Ignore errors
  }

  return { phone, address, emailFormat };
}

// ==================== DATABASE OPERATIONS ====================

async function saveContact(accountId, contact) {
  try {
    const exists = await pool.query(
      `SELECT 1 FROM contacts WHERE linked_account_id = $1
       AND LOWER(first_name) = LOWER($2) AND LOWER(last_name) = LOWER($3) LIMIT 1`,
      [accountId, contact.firstName, contact.lastName]
    );

    if (exists.rows.length > 0) return false;

    await pool.query(`
      INSERT INTO contacts (linked_account_id, first_name, last_name, email, phone_number, job_title, data_source, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'Unified Enrichment', NOW())
    `, [accountId, contact.firstName, contact.lastName, contact.email, contact.phone, contact.jobTitle]);

    return true;
  } catch (e) {
    return false;
  }
}

async function updateCompany(accountId, data) {
  try {
    const updates = [];
    const values = [accountId];
    let idx = 2;

    if (data.phone) {
      updates.push(`phone_number = $${idx++}`);
      values.push(data.phone);
    }
    if (data.address) {
      updates.push(`address = $${idx++}`);
      values.push(data.address);
    }
    if (data.emailFormat) {
      updates.push(`email_format = $${idx++}`);
      values.push(data.emailFormat);
    }

    if (updates.length > 0) {
      await pool.query(
        `UPDATE accounts SET ${updates.join(', ')}, updated_at = NOW() WHERE account_id = $1`,
        values
      );
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function getCompaniesToEnrich(limit) {
  const result = await pool.query(`
    SELECT a.account_id, a.company_name, a.website, a.phone_number, a.address, a.email_format
    FROM accounts a
    WHERE a.website IS NOT NULL AND a.website != ''
      AND (
        (SELECT COUNT(*) FROM contacts c WHERE c.linked_account_id = a.account_id) < $2
        OR a.phone_number IS NULL
        OR a.email_format IS NULL
      )
    ORDER BY RANDOM()
    LIMIT $1
  `, [limit, CONFIG.MAX_CONTACTS_PER_COMPANY]);
  return result.rows;
}

// ==================== MAIN ENRICHMENT PIPELINE ====================

async function processCompany(company) {
  const result = { contacts: 0, phone: false, address: false, emailFormat: false };

  try {
    // 1. Discover management contacts
    const contacts = await discoverContacts(company);
    for (const contact of contacts) {
      const saved = await saveContact(company.account_id, contact);
      if (saved) {
        result.contacts++;
        stats.contacts.found++;
        if (contact.email) stats.contacts.emails++;
        if (contact.phone) stats.contacts.phones++;
      }
    }

    // 2. Enrich company data
    const companyData = await enrichCompany(company);

    if (companyData.phone || companyData.address || companyData.emailFormat) {
      await updateCompany(company.account_id, companyData);

      if (companyData.phone) {
        result.phone = true;
        stats.companies.phones++;
      }
      if (companyData.address) {
        result.address = true;
        stats.companies.addresses++;
      }
      if (companyData.emailFormat) {
        result.emailFormat = true;
        stats.companies.emailFormats++;
      }
    }

    stats.processed++;
    return result;

  } catch (e) {
    stats.errors++;
    stats.processed++;
    return result;
  }
}

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000);
  const rate = stats.processed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;

  console.log('\n' + '-'.repeat(50));
  console.log(`[STATS] Processed: ${stats.processed} | Rate: ${rate}/min`);
  console.log(`  Contacts: ${stats.contacts.found} (${stats.contacts.emails} emails, ${stats.contacts.phones} phones)`);
  console.log(`  Companies: ${stats.companies.phones} phones, ${stats.companies.addresses} addresses, ${stats.companies.emailFormats} email formats`);
  console.log('-'.repeat(50) + '\n');
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   UNIFIED ENRICHMENT SYSTEM');
  console.log('='.repeat(60));
  console.log('   All-in-one pipeline:');
  console.log('   - Management contacts (Directors, VPs, C-Level)');
  console.log('   - Contact emails & phones');
  console.log('   - Company phones & addresses');
  console.log('   - Email format detection');
  console.log(`   Max ${CONFIG.MAX_CONTACTS_PER_COMPANY} contacts per company`);
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    console.log(`[Batch ${batch}] Loading companies...`);

    try {
      const companies = await getCompaniesToEnrich(CONFIG.BATCH_SIZE);

      if (companies.length === 0) {
        console.log('  All companies enriched! Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      console.log(`  Processing ${companies.length} companies...\n`);

      for (let i = 0; i < companies.length; i += CONFIG.PARALLEL) {
        const chunk = companies.slice(i, i + CONFIG.PARALLEL);
        const results = await Promise.all(chunk.map(c => processCompany(c)));

        for (let j = 0; j < results.length; j++) {
          const r = results[j];
          const c = chunk[j];

          if (r.contacts > 0 || r.phone || r.emailFormat) {
            const parts = [];
            if (r.contacts > 0) parts.push(`${r.contacts} contacts`);
            if (r.phone) parts.push('phone');
            if (r.address) parts.push('address');
            if (r.emailFormat) parts.push('email format');
            console.log(`    + ${c.company_name}: ${parts.join(', ')}`);
          }
        }
      }

      // Print stats every 5 batches
      if (batch % 5 === 0) printStats();

      await new Promise(r => setTimeout(r, CONFIG.CYCLE_DELAY));

    } catch (e) {
      console.error(`[Error] ${e.message}`);
      stats.errors++;
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\n' + '='.repeat(60));
  console.log('   ENRICHMENT STOPPED');
  console.log('='.repeat(60));
  printStats();
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
