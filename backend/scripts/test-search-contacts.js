#!/usr/bin/env node

/**
 * TEST: Search-Based Contact Finder
 *
 * Tests the search pattern logic with a known company name.
 * Does NOT require a database connection - runs standalone.
 *
 * Usage:
 *   node scripts/test-search-contacts.js "Company Name"
 *   node scripts/test-search-contacts.js "Tesco"
 *   node scripts/test-search-contacts.js "Rolls-Royce"
 *
 * What it tests:
 *   1. Search query generation for a given company name
 *   2. Live web searches via DuckDuckGo / Bing
 *   3. Name + title extraction from search result snippets
 *   4. Email format application (using a demo format)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const cheerio = require('cheerio');
// Use the real name validator (5000+ name DB, no DB connection needed)
const { isValidPersonName } = require('../src/services/nameVerifier');

// Inline the key logic so this test is self-contained
// (same as agent-search-contacts.js but without DB writes)

// ============================================================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
];
function randomUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }
function randomDelay(min, max) { return new Promise(r => setTimeout(r, min + Math.random() * (max - min))); }

const http = axios.create({ timeout: 15000, maxRedirects: 3 });
http.interceptors.request.use(config => {
  config.headers['User-Agent'] = randomUA();
  config.headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  config.headers['Accept-Language'] = 'en-GB,en-US;q=0.9,en;q=0.8';
  return config;
});

let searchEngineIndex = 0;
async function webSearch(query) {
  const engines = [
    async (q) => (await http.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`)).data,
    async (q) => (await http.get(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10&setmkt=en-GB&setlang=en`)).data,
    async (q) => (await http.get(`https://search.brave.com/search?q=${encodeURIComponent(q)}`)).data,
  ];
  const startIdx = searchEngineIndex;
  for (let i = 0; i < engines.length; i++) {
    const idx = (startIdx + i) % engines.length;
    try {
      await randomDelay(300, 800);
      const result = await engines[idx](query);
      searchEngineIndex = (idx + 1) % engines.length;
      return result;
    } catch (e) { /* try next */ }
  }
  return null;
}

function extractResultTexts(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const texts = [];

  $('.result').each((_, el) => {
    const t = $(el).find('.result__a').text().trim();
    const s = $(el).find('.result__snippet, .result__body').text().trim();
    if (t || s) texts.push(`${t} ${s}`.trim());
  });
  $('li.b_algo').each((_, el) => {
    const t = $(el).find('h2 a').text().trim();
    const s = $(el).find('.b_caption p').text().trim();
    if (t || s) texts.push(`${t} ${s}`.trim());
  });
  $('.snippet, [data-type="web"]').each((_, el) => {
    const t = $(el).find('.title, .snippet-title').text().trim();
    const s = $(el).find('.snippet-description, .body').text().trim();
    if (t || s) texts.push(`${t} ${s}`.trim());
  });
  if (texts.length === 0) {
    $('h2, h3').each((_, el) => {
      const t = $(el).text().trim();
      const a = $(el).next('p, div').text().trim().substring(0, 200);
      if (t.length > 10) texts.push(`${t} ${a}`.trim());
    });
  }
  return texts.filter(t => t.length > 15).slice(0, 25);
}

// Use the real nameVerifier (same as the agent uses)
function simpleValidateName(firstName, lastName) {
  return isValidPersonName(firstName, lastName);
}

