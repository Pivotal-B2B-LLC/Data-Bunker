#!/usr/bin/env node

/**
 * CONTACT DISCOVERY v3 - Structured HTML Extraction
 *
 * Instead of scanning raw text with regex (which matches ANY two capitalized words),
 * this version uses structured HTML parsing:
 *
 * 1. Looks for team/staff/people sections on websites
 * 2. Finds individual person CARDS (divs with name + title elements)
 * 3. Extracts name from heading elements (h2, h3, h4, strong, span.name)
 * 4. Extracts job title from nearby sibling elements (p, span.title, span.role)
 * 5. Validates: name must be 2-3 short words, first name in known-names DB
 * 6. Only saves contacts with valid management-level job titles
 *
 * The DB trigger also enforces job title validation as a safety net.
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');
const { isValidPersonName, getCacheStats, loadCache } = require('../src/services/nameVerifier');

const PARALLEL = 5;
const BATCH_SIZE = 25;
const TIMEOUT = 8000;
const MAX_CONTACTS_PER_COMPANY = 7;

// Management-level titles ONLY
const MANAGEMENT_KEYWORDS = [
  'director', 'managing director', 'executive director',
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio',
  'chief executive', 'chief technology', 'chief financial', 'chief operating',
  'president', 'vice president', 'vp', 'svp', 'evp',
  'owner', 'co-owner', 'founder', 'co-founder',
  'partner', 'managing partner', 'senior partner',
  'principal', 'head of', 'general manager',
  'chairman', 'chairwoman', 'chairperson'
];

// Generic emails to skip
const GENERIC_PREFIXES = new Set([
  'info', 'contact', 'hello', 'enquiries', 'admin', 'sales', 'support',
  'help', 'office', 'reception', 'mail', 'customer', 'service', 'bookings',
  'orders', 'accounts', 'hr', 'jobs', 'careers', 'marketing', 'press',
  'team', 'general', 'feedback', 'noreply', 'newsletter', 'billing',
  'enquiry', 'webmaster', 'postmaster'
]);

// Words that CANNOT be part of a person's name
const NAME_BLACKLIST = new Set([
  'about', 'account', 'address', 'annual', 'area', 'article', 'available',
  'balance', 'beer', 'board', 'book', 'business', 'call', 'canopy', 'career',
  'chair', 'chief', 'click', 'close', 'club', 'company', 'connect', 'contact',
  'corporate', 'course', 'current', 'data', 'design', 'digital', 'discover',
  'download', 'email', 'enterprise', 'event', 'executive', 'explore', 'factory',
  'film', 'financial', 'folk', 'footer', 'free', 'general', 'global', 'grand',
  'granada', 'group', 'guide', 'header', 'health', 'home', 'hotel', 'hours',
  'human', 'industry', 'information', 'international', 'island', 'learn', 'legal',
  'limited', 'list', 'live', 'login', 'managing', 'market', 'media', 'meeting',
  'menu', 'mission', 'mobile', 'more', 'national', 'network', 'new', 'news',
  'notice', 'office', 'online', 'open', 'opening', 'operations', 'order', 'our',
  'page', 'partner', 'people', 'pizza', 'place', 'plan', 'platform', 'policy',
  'press', 'private', 'product', 'profile', 'project', 'public', 'queer', 'read',
  'real', 'regional', 'report', 'resource', 'restaurant', 'review', 'road',
  'room', 'sales', 'search', 'senior', 'service', 'share', 'show', 'sign',
  'site', 'social', 'solution', 'special', 'staff', 'stone', 'store', 'studio',
  'studios', 'submit', 'suite', 'support', 'system', 'team', 'technical',
  'terms', 'the', 'title', 'today', 'tour', 'trade', 'training', 'united',
  'view', 'visit', 'web', 'website', 'welcome', 'whisky', 'wine', 'work',
  'world', 'your'
]);

let stats = { processed: 0, contacts: 0, errors: 0, skippedName: 0, skippedTitle: 0, start: Date.now() };

const http = axios.create({
  timeout: TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 2
});

/**
 * Check if a string looks like a real person name (2-3 words, each 2-15 chars)
 * Returns { firstName, lastName } or null
 */
