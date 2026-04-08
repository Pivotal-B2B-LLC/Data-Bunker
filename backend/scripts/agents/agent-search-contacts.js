#!/usr/bin/env node

/**
 * AGENT: SEARCH-BASED CONTACT FINDER
 *
 * Discovers decision makers by generating targeted search queries for each company.
 *
 * Search patterns generated (using company name + title keywords):
 *   site:linkedin.com/in "Company Name" CEO
 *   site:linkedin.com/in "Company Name" "Managing Director"
 *   site:linkedin.com/in "Company Name" Director
 *   "Company Name" CEO owner founder
 *   "Company Name" "Managing Director" OR MD
 *   "directors of Company Name"
 *   "Company Name" "Sales Manager" OR "Sales Director"
 *   "Company Name" "Logistics Manager" OR "Logistics Director"
 *   "Company Name" "Operations Manager"
 *   "Company Name" management team
 *   ...and more tier-based combinations
 *
 * Parses search result snippets for name + title co-occurrences.
 * Links each contact to the company via linked_account_id.
 * Applies the company's email_format to generate work emails.
 *
 * LEGAL: Only queries publicly available search engine results.
 * No bypassing of authentication, no private/protected data.
 * Equivalent to manual Google research - automated for scale.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');
const { isValidPersonName, isValidJobTitle } = require('../../src/services/nameVerifier');

const AGENT_NAME = 'SEARCH-CONTACTS';

// Conservative config - search engines rate-limit aggressively
const CONFIG = {
  BATCH_SIZE: 15,           // Companies per batch
  PARALLEL: 2,              // Only 2 companies at once (each runs multiple searches)
  DELAY: 12000,             // 12s between batches
  SEARCH_DELAY_MIN: 2000,   // Min 2s between each search query
  SEARCH_DELAY_MAX: 5000,   // Max 5s between each search query
  MAX_CONTACTS: 10,         // Max contacts to save per company
  MAX_QUERIES: 6,           // Max search queries per company per run
  REQUEST_TIMEOUT: 15000,
};

// ============================================================
// SEARCH QUERY TEMPLATES
// {name} is replaced with the cleaned company name
// Sorted by tier (1=best/most senior, 3=broader)
// ============================================================
const SEARCH_TEMPLATES = [
  // === TIER 1: C-Suite via LinkedIn (highest quality structured data) ===
  { query: 'site:linkedin.com/in {name} CEO',                     extractTitle: 'CEO',                           tier: 1 },
  { query: 'site:linkedin.com/in {name} "Managing Director"',     extractTitle: 'Managing Director',             tier: 1 },
  { query: '{name} CEO owner founder',                             extractTitle: 'CEO',                           tier: 1 },
  { query: '{name} "Chief Executive"',                             extractTitle: 'CEO',                           tier: 1 },
  { query: '{name} CFO "Chief Financial Officer"',                 extractTitle: 'CFO',                           tier: 1 },
  { query: '{name} CTO "Chief Technology Officer"',                extractTitle: 'CTO',                           tier: 1 },

  // === TIER 2: Directors ===
  { query: 'site:linkedin.com/in {name} Director',                 extractTitle: 'Director',                      tier: 2 },
  { query: '{name} "Managing Director" OR MD',                     extractTitle: 'Managing Director',             tier: 2 },
  { query: '"directors of {name}"',                                extractTitle: 'Director',                      tier: 2 },
  { query: '{name} director leadership team',                      extractTitle: 'Director',                      tier: 2 },
  { query: '{name} "board of directors"',                          extractTitle: 'Director',                      tier: 2 },
  { query: '{name} "Sales Director" OR "Commercial Director"',     extractTitle: 'Sales Director',                tier: 2 },
  { query: '{name} "Operations Director" OR "Technical Director"', extractTitle: 'Operations Director',           tier: 2 },
  { query: '{name} "Finance Director" OR "Marketing Director"',    extractTitle: 'Finance Director',              tier: 2 },

  // === TIER 3: Management ===
  { query: 'site:linkedin.com/in {name} Manager',                  extractTitle: 'Manager',                       tier: 3 },
  { query: '{name} "Sales Manager"',                               extractTitle: 'Sales Manager',                 tier: 3 },
  { query: '{name} "Logistics Manager" OR "Logistics Director"',   extractTitle: 'Logistics Manager',             tier: 3 },
  { query: '{name} "Operations Manager" OR "General Manager"',     extractTitle: 'Operations Manager',            tier: 3 },
  { query: '{name} "Supply Chain Manager"',                        extractTitle: 'Supply Chain Manager',          tier: 3 },
  { query: '{name} "Finance Manager" OR "Financial Controller"',   extractTitle: 'Finance Manager',               tier: 3 },
  { query: '{name} "Marketing Manager" OR "Head of Marketing"',    extractTitle: 'Marketing Manager',             tier: 3 },
  { query: '{name} "Business Development Manager"',                extractTitle: 'Business Development Manager',  tier: 3 },
  { query: '{name} "HR Manager" OR "Human Resources Manager"',     extractTitle: 'HR Manager',                    tier: 3 },
  { query: '{name} "IT Manager" OR "Head of IT"',                  extractTitle: 'IT Manager',                    tier: 3 },
  { query: '{name} "Head of" management team',                     extractTitle: 'Head of Department',            tier: 3 },
  { query: '{name} management team people contact',                extractTitle: 'Manager',                       tier: 3 },
];

// ============================================================
// JOB TITLE RECOGNITION
// Ordered: specific patterns before generic ones
// ============================================================
const MANAGEMENT_TITLE_PATTERNS = [
  // C-Suite
  { regex: /\bchief executive officer\b|\bceo\b/i,              canonical: 'CEO',                           tier: 1 },
  { regex: /\bchief financial officer\b|\bcfo\b/i,              canonical: 'CFO',                           tier: 1 },
  { regex: /\bchief technology officer\b|\bcto\b/i,             canonical: 'CTO',                           tier: 1 },
  { regex: /\bchief operating officer\b|\bcoo\b/i,              canonical: 'COO',                           tier: 1 },
  { regex: /\bchief marketing officer\b|\bcmo\b/i,              canonical: 'CMO',                           tier: 1 },
  { regex: /\bchief information officer\b|\bcio\b/i,            canonical: 'CIO',                           tier: 1 },
  { regex: /\bchief people officer\b|\bcpo\b/i,                 canonical: 'CPO',                           tier: 1 },
  { regex: /\bco-?founder\b/i,                                  canonical: 'Co-Founder',                    tier: 1 },
  { regex: /\bfounder\b/i,                                      canonical: 'Founder',                       tier: 1 },
  { regex: /\bco-?owner\b/i,                                    canonical: 'Co-Owner',                      tier: 1 },
  { regex: /\bowner\b/i,                                        canonical: 'Owner',                         tier: 1 },
  { regex: /\bpresident\b/i,                                    canonical: 'President',                     tier: 1 },

  // Directors (specific before generic)
  { regex: /\bmanaging director\b/i,                            canonical: 'Managing Director',             tier: 2 },
  { regex: /\bexecutive director\b/i,                           canonical: 'Executive Director',            tier: 2 },
  { regex: /\bnon-?executive director\b|\bned\b/i,              canonical: 'Non-Executive Director',        tier: 2 },
  { regex: /\bsales director\b/i,                               canonical: 'Sales Director',                tier: 2 },
  { regex: /\boperations director\b/i,                          canonical: 'Operations Director',           tier: 2 },
  { regex: /\bcommercial director\b/i,                          canonical: 'Commercial Director',           tier: 2 },
  { regex: /\bfinance director\b/i,                             canonical: 'Finance Director',              tier: 2 },
  { regex: /\bmarketing director\b/i,                           canonical: 'Marketing Director',            tier: 2 },
  { regex: /\btechnical director\b/i,                           canonical: 'Technical Director',            tier: 2 },
  { regex: /\bit director\b/i,                                  canonical: 'IT Director',                   tier: 2 },
  { regex: /\blogistics director\b/i,                           canonical: 'Logistics Director',            tier: 2 },
  { regex: /\bsupply chain director\b/i,                        canonical: 'Supply Chain Director',         tier: 2 },
  { regex: /\bhr director\b|\bhuman resources director\b/i,     canonical: 'HR Director',                   tier: 2 },
  { regex: /\bbusiness development director\b/i,                canonical: 'Business Development Director', tier: 2 },
  { regex: /\bdirector\b/i,                                     canonical: 'Director',                      tier: 2 },

  // VP Level
  { regex: /\bsenior vice president\b|\bsvp\b/i,                canonical: 'Senior Vice President',         tier: 2 },
  { regex: /\bexecutive vice president\b|\bevp\b/i,             canonical: 'Executive Vice President',      tier: 2 },
  { regex: /\bvice president\b|\bvp of\b/i,                     canonical: 'Vice President',                tier: 2 },

  // Partners
  { regex: /\bmanaging partner\b/i,                             canonical: 'Managing Partner',              tier: 2 },
  { regex: /\bsenior partner\b/i,                               canonical: 'Senior Partner',                tier: 2 },
  { regex: /\bpartner\b/i,                                      canonical: 'Partner',                       tier: 2 },

  // Management (specific before generic)
  { regex: /\bgeneral manager\b/i,                              canonical: 'General Manager',               tier: 3 },
  { regex: /\bregional manager\b/i,                             canonical: 'Regional Manager',              tier: 3 },
  { regex: /\bsales manager\b/i,                                canonical: 'Sales Manager',                 tier: 3 },
  { regex: /\boperations manager\b/i,                           canonical: 'Operations Manager',            tier: 3 },
  { regex: /\blogistics manager\b/i,                            canonical: 'Logistics Manager',             tier: 3 },
  { regex: /\bsupply chain manager\b/i,                         canonical: 'Supply Chain Manager',          tier: 3 },
  { regex: /\bfinance manager\b|\bfinancial controller\b/i,     canonical: 'Finance Manager',               tier: 3 },
  { regex: /\bmarketing manager\b/i,                            canonical: 'Marketing Manager',             tier: 3 },
  { regex: /\bbusiness development manager\b/i,                 canonical: 'Business Development Manager',  tier: 3 },
  { regex: /\bhr manager\b|\bhuman resources manager\b/i,       canonical: 'HR Manager',                    tier: 3 },
  { regex: /\bit manager\b/i,                                   canonical: 'IT Manager',                    tier: 3 },
  { regex: /\bproject manager\b/i,                              canonical: 'Project Manager',               tier: 3 },
  { regex: /\baccount manager\b/i,                              canonical: 'Account Manager',               tier: 3 },
  { regex: /\bcommercial manager\b/i,                           canonical: 'Commercial Manager',            tier: 3 },
  { regex: /\bwarehouse manager\b/i,                            canonical: 'Warehouse Manager',             tier: 3 },

  // Head of (specific before generic)
  { regex: /\bhead of sales\b/i,                                canonical: 'Head of Sales',                 tier: 3 },
  { regex: /\bhead of operations\b/i,                           canonical: 'Head of Operations',            tier: 3 },
  { regex: /\bhead of finance\b/i,                              canonical: 'Head of Finance',               tier: 3 },
  { regex: /\bhead of marketing\b/i,                            canonical: 'Head of Marketing',             tier: 3 },
  { regex: /\bhead of logistics\b/i,                            canonical: 'Head of Logistics',             tier: 3 },
  { regex: /\bhead of supply chain\b/i,                         canonical: 'Head of Supply Chain',          tier: 3 },
  { regex: /\bhead of it\b|\bhead of technology\b/i,            canonical: 'Head of IT',                    tier: 3 },
  { regex: /\bhead of hr\b|\bhead of human resources\b/i,       canonical: 'Head of HR',                    tier: 3 },
  { regex: /\bhead of business development\b/i,                 canonical: 'Head of Business Development',  tier: 3 },
  { regex: /\bhead of\b/i,                                      canonical: 'Head of Department',            tier: 3 },
];

function recognizeTitle(text) {
  if (!text || text.length < 2 || text.length > 80) return null;
  for (const tp of MANAGEMENT_TITLE_PATTERNS) {
    if (tp.regex.test(text)) return tp.canonical;
  }
  return null;
}

// ============================================================
// USER AGENT ROTATION
// ============================================================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(min, max) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

const http = axios.create({
  timeout: CONFIG.REQUEST_TIMEOUT,
  maxRedirects: 3,
});

http.interceptors.request.use(config => {
  config.headers['User-Agent'] = randomUA();
  config.headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  config.headers['Accept-Language'] = 'en-GB,en-US;q=0.9,en;q=0.8';
  config.headers['Accept-Encoding'] = 'gzip, deflate';
  return config;
});

// ============================================================
// SEARCH ENGINE ROTATION
// ============================================================
let searchEngineIndex = 0;

async function webSearch(query) {
  const engines = [
    async (q) => {
      const r = await http.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
      return r.data;
    },
    async (q) => {
      const r = await http.get(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10&setmkt=en-GB&setlang=en`);
      return r.data;
    },
    async (q) => {
      const r = await http.get(`https://search.brave.com/search?q=${encodeURIComponent(q)}`);
      return r.data;
    },
    async (q) => {
      const r = await http.get(`https://www.ecosia.org/search?q=${encodeURIComponent(q)}`);
      return r.data;
    },
    async (q) => {
      const r = await http.get(`https://www.mojeek.com/search?q=${encodeURIComponent(q)}`);
      return r.data;
    },
  ];

  const startIdx = searchEngineIndex;
  for (let i = 0; i < engines.length; i++) {
    const idx = (startIdx + i) % engines.length;
    try {
      await randomDelay(400, 1200);
      const result = await engines[idx](query);
      searchEngineIndex = (idx + 1) % engines.length;
      return result;
    } catch (e) {
      // Try next engine on failure
    }
  }
  return null;
}

// ============================================================
// EXTRACT TEXT FROM SEARCH RESULT HTML
// Pulls title + snippet from multiple search engine formats
// ============================================================
function extractResultTexts(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const texts = [];

  // DuckDuckGo HTML format
  $('.result').each((_, el) => {
    const title = $(el).find('.result__a').text().trim();
    const snippet = $(el).find('.result__snippet, .result__body').text().trim();
    const combined = `${title} ${snippet}`.trim();
    if (combined.length > 15) texts.push(combined);
  });

  // Bing format
  $('li.b_algo').each((_, el) => {
    const title = $(el).find('h2 a').text().trim();
    const snippet = $(el).find('.b_caption p, .b_snippet').text().trim();
    const combined = `${title} ${snippet}`.trim();
    if (combined.length > 15) texts.push(combined);
  });

  // Brave Search format
  $('.snippet, [data-type="web"]').each((_, el) => {
    const title = $(el).find('.title, .snippet-title').text().trim();
    const snippet = $(el).find('.snippet-description, .body').text().trim();
    const combined = `${title} ${snippet}`.trim();
    if (combined.length > 15) texts.push(combined);
  });

  // Ecosia format
  $('a.result-title, .result').each((_, el) => {
    const title = $(el).find('h2, h3, .title').first().text().trim();
    const snippet = $(el).find('p, .description, .snippet').first().text().trim();
    const combined = `${title} ${snippet}`.trim();
    if (combined.length > 15) texts.push(combined);
  });

  // Mojeek format
  $('.results-standard .result, .ob-result').each((_, el) => {
    const title = $(el).find('h2, h3, .title').first().text().trim();
    const snippet = $(el).find('p, .s').first().text().trim();
    const combined = `${title} ${snippet}`.trim();
    if (combined.length > 15) texts.push(combined);
  });

  // Last-resort generic extraction if nothing matched above
  if (texts.length === 0) {
    $('h2, h3').each((_, el) => {
      const title = $(el).text().trim();
      const after = $(el).next('p, div').text().trim().substring(0, 300);
      if (title.length > 10) texts.push(`${title} ${after}`.trim());
    });
  }

  return texts.filter(t => t.length > 15).slice(0, 25);
}

// ============================================================
// EXTRACT CONTACTS FROM SEARCH RESULT TEXTS
// Finds name + title co-occurrences using multiple patterns
// ============================================================
function extractContactsFromTexts(texts, fallbackTitle) {
  const contacts = [];
  const seenNames = new Set();

  for (const text of texts) {

    // === Pattern 1: LinkedIn format "First [Middle] Last - Title at Company | LinkedIn" ===
    // e.g. "John Smith - CEO at Acme Ltd | LinkedIn"
    // e.g. "Jane Mary Doe – Managing Director at Acme Ltd"
    // Note: require firstName >= 3 chars to skip LinkedIn nav words like "In", "Log"
    const linkedInPat = /([A-Z][a-z]{2,15}(?:\s+[A-Z][a-z]{0,15})*)\s*[-–—|]\s*([A-Za-z\s&,./]+?)(?:\s+at\s+|\s+@\s+|\s*\||\s*LinkedIn)/g;
    let m;
    while ((m = linkedInPat.exec(text)) !== null) {
      const nameParts = m[1].trim().split(/\s+/);
      if (nameParts.length < 2) continue;
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];
      if (firstName === lastName) continue;

      if (!isValidPersonName(firstName, lastName)) continue;

      const rawTitle = m[2].trim();
      const title = recognizeTitle(rawTitle);
      if (!title) continue;

      const key = `${firstName} ${lastName}`.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      contacts.push({ firstName, lastName, jobTitle: title, confidence: 0.9 });
    }

    // === Pattern 2: "Name, Title" or "Name is Title" ===
    // e.g. "John Smith, Managing Director"
    // e.g. "John Smith is the CEO of Company"
    const nameTitlePat = /([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\s*,\s+([A-Za-z\s]+)/g;
    while ((m = nameTitlePat.exec(text)) !== null) {
      const firstName = m[1];
      const lastName = m[2];
      const rawTitle = m[3].trim();

      if (!isValidPersonName(firstName, lastName)) continue;
      const title = recognizeTitle(rawTitle);
      if (!title) continue;

      const key = `${firstName} ${lastName}`.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      contacts.push({ firstName, lastName, jobTitle: title, confidence: 0.85 });
    }

    // === Pattern 3: Title near name within 120-char window ===
    // Finds any management title then looks for a name nearby
    for (const tp of MANAGEMENT_TITLE_PATTERNS) {
      const titleRe = new RegExp(tp.regex.source, 'gi');
      let tm;
      while ((tm = titleRe.exec(text)) !== null) {
        const wStart = Math.max(0, tm.index - 120);
        const wEnd = Math.min(text.length, tm.index + tm[0].length + 120);
        const window = text.substring(wStart, wEnd);

        const namePat = /\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\b/g;
        let nm;
        let foundOne = false;
        while ((nm = namePat.exec(window)) !== null) {
          const firstName = nm[1];
          const lastName = nm[2];
          if (!isValidPersonName(firstName, lastName)) continue;

          const key = `${firstName} ${lastName}`.toLowerCase();
          if (seenNames.has(key)) continue;
          seenNames.add(key);
          contacts.push({ firstName, lastName, jobTitle: tp.canonical, confidence: 0.7 });
          foundOne = true;
          break; // One name per title occurrence
        }
        if (foundOne) break; // Move on to next title pattern
      }
    }
  }

  // === Fallback: if nothing found via title proximity, try any valid name with the template title ===
  if (contacts.length === 0 && fallbackTitle) {
    const allText = texts.join(' ');
    const namePat = /\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\b/g;
    let nm;
    let count = 0;
    while ((nm = namePat.exec(allText)) !== null && count < 2) {
      const firstName = nm[1];
      const lastName = nm[2];
      if (!isValidPersonName(firstName, lastName)) continue;
      const key = `${firstName} ${lastName}`.toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      contacts.push({ firstName, lastName, jobTitle: fallbackTitle, confidence: 0.4 });
      count++;
    }
  }

  // Sort by confidence (highest first)
  return contacts.sort((a, b) => b.confidence - a.confidence);
}

// ============================================================
// EMAIL FORMAT APPLICATION
// Generates work email from company's email format pattern
// ============================================================
function getDomain(website) {
  if (!website) return null;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  }
}

function generateEmail(emailFormat, domain, firstName, lastName) {
  if (!emailFormat || !domain) return null;
  if (!firstName || !lastName) return null;
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

    // If the format doesn't already include @domain, append it
    if (!email.includes('@')) {
      email = `${email}@${domain}`;
    }

    // Sanity check: looks like a valid email
    if (/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      return email;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// CLEAN COMPANY NAME FOR SEARCH QUERIES
// ============================================================
function cleanNameForSearch(companyName) {
  return companyName
    .replace(/\s*(ltd\.?|limited|llc|l\.l\.c|inc\.?|plc|corp\.?|corporation|co\.?\s*ltd|co\.|& co|company|group|holdings|services|solutions|uk|international)\s*$/gi, '')
    .replace(/['"\\]/g, '')
    .trim();
}

// ============================================================
// STATS
// ============================================================
let stats = {
  companies: 0,
  contacts: 0,
  withEmail: 0,
  emailsGenerated: 0,
  searches: 0,
  errors: 0,
  start: Date.now(),
};

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] [${AGENT_NAME}] ${msg}`);
}

function printStats() {
  const mins = Math.floor((Date.now() - stats.start) / 60000);
  log('');
  log('='.repeat(55));
  log(`STATS after ${mins} minutes:`);
  log(`  Companies scanned:  ${stats.companies}`);
  log(`  Contacts found:     ${stats.contacts}`);
  log(`  With email:         ${stats.withEmail} (${stats.emailsGenerated} auto-generated)`);
  log(`  Search queries run: ${stats.searches}`);
  log(`  Errors:             ${stats.errors}`);
  log('='.repeat(55));
  log('');
}

// ============================================================
// PROCESS ONE COMPANY
// ============================================================
async function processCompany(company) {
  const cleanName = cleanNameForSearch(company.company_name);
  if (!cleanName || cleanName.length < 3) return 0;

  const domain = getDomain(company.website);
  const allContacts = [];
  const seenNames = new Set();

  // Pick search templates: take up to MAX_QUERIES, ordered by tier (best first)
  const sorted = [...SEARCH_TEMPLATES].sort((a, b) => a.tier - b.tier);
  const selected = sorted.slice(0, CONFIG.MAX_QUERIES);

  for (const template of selected) {
    if (allContacts.length >= CONFIG.MAX_CONTACTS) break;

    // Build query: replace {name} placeholder with quoted company name
    const query = template.query.replace(/\{name\}/g, `"${cleanName}"`);

    try {
      await randomDelay(CONFIG.SEARCH_DELAY_MIN, CONFIG.SEARCH_DELAY_MAX);
      const html = await webSearch(query);
      stats.searches++;

      if (!html) continue;

      const texts = extractResultTexts(html);
      if (texts.length === 0) continue;

      const found = extractContactsFromTexts(texts, template.extractTitle);

      for (const contact of found) {
        const key = `${contact.firstName} ${contact.lastName}`.toLowerCase();
        if (seenNames.has(key)) continue;
        seenNames.add(key);

        // Apply company email format to generate work email
        if (!contact.email && company.email_format && domain) {
          const generated = generateEmail(company.email_format, domain, contact.firstName, contact.lastName);
          if (generated) {
            contact.email = generated;
            contact.emailGenerated = true;
          }
        }

        allContacts.push(contact);
        if (allContacts.length >= CONFIG.MAX_CONTACTS) break;
      }
    } catch (e) {
      stats.errors++;
      // Don't stop - continue with next template
    }
  }

  if (allContacts.length === 0) return 0;

  // Save contacts to database, linked to this company
  let saved = 0;
  for (const contact of allContacts.slice(0, CONFIG.MAX_CONTACTS)) {
    try {
      // Final validation before insert
      if (!isValidPersonName(contact.firstName, contact.lastName)) continue;
      if (contact.jobTitle && !isValidJobTitle(contact.jobTitle)) continue;

      // Check for duplicates (same person at same company)
      const exists = await pool.query(
        `SELECT 1 FROM contacts
         WHERE linked_account_id = $1
           AND LOWER(first_name) = LOWER($2)
           AND LOWER(last_name)  = LOWER($3)
         LIMIT 1`,
        [company.account_id, contact.firstName, contact.lastName]
      );

      if (exists.rows.length === 0) {
        await pool.query(`
          INSERT INTO contacts
            (linked_account_id, first_name, last_name, email, phone_number, job_title, data_source, created_at)
          VALUES ($1, $2, $3, $4, NULL, $5, 'Agent:SearchContact', NOW())
        `, [
          company.account_id,
          contact.firstName,
          contact.lastName,
          contact.email || null,
          contact.jobTitle || null,
        ]);

        saved++;
        stats.contacts++;
        if (contact.email) {
          stats.withEmail++;
          if (contact.emailGenerated) stats.emailsGenerated++;
        }
      }
    } catch (e) {
      stats.errors++;
    }
  }

  if (saved > 0) {
    log(`  + ${company.company_name}: ${saved} contacts (${allContacts.map(c => c.jobTitle).join(', ')})`);
  }

  return saved;
}

// ============================================================
// GET COMPANIES TO PROCESS
// Prioritise companies with more existing data (more searchable)
// Skip companies that already have search-based contacts
// ============================================================
async function getCompaniesToProcess() {
  const result = await pool.query(`
    SELECT
      a.account_id,
      a.company_name,
      a.website,
      a.email_format,
      a.city,
      a.country,
      a.linkedin_url
    FROM accounts a
    WHERE
      a.company_name IS NOT NULL
      AND LENGTH(TRIM(a.company_name)) >= 3
      AND NOT EXISTS (
        SELECT 1 FROM contacts c
        WHERE c.linked_account_id = a.account_id
          AND c.data_source = 'Agent:SearchContact'
      )
    ORDER BY
      -- Prefer companies with more data (website + email format = great)
      (CASE WHEN a.website      IS NOT NULL AND a.website      != '' THEN 3 ELSE 0 END +
       CASE WHEN a.email_format IS NOT NULL AND a.email_format != '' THEN 4 ELSE 0 END +
       CASE WHEN a.linkedin_url IS NOT NULL AND a.linkedin_url != '' THEN 2 ELSE 0 END +
       CASE WHEN a.phone_number IS NOT NULL AND a.phone_number != '' THEN 1 ELSE 0 END) DESC,
      RANDOM()
    LIMIT $1
  `, [CONFIG.BATCH_SIZE]);

  return result.rows;
}

// ============================================================
// MAIN LOOP
// ============================================================
async function run() {
  console.log('\n' + '='.repeat(62));
  console.log(`   AGENT: ${AGENT_NAME}`);
  console.log('='.repeat(62));
  console.log('   Discovers contacts via targeted web + LinkedIn searches');
  console.log('   Search patterns:');
  console.log('     site:linkedin.com/in "Company" CEO/Director/Manager');
  console.log('     "Company" "Managing Director" OR MD');
  console.log('     "directors of Company"');
  console.log('     "Company" "Sales Manager" / "Logistics Manager"');
  console.log('   Applies company email format to generate work emails');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    log(`Batch ${batch}: Loading companies...`);

    try {
      const companies = await getCompaniesToProcess();

      if (companies.length === 0) {
        log('No more companies to search. Waiting 15 minutes...');
        await new Promise(r => setTimeout(r, 15 * 60 * 1000));
        continue;
      }

      log(`Processing ${companies.length} companies (${CONFIG.PARALLEL} parallel)...`);

      for (let i = 0; i < companies.length; i += CONFIG.PARALLEL) {
        const chunk = companies.slice(i, i + CONFIG.PARALLEL);
        await Promise.all(chunk.map(c => processCompany(c)));
        stats.companies += chunk.length;
      }

      if (batch % 3 === 0) printStats();

      await new Promise(r => setTimeout(r, CONFIG.DELAY));

    } catch (e) {
      log(`Batch error: ${e.message}`);
      stats.errors++;
      await new Promise(r => setTimeout(r, 20000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n');
  printStats();
  process.exit(0);
});

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