const TITLE_PATTERNS = [
  { regex: /\bchief executive officer\b|\bceo\b/i,     canonical: 'CEO' },
  { regex: /\bchief financial officer\b|\bcfo\b/i,     canonical: 'CFO' },
  { regex: /\bchief technology officer\b|\bcto\b/i,    canonical: 'CTO' },
  { regex: /\bchief operating officer\b|\bcoo\b/i,     canonical: 'COO' },
  { regex: /\bco-?founder\b/i,                         canonical: 'Co-Founder' },
  { regex: /\bfounder\b/i,                             canonical: 'Founder' },
  { regex: /\bowner\b/i,                               canonical: 'Owner' },
  { regex: /\bpresident\b/i,                           canonical: 'President' },
  { regex: /\bmanaging director\b/i,                   canonical: 'Managing Director' },
  { regex: /\bexecutive director\b/i,                  canonical: 'Executive Director' },
  { regex: /\bsales director\b/i,                      canonical: 'Sales Director' },
  { regex: /\boperations director\b/i,                 canonical: 'Operations Director' },
  { regex: /\bcommercial director\b/i,                 canonical: 'Commercial Director' },
  { regex: /\bfinance director\b/i,                    canonical: 'Finance Director' },
  { regex: /\bdirector\b/i,                            canonical: 'Director' },
  { regex: /\bvice president\b|\bvp\b/i,               canonical: 'Vice President' },
  { regex: /\bmanaging partner\b/i,                    canonical: 'Managing Partner' },
  { regex: /\bpartner\b/i,                             canonical: 'Partner' },
  { regex: /\bgeneral manager\b/i,                     canonical: 'General Manager' },
  { regex: /\bsales manager\b/i,                       canonical: 'Sales Manager' },
  { regex: /\boperations manager\b/i,                  canonical: 'Operations Manager' },
  { regex: /\blogistics manager\b/i,                   canonical: 'Logistics Manager' },
  { regex: /\bsupply chain manager\b/i,                canonical: 'Supply Chain Manager' },
  { regex: /\bfinance manager\b/i,                     canonical: 'Finance Manager' },
  { regex: /\bmarketing manager\b/i,                   canonical: 'Marketing Manager' },
  { regex: /\bbusiness development manager\b/i,        canonical: 'Business Development Manager' },
  { regex: /\bhead of\b/i,                             canonical: 'Head of Department' },
];

function recognizeTitle(text) {
  for (const tp of TITLE_PATTERNS) {
    if (tp.regex.test(text)) return tp.canonical;
  }
  return null;
}

function extractContactsFromTexts(texts) {
  const contacts = [];
  const seenNames = new Set();

  for (const text of texts) {
    // Pattern 1: LinkedIn style "First Last - Title at Company"
    const liPat = /([A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{0,15})*)\s*[-–—|]\s*([A-Za-z\s&,./]+?)(?:\s+at\s+|\s+@\s+|\s*\||\s*LinkedIn)/g;
    let m;
    while ((m = liPat.exec(text)) !== null) {
      const nameParts = m[1].trim().split(/\s+/);
      if (nameParts.length < 2) continue;
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];
      if (!simpleValidateName(firstName, lastName)) continue;
      const title = recognizeTitle(m[2].trim());
      if (!title) continue;
      const key = `${firstName} ${lastName}`.toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        contacts.push({ firstName, lastName, jobTitle: title, source: 'linkedin-pattern' });
      }
    }

    // Pattern 2: "Name, Title"
    const ntPat = /([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\s*[,–-]\s*([A-Za-z\s]{5,50})/g;
    while ((m = ntPat.exec(text)) !== null) {
      const firstName = m[1], lastName = m[2];
      if (!simpleValidateName(firstName, lastName)) continue;
      const title = recognizeTitle(m[3].trim());
      if (!title) continue;
      const key = `${firstName} ${lastName}`.toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        contacts.push({ firstName, lastName, jobTitle: title, source: 'name-title-pattern' });
      }
    }

    // Pattern 3: Title proximity
    for (const tp of TITLE_PATTERNS) {
      const re = new RegExp(tp.regex.source, 'gi');
      let tm;
      while ((tm = re.exec(text)) !== null) {
        const wStart = Math.max(0, tm.index - 120);
        const wEnd = Math.min(text.length, tm.index + tm[0].length + 120);
        const window = text.substring(wStart, wEnd);
        const namePat = /\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20})\b/g;
        let nm;
        let found = false;
        while ((nm = namePat.exec(window)) !== null) {
          const firstName = nm[1], lastName = nm[2];
          if (!simpleValidateName(firstName, lastName)) continue;
          const key = `${firstName} ${lastName}`.toLowerCase();
          if (!seenNames.has(key)) {
            seenNames.add(key);
            contacts.push({ firstName, lastName, jobTitle: tp.canonical, source: 'proximity' });
            found = true;
          }
          if (found) break;
        }
        if (found) break;
      }
    }
  }

  return contacts;
}