function parsePersonName(text) {
  if (!text) return null;

  // Clean: remove titles, qualifications, punctuation
  let cleaned = text
    .replace(/\b(mr|mrs|ms|miss|dr|prof|sir|dame|lord|lady|rev)\b\.?\s*/gi, '')
    .replace(/\b(phd|mba|md|llb|llm|ba|bsc|ma|msc|fca|aca|frcs|obe|mbe|cbe|dbe)\b\.?\s*/gi, '')
    .replace(/[^\w\s'-]/g, '')
    .trim();

  // Split into words
  const words = cleaned.split(/\s+/).filter(w => w.length >= 2);

  // Must be exactly 2 or 3 words
  if (words.length < 2 || words.length > 3) return null;

  // Each word must be 2-15 characters and start with a letter
  for (const word of words) {
    if (word.length < 2 || word.length > 15) return null;
    if (!/^[a-zA-Z]/.test(word)) return null;
    // Must not be all uppercase (likely an acronym)
    if (word === word.toUpperCase() && word.length > 2) return null;
  }

  const firstName = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  const lastName = words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  // Check blacklist for each word
  for (const word of words) {
    if (NAME_BLACKLIST.has(word.toLowerCase())) return null;
  }

  // Validate first name is a known person name
  if (!isValidPersonName(firstName, lastName)) return null;

  return { firstName, lastName };
}

/**
 * Check if a job title string is management level
 */
function isManagementTitle(title) {
  if (!title) return false;
  const lower = title.toLowerCase().trim();
  if (lower.length < 3 || lower.length > 80) return false;

  for (const keyword of MANAGEMENT_KEYWORDS) {
    if (lower.includes(keyword)) return true;
  }
  return false;
}

/**
 * Clean a job title: remove extra whitespace, limit length
 */
function cleanJobTitle(text) {
  if (!text) return null;

  let title = text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s,&/()-]/g, '')
    .trim();

  // Title should be 3-80 chars
  if (title.length < 3 || title.length > 80) return null;

  // Title should not be more than 8 words (it's probably scraped junk)
  if (title.split(/\s+/).length > 8) return null;

  // Title case it
  title = title.split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return title;
}

/**
 * Check if email looks personal (not generic)
 */
function isPersonalEmail(email) {
  if (!email) return false;
  const local = email.split('@')[0].toLowerCase();
  if (/^\d/.test(local)) return false;
  for (const prefix of GENERIC_PREFIXES) {
    if (local === prefix || local.startsWith(prefix + '.') || local.startsWith(prefix + '_')) return false;
  }
  return true;
}

/**
 * Get company domain from URL
 */
function getDomain(url) {
  if (!url) return null;
  try {
    return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  } catch { return null; }
}

/**
 * STRATEGY 1: Extract from structured team member cards
 * Looks for common HTML patterns used on team/staff pages
 */
