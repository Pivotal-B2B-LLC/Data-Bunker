#!/usr/bin/env node

/**
 * AGENT: CONTACT FINDER
 *
 * Finds management contacts (Directors, C-Level, VPs) from company websites
 * Scrapes team pages, about pages, leadership pages
 * Uses strict name validation to avoid garbage
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');
const TURBO_CONFIG = require('./turbo-config');
const { isValidPersonName, isValidJobTitle } = require('../../src/services/nameVerifier');

const AGENT_NAME = 'CONTACT-FINDER';
const CONFIG = TURBO_CONFIG.CONTACT;

// Management titles to look for
const MANAGEMENT_TITLES = [
  'director', 'managing director', 'executive director', 'board director',
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'chief executive', 'chief technology',
  'chief financial', 'chief operating', 'chief marketing', 'chief information',
  'president', 'vice president', 'vp', 'svp', 'evp',
  'owner', 'co-owner', 'founder', 'co-founder',
  'partner', 'managing partner', 'senior partner',
  'principal', 'head of', 'general manager', 'md'
];

const http = axios.create({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 3
});

let stats = {
  companies: 0,
  contacts: 0,
  withEmail: 0,
  withPhone: 0,
  errors: 0,
  start: Date.now()
};

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${AGENT_NAME}] ${msg}`);
}

function isManagementTitle(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return MANAGEMENT_TITLES.some(t => lower.includes(t));
}

function findJobTitle(text) {
  const lower = text.toLowerCase();
  for (const title of MANAGEMENT_TITLES) {
    if (lower.includes(title)) {
      const regex = new RegExp(`([\\w\\s]*${title}[\\w\\s]*)`, 'i');
      const match = text.match(regex);
      if (match) {
        let fullTitle = match[1].trim().substring(0, 50);
        return fullTitle.split(/\s+/)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');
      }
    }
  }
  return null;
}

function extractPhone(text) {
  const patterns = [
    /(?:\+44|0044|0)[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/,
    /\d{5}\s?\d{6}/
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

function getDomain(url) {
  if (!url) return null;
  try {
    return url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
  } catch { return null; }
}

function generateEmail(emailFormat, domain, firstName, lastName) {
  if (!emailFormat || !domain) return null;
  try {
    const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const l = lastName.toLowerCase().replace(/[^a-z]/g, '');
    if (!f || !l) return null;
    let email = emailFormat
      .replace(/\{first\.last\}/g, `${f}.${l}`)
      .replace(/\{f\.last\}/g,    `${f[0]}.${l}`)
      .replace(/\{first_last\}/g, `${f}_${l}`)
      .replace(/\{first\}/g,      f)
      .replace(/\{last\}/g,       l)
      .replace(/\{f\}/g,          f[0])
      .replace(/\{l\}/g,          l[0]);
    if (!email.includes('@')) email += `@${domain}`;
    if (/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return email;
    return null;
  } catch { return null; }
}

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
    $(selector).each((_, el) => {
      if (contacts.length >= CONFIG.MAX_CONTACTS_PER_COMPANY) return false;

      const text = $(el).text();
      const namePattern = /([A-Z][a-z]+)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;

      let match;
      while ((match = namePattern.exec(text)) !== null) {
        const fullName = match[0].trim();
        if (fullName.length < 4 || seenNames.has(fullName.toLowerCase())) continue;

        const parts = fullName.split(/\s+/);
        if (parts.length < 2) continue;

        const firstName = parts[0];
        const lastName = parts.slice(1).join(' ');

        if (!isValidPersonName(firstName, lastName)) continue;

        const context = text.substring(
          Math.max(0, text.indexOf(match[0]) - 200),
          Math.min(text.length, text.indexOf(match[0]) + 300)
        );

        const jobTitle = findJobTitle(context);
        if (!isManagementTitle(jobTitle)) continue;
        if (!isValidJobTitle(jobTitle)) continue;

        seenNames.add(fullName.toLowerCase());

        // Extract email if present
        let email = null;
        const emailRegex = new RegExp(`[a-zA-Z0-9._%+-]+@${domain?.replace(/\./g, '\\.') || '[a-zA-Z0-9.-]+'}\\.[a-zA-Z]{2,}`, 'gi');
        const emails = context.match(emailRegex) || [];
        for (const e of emails) {
          const local = e.split('@')[0].toLowerCase();
          if (!['info', 'contact', 'hello', 'admin', 'sales', 'support'].includes(local)) {
            email = e.toLowerCase();
            break;
          }
        }

        contacts.push({
          firstName,
          lastName,
          email,
          phone: extractPhone(context),
          jobTitle
        });
      }
    });
  }

  return contacts.slice(0, CONFIG.MAX_CONTACTS_PER_COMPANY);
}

async function processCompany(company) {
  if (!company.website) return 0;

  const domain = getDomain(company.website);
  const base = company.website.replace(/\/$/, '');
  const allContacts = [];
  const seenNames = new Set();

  const pages = [
    `${base}/team`, `${base}/about`, `${base}/about-us`, `${base}/our-team`,
    `${base}/leadership`, `${base}/directors`, `${base}/management`,
    `${base}/people`, `${base}/staff`, base
  ];

  try {
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
          allContacts.push(contact);
        }
      }

      if (allContacts.length >= CONFIG.MAX_CONTACTS_PER_COMPANY) break;
    }
  } catch (e) {
    stats.errors++;
  }

  // Save contacts
  let saved = 0;
  for (const contact of allContacts.slice(0, CONFIG.MAX_CONTACTS_PER_COMPANY)) {
    try {
      // Final safety net: re-validate before saving
      if (!isValidPersonName(contact.firstName, contact.lastName)) continue;

      const exists = await pool.query(
        `SELECT 1 FROM contacts WHERE linked_account_id = $1
         AND LOWER(first_name) = LOWER($2) AND LOWER(last_name) = LOWER($3) LIMIT 1`,
        [company.account_id, contact.firstName, contact.lastName]
      );

      if (exists.rows.length === 0) {
        // If no direct email found on page, generate one from company email format
        const email = contact.email ||
          generateEmail(company.email_format, domain, contact.firstName, contact.lastName);

        await pool.query(`
          INSERT INTO contacts (linked_account_id, first_name, last_name, email, phone_number, job_title, data_source, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'Agent:Contact', NOW())
        `, [company.account_id, contact.firstName, contact.lastName, email, contact.phone, contact.jobTitle]);

        saved++;
        stats.contacts++;
        if (email) stats.withEmail++;
        if (contact.phone) stats.withPhone++;
      }
    } catch (e) {
      stats.errors++;
    }
  }

  return saved;
}

async function getCompaniesToProcess() {
  const result = await pool.query(`
    SELECT a.account_id, a.company_name, a.website, a.email_format
    FROM accounts a
    WHERE a.website IS NOT NULL AND a.website != ''
    AND NOT EXISTS (
      -- Only skip if we've already scraped this company's website for contacts
      SELECT 1 FROM contacts c
      WHERE c.linked_account_id = a.account_id
        AND c.data_source = 'Agent:Contact'
    )
    ORDER BY
      -- Prioritize half-enriched: companies that are most complete except for contacts
      (CASE WHEN a.phone_number IS NOT NULL AND a.phone_number != '' THEN 4 ELSE 0 END +
       CASE WHEN a.email_format IS NOT NULL AND a.email_format != '' THEN 4 ELSE 0 END +
       CASE WHEN a.linkedin_url IS NOT NULL AND a.linkedin_url != '' THEN 3 ELSE 0 END +
       CASE WHEN a.address IS NOT NULL AND a.address != '' THEN 2 ELSE 0 END +
       CASE WHEN a.industry IS NOT NULL AND a.industry != '' THEN 1 ELSE 0 END) DESC,
      RANDOM()
    LIMIT $1
  `, [CONFIG.BATCH_SIZE]);
  return result.rows;
}

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000 / 60);
  log('');
  log('='.repeat(50));
  log(`STATS after ${elapsed} minutes:`);
  log(`  Companies processed: ${stats.companies}`);
  log(`  Contacts found: ${stats.contacts}`);
  log(`  With email: ${stats.withEmail}`);
  log(`  With phone: ${stats.withPhone}`);
  log(`  Errors: ${stats.errors}`);
  log('='.repeat(50));
  log('');
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log(`   AGENT: ${AGENT_NAME}`);
  console.log('='.repeat(60));
  console.log('   Finds management contacts from company websites');
  console.log('   Targets: Directors, C-Level, VPs, Founders');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    log(`Batch ${batch}: Loading companies...`);

    try {
      const companies = await getCompaniesToProcess();

      if (companies.length === 0) {
        log('No companies without contacts. Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      log(`Processing ${companies.length} companies...`);

      for (let i = 0; i < companies.length; i += CONFIG.PARALLEL) {
        const chunk = companies.slice(i, i + CONFIG.PARALLEL);
        const results = await Promise.all(chunk.map(c => processCompany(c)));

        for (let j = 0; j < results.length; j++) {
          stats.companies++;
          if (results[j] > 0) {
            log(`  + ${chunk[j].company_name}: ${results[j]} contacts`);
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