function cleanNameForSearch(name) {
  return name
    .replace(/\s*(ltd\.?|limited|llc|inc\.?|plc|corp\.?|corporation|co\.|& co|company|group|holdings)\s*$/gi, '')
    .replace(/['"\\]/g, '')
    .trim();
}

function generateEmail(emailFormat, domain, firstName, lastName) {
  if (!emailFormat || !domain) return null;
  const f = firstName.toLowerCase();
  const l = lastName.toLowerCase();
  let email = emailFormat
    .replace(/\{first\.last\}/g, `${f}.${l}`)
    .replace(/\{f\.last\}/g,    `${f[0]}.${l}`)
    .replace(/\{first_last\}/g, `${f}_${l}`)
    .replace(/\{first\}/g,      f)
    .replace(/\{last\}/g,       l)
    .replace(/\{f\}/g,          f[0])
    .replace(/\{l\}/g,          l[0]);
  if (!email.includes('@')) email += `@${domain}`;
  return email;
}

// ============================================================
// TEST QUERIES - run a subset of templates
// ============================================================
const TEST_QUERIES = [
  { query: 'site:linkedin.com/in {name} CEO',                 label: 'LinkedIn CEO' },
  { query: 'site:linkedin.com/in {name} "Managing Director"', label: 'LinkedIn MD' },
  { query: 'site:linkedin.com/in {name} Director',            label: 'LinkedIn Director' },
  { query: '{name} CEO founder owner',                         label: 'CEO/Founder' },
  { query: '{name} "Managing Director" OR MD',                 label: 'Managing Director' },
  { query: '"directors of {name}"',                            label: 'Directors of' },
  { query: '{name} "Sales Manager" OR "Sales Director"',       label: 'Sales' },
  { query: '{name} "Logistics Manager" OR "Operations Manager"', label: 'Operations/Logistics' },
];

// ============================================================
// MAIN TEST
// ============================================================
async function runTest(companyName) {
  const cleanName = cleanNameForSearch(companyName);

  console.log('\n' + '='.repeat(65));
  console.log(`  SEARCH CONTACT TEST`);
  console.log('='.repeat(65));
  console.log(`  Company:       ${companyName}`);
  console.log(`  Cleaned name:  ${cleanName}`);
  console.log(`  Demo domain:   ${cleanName.toLowerCase().replace(/\s+/g, '')}.co.uk`);
  console.log(`  Demo format:   {f}.{last}`);
  console.log('='.repeat(65) + '\n');

  const demoDomain = `${cleanName.toLowerCase().replace(/\s+/g, '')}.co.uk`;
  const demoEmailFormat = '{f}.{last}';

  const allContacts = [];
  const seenNames = new Set();

  for (const template of TEST_QUERIES) {
    const query = template.query.replace(/\{name\}/g, `"${cleanName}"`);
    process.stdout.write(`  [${template.label.padEnd(24)}] Searching... `);

    try {
      await randomDelay(2000, 4000);
      const html = await webSearch(query);

      if (!html) {
        console.log('No response');
        continue;
      }

      const texts = extractResultTexts(html);
      const found = extractContactsFromTexts(texts);

      // Deduplicate across queries
      const newFound = found.filter(c => {
        const key = `${c.firstName} ${c.lastName}`.toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });

      if (newFound.length === 0) {
        console.log(`0 contacts (${texts.length} snippets parsed)`);
      } else {
        console.log(`${newFound.length} contacts found`);
        for (const c of newFound) {
          const email = generateEmail(demoEmailFormat, demoDomain, c.firstName, c.lastName);
          allContacts.push({ ...c, email });
          console.log(`    ✓ ${c.firstName} ${c.lastName} — ${c.jobTitle}`);
          if (email) console.log(`      Email (generated): ${email}`);
        }
      }
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }

  console.log('\n' + '='.repeat(65));
  console.log(`  SUMMARY: ${allContacts.length} unique contacts found for "${companyName}"`);
  if (allContacts.length > 0) {
    console.log('\n  Full list:');
    allContacts.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.firstName} ${c.lastName}`);
      console.log(`     Title:  ${c.jobTitle}`);
      if (c.email) console.log(`     Email:  ${c.email}`);
      console.log(`     Source: ${c.source}`);
    });
  }
  console.log('='.repeat(65) + '\n');

  if (allContacts.length === 0) {
    console.log('  HINT: No contacts found. This can happen because:');
    console.log('    - Search engines rate-limited (try again in a minute)');
    console.log('    - Company name too generic (add location/country)');
    console.log('    - Company has low public web presence');
    console.log('    - Try a larger/more well-known company name\n');
  }
}

// ============================================================
// ENTRY POINT
// ============================================================
const companyArg = process.argv.slice(2).join(' ') || 'Tesco';
runTest(companyArg).catch(e => {
  console.error('Test failed:', e.message);
  process.exit(1);
});