function extractFromStructuredCards($, domain) {
  const contacts = [];
  const seenNames = new Set();

  // Common card selectors for team members
  const cardSelectors = [
    '.team-member', '.staff-member', '.person', '.member',
    '.team-card', '.staff-card', '.person-card', '.member-card',
    '[class*="team-member"]', '[class*="staff-member"]',
    '[class*="team_member"]', '[class*="staff_member"]',
    '.team .card', '.staff .card', '.people .card',
    '[class*="director"]', '[class*="partner"]',
    '.profile-card', '.employee-card',
    '[itemtype*="Person"]',
  ];

  // Name selectors within a card (ordered by specificity)
  const nameSelectors = [
    '[itemprop="name"]',
    '.name', '.person-name', '.member-name', '.team-name',
    'h2', 'h3', 'h4', 'h5',
    'strong', 'b',
    '.title:first-child', // sometimes name is in .title class
  ];

  // Title selectors within a card
  const titleSelectors = [
    '[itemprop="jobTitle"]',
    '.job-title', '.jobtitle', '.role', '.position', '.designation',
    '.member-role', '.member-title', '.person-role', '.person-title',
    '.team-role', '.team-title', '.staff-role', '.staff-title',
    'p.title', 'span.title',
    'p:nth-child(2)', // second paragraph is often the title
    'p', 'span',
  ];

  for (const cardSelector of cardSelectors) {
    $(cardSelector).each((i, el) => {
      if (contacts.length >= 20) return false;

      const $card = $(el);
      const cardText = $card.text().trim();

      // Skip cards with too much text (likely not a person card)
      if (cardText.length > 500) return;

      // Try to find name
      let name = null;
      for (const nameSelector of nameSelectors) {
        const $name = $card.find(nameSelector).first();
        if ($name.length) {
          const text = $name.text().trim();
          if (text.length >= 4 && text.length <= 40) {
            name = parsePersonName(text);
            if (name) break;
          }
        }
      }

      if (!name) return;

      const nameKey = `${name.firstName} ${name.lastName}`.toLowerCase();
      if (seenNames.has(nameKey)) return;
      seenNames.add(nameKey);

      // Try to find job title
      let jobTitle = null;
      for (const titleSelector of titleSelectors) {
        const $titles = $card.find(titleSelector);
        $titles.each((j, titleEl) => {
          if (jobTitle) return false;
          const text = $(titleEl).text().trim();
          // Skip if this is the name element itself
          if (text === `${name.firstName} ${name.lastName}`) return;
          const cleaned = cleanJobTitle(text);
          if (cleaned && isManagementTitle(cleaned)) {
            jobTitle = cleaned;
            return false;
          }
        });
        if (jobTitle) break;
      }

      if (!jobTitle) return; // MUST have a management title

      // Try to find email
      let email = null;
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
      const cardEmails = cardText.match(emailRegex) || [];
      // Also check mailto links
      $card.find('a[href^="mailto:"]').each((j, a) => {
        const href = $(a).attr('href');
        const match = href.match(/mailto:([^?]+)/);
        if (match) cardEmails.push(match[1]);
      });

      for (const e of cardEmails) {
        if (isPersonalEmail(e.toLowerCase())) {
          email = e.toLowerCase();
          break;
        }
      }

      // Try to find phone
      let phone = null;
      const phoneMatch = cardText.match(/(?:\+44|0044|0)[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/);
      if (phoneMatch) {
        const cleaned = phoneMatch[0].replace(/[\s.-]/g, '').replace(/^\+?44/, '0');
        if (cleaned.length >= 10 && cleaned.length <= 12) phone = cleaned;
      }

      contacts.push({ firstName: name.firstName, lastName: name.lastName, email, phone, jobTitle });
    });
  }

  return contacts;
}

/**
 * STRATEGY 2: Look for name + title patterns in specific page sections
 * For pages without structured cards but with "Our Team" or similar sections
 */
function extractFromSections($, domain) {
  const contacts = [];
  const seenNames = new Set();

  // Find sections that are likely about team/staff
  const sectionSelectors = [
    '#team', '#our-team', '#staff', '#people', '#leadership', '#directors',
    '#management', '#meet-the-team', '#about-us',
    '.team', '.our-team', '.staff', '.people', '.leadership', '.directors',
    '.management', '.meet-the-team',
    'section[class*="team"]', 'section[class*="staff"]', 'section[class*="people"]',
    'div[class*="team"]', 'div[class*="staff"]', 'div[class*="people"]',
  ];

  for (const sectionSelector of sectionSelectors) {
    $(sectionSelector).each((i, section) => {
      if (contacts.length >= 20) return false;

      const $section = $(section);

      // Look for headings followed by paragraphs (name + title pattern)
      $section.find('h2, h3, h4, h5').each((j, heading) => {
        if (contacts.length >= 20) return false;

        const $heading = $(heading);
        const headingText = $heading.text().trim();

        // Try to parse heading as a name
        const name = parsePersonName(headingText);
        if (!name) return;

        const nameKey = `${name.firstName} ${name.lastName}`.toLowerCase();
        if (seenNames.has(nameKey)) return;

        // Look for job title in the next sibling element(s)
        let jobTitle = null;
        const $next = $heading.next();
        if ($next.length) {
          const nextText = $next.text().trim();
          const cleaned = cleanJobTitle(nextText);
          if (cleaned && isManagementTitle(cleaned)) {
            jobTitle = cleaned;
          }
        }

        // Also check parent's text for a title near the name
        if (!jobTitle) {
          const $parent = $heading.parent();
          const parentText = $parent.text().trim();
          // Only if parent is small (a card, not the whole section)
          if (parentText.length < 300) {
            // Look for title patterns
            for (const keyword of MANAGEMENT_KEYWORDS) {
              const idx = parentText.toLowerCase().indexOf(keyword);
              if (idx !== -1) {
                // Extract the title phrase around the keyword
                const start = Math.max(0, parentText.lastIndexOf(' ', Math.max(0, idx - 20)));
                const end = Math.min(parentText.length, parentText.indexOf(' ', idx + keyword.length + 15) || parentText.length);
                const candidate = parentText.substring(start, end).trim();
                const cleaned = cleanJobTitle(candidate);
                if (cleaned && isManagementTitle(cleaned)) {
                  jobTitle = cleaned;
                  break;
                }
              }
            }
          }
        }

        if (!jobTitle) return; // MUST have management title

        seenNames.add(nameKey);

        // Look for email near this person
        let email = null;
        const $container = $heading.parent();
        const containerText = $container.text();
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
        const emails = containerText.match(emailRegex) || [];
        $container.find('a[href^="mailto:"]').each((k, a) => {
          const href = $(a).attr('href');
          const match = href.match(/mailto:([^?]+)/);
          if (match) emails.push(match[1]);
        });
        for (const e of emails) {
          if (isPersonalEmail(e.toLowerCase())) {
            email = e.toLowerCase();
            break;
          }
        }

        contacts.push({ firstName: name.firstName, lastName: name.lastName, email, phone: null, jobTitle });
      });
    });
  }

  return contacts;
}

/**
 * STRATEGY 3: Look for mailto links with personal names
 */
function extractFromMailtoLinks($, domain) {
  const contacts = [];
  const seenNames = new Set();

  $('a[href^="mailto:"]').each((i, el) => {
    if (contacts.length >= 10) return false;

    const $el = $(el);
    const href = $el.attr('href') || '';
    const emailMatch = href.match(/mailto:([^?]+)/);
    if (!emailMatch) return;

    const email = emailMatch[1].toLowerCase();
    if (!isPersonalEmail(email)) return;

    // Check the link text or nearby elements for a name
    const linkText = $el.text().trim();
    let name = parsePersonName(linkText);

    // If link text isn't a name, check parent container (small area only)
    if (!name) {
      const $parent = $el.parent();
      const parentText = $parent.text().trim();
      if (parentText.length < 200) {
        // Try to find a name pattern in the parent
        const nameMatch = parentText.match(/^([A-Z][a-z]{1,14})\s+([A-Z][a-z]{1,14})/);
        if (nameMatch) {
          name = parsePersonName(nameMatch[0]);
        }
      }
    }

    if (!name) return;

    const nameKey = `${name.firstName} ${name.lastName}`.toLowerCase();
    if (seenNames.has(nameKey)) return;

    // Find job title in surrounding context
    let jobTitle = null;
    const $container = $el.closest('div, li, td, article, section');
    if ($container.length) {
      const containerText = $container.text().trim();
      if (containerText.length < 400) {
        for (const keyword of MANAGEMENT_KEYWORDS) {
          if (containerText.toLowerCase().includes(keyword)) {
            // Extract a clean title phrase
            const lower = containerText.toLowerCase();
            const idx = lower.indexOf(keyword);
            const start = Math.max(0, lower.lastIndexOf('\n', idx) || 0, lower.lastIndexOf(',', idx) || 0);
            const end = Math.min(containerText.length, (lower.indexOf('\n', idx + keyword.length) || containerText.length), (lower.indexOf(',', idx + keyword.length) || containerText.length));
            const candidate = containerText.substring(start, end).trim();
            const cleaned = cleanJobTitle(candidate);
            if (cleaned && isManagementTitle(cleaned)) {
              jobTitle = cleaned;
              break;
            }
          }
        }
      }
    }

    if (!jobTitle) return;

    seenNames.add(nameKey);
    contacts.push({ firstName: name.firstName, lastName: name.lastName, email, phone: null, jobTitle });
  });

  return contacts;
}

/**
 * Main extraction: try all strategies on a page
 */
function extractContacts(html, domain) {
  const $ = cheerio.load(html);
  const allContacts = [];
  const seenNames = new Set();

  function addContacts(list) {
    for (const c of list) {
      const key = `${c.firstName} ${c.lastName}`.toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        allContacts.push(c);
      }
    }
  }

  // Strategy 1: Structured cards (highest quality)
  addContacts(extractFromStructuredCards($, domain));

  // Strategy 2: Section-based extraction
  addContacts(extractFromSections($, domain));

  // Strategy 3: Mailto links
  addContacts(extractFromMailtoLinks($, domain));

  return allContacts.slice(0, MAX_CONTACTS_PER_COMPANY);
}

/**
 * Scrape company website for contacts
 */
async function scrapeContacts(website) {
  if (!website) return [];

  const domain = getDomain(website);
  const base = website.replace(/\/$/, '');

  // Pages most likely to have team info
  const pages = [
    `${base}/team`, `${base}/about`, `${base}/about-us`,
    `${base}/our-team`, `${base}/people`, `${base}/meet-the-team`,
    `${base}/leadership`, `${base}/directors`, `${base}/management`,
    `${base}/who-we-are`, `${base}/staff`, base
  ];

  const allContacts = [];
  const seenNames = new Set();

  // Fetch first 5 pages in parallel
  const results = await Promise.allSettled(
    pages.slice(0, 5).map(url => http.get(url).catch(() => null))
  );

  for (const res of results) {
    if (res.status !== 'fulfilled' || !res.value?.data) continue;
    if (typeof res.value.data !== 'string') continue;

    const found = extractContacts(res.value.data, domain);

    for (const c of found) {
      const key = `${c.firstName} ${c.lastName}`.toLowerCase();
      if (!seenNames.has(key)) {
        seenNames.add(key);
        allContacts.push(c);
      }
    }

    if (allContacts.length >= MAX_CONTACTS_PER_COMPANY) break;
  }

  // If we found nothing from first batch, try remaining pages
  if (allContacts.length === 0) {
    const results2 = await Promise.allSettled(
      pages.slice(5).map(url => http.get(url).catch(() => null))
    );

    for (const res of results2) {
      if (res.status !== 'fulfilled' || !res.value?.data) continue;
      if (typeof res.value.data !== 'string') continue;

      const found = extractContacts(res.value.data, domain);

      for (const c of found) {
        const key = `${c.firstName} ${c.lastName}`.toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          allContacts.push(c);
        }
      }

      if (allContacts.length >= MAX_CONTACTS_PER_COMPANY) break;
    }
  }

  return allContacts.slice(0, MAX_CONTACTS_PER_COMPANY);
}

/**
 * Save contact to database (DB trigger also validates job title)
 */
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
      VALUES ($1, $2, $3, $4, $5, $6, 'Website Scrape (Verified)', NOW())
    `, [accountId, contact.firstName, contact.lastName, contact.email, contact.phone, contact.jobTitle]);

    return true;
  } catch (e) {
    // DB trigger will reject bad contacts - that's fine
    return false;
  }
}

/**
 * Process a single company
 */
async function processCompany(company) {
  try {
    const contacts = await scrapeContacts(company.website);

    let saved = 0;
    for (const contact of contacts) {
      const success = await saveContact(company.account_id, contact);
      if (success) saved++;
    }

    stats.processed++;

    if (saved > 0) {
      stats.contacts += saved;
      return { name: company.company_name, contacts, saved };
    }

    return null;
  } catch (e) {
    stats.errors++;
    stats.processed++;
    return null;
  }
}

/**
 * Get companies needing contacts
 */
async function getCompanies(limit) {
  const result = await pool.query(`
    SELECT a.account_id, a.company_name, a.website
    FROM accounts a
    WHERE a.website IS NOT NULL AND a.website != ''
      AND (SELECT COUNT(*) FROM contacts c WHERE c.linked_account_id = a.account_id) < $2
    ORDER BY RANDOM()
    LIMIT $1
  `, [limit, MAX_CONTACTS_PER_COMPANY]);
  return result.rows;
}

/**
 * Main loop
 */
async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   CONTACT DISCOVERY v3 (Structured HTML Extraction)');
  console.log('='.repeat(60));
  console.log('   Method: Structured HTML cards + sections + mailto');
  console.log('   Names: Must be in known-names database');
  console.log('   Titles: Must be management-level (Director, CEO, etc.)');
  console.log('   Safety: DB trigger also enforces job title');
  console.log('   Max per company: ' + MAX_CONTACTS_PER_COMPANY);
  console.log('   Press Ctrl+C to stop\n');

  loadCache();
  const cacheStats = getCacheStats();
  console.log(`   Name DB: ${cacheStats.localDbSize} known names, ${cacheStats.blockedWords} blocked words\n`);

  let batch = 0;

  while (true) {
    batch++;
    console.log(`[Batch ${batch}] Loading companies...`);

    try {
      const companies = await getCompanies(BATCH_SIZE);

      if (companies.length === 0) {
        console.log('  No more companies needing contacts! Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      console.log(`  Processing ${companies.length} companies...\n`);

      for (let i = 0; i < companies.length; i += PARALLEL) {
        const chunk = companies.slice(i, i + PARALLEL);
        const results = await Promise.all(chunk.map(c => processCompany(c)));

        results.filter(r => r).forEach(r => {
          const contactList = r.contacts.map(c => `${c.firstName} ${c.lastName} (${c.jobTitle})`).join(', ');
          console.log(`    + ${r.name}: ${r.saved} contact(s) - ${contactList}`);
        });
      }

      const elapsed = Math.floor((Date.now() - stats.start) / 1000);
      const rate = elapsed > 0 ? (stats.processed / elapsed * 60).toFixed(1) : 0;

      console.log(`\n[Stats] Processed: ${stats.processed} | Saved: ${stats.contacts} | Errors: ${stats.errors} | Rate: ${rate}/min | Elapsed: ${Math.floor(elapsed / 60)}m\n`);

      await new Promise(r => setTimeout(r, 2000));

    } catch (e) {
      console.error(`[Error] ${e.message}`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\nStopped.');
  console.log(`Total contacts saved: ${stats.contacts}`);
  console.log(`Companies processed: ${stats.processed}`);
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
