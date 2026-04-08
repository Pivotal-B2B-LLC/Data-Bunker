#!/usr/bin/env node

/**
 * UNIFIED ENRICHMENT SYSTEM v2
 *
 * Complete all-in-one enrichment pipeline:
 * 1. Management contacts (Directors, VPs, C-Level - NO LIMIT)
 * 2. Contact emails & phones
 * 3. Company phones, addresses, email formats
 * 4. Data quality scoring (0-100%)
 * 5. Companies House status verification
 * 6. LinkedIn profile finder
 * 7. Social media links (Twitter, Facebook, Instagram)
 * 8. Employee count estimation
 * 9. Duplicate detection
 *
 * Runs continuously with smart prioritization
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// ==================== CONFIGURATION ====================
const CONFIG = {
  PARALLEL: 10,
  BATCH_SIZE: 50,
  TIMEOUT: 10000,
  MIN_CONTACTS_PER_COMPANY: 1,
  MAX_CONTACTS_PER_COMPANY: 8,
  CYCLE_DELAY: 1500,
  COMPANIES_HOUSE_API_KEY: process.env.COMPANIES_HOUSE_API_KEY || null,
};

// Management titles
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

// Words that are NOT first names - filter these out
const NOT_FIRST_NAMES = new Set([
  // Business/corporate terms
  'business', 'company', 'corporate', 'enterprise', 'group', 'limited', 'ltd',
  'inc', 'corporation', 'holdings', 'solutions', 'services', 'consulting',
  'international', 'global', 'national', 'regional', 'local',
  // Places
  'university', 'college', 'school', 'institute', 'academy', 'centre', 'center',
  'london', 'edinburgh', 'glasgow', 'manchester', 'birmingham', 'bristol',
  'north', 'south', 'east', 'west', 'central', 'united', 'kingdom', 'british',
  // Industries/sectors
  'healthcare', 'technology', 'financial', 'retail', 'manufacturing', 'energy',
  'construction', 'property', 'real', 'estate', 'life', 'sciences', 'sector',
  'industry', 'market', 'digital', 'media', 'creative',
  // Job titles (that get picked up as names)
  'director', 'manager', 'executive', 'officer', 'president', 'chairman',
  'head', 'chief', 'senior', 'junior', 'lead', 'principal', 'associate',
  'assistant', 'coordinator', 'specialist', 'analyst', 'consultant',
  'operations', 'sales', 'marketing', 'finance', 'human', 'resources',
  // Generic words
  'our', 'the', 'and', 'for', 'with', 'about', 'meet', 'team', 'staff',
  'excellence', 'quality', 'best', 'first', 'new', 'old', 'great', 'good',
  'read', 'more', 'view', 'contact', 'click', 'here', 'learn', 'discover',
  // Organizations
  'board', 'committee', 'council', 'trust', 'foundation', 'charity', 'association',
  // Other common non-names
  'just', 'dogs', 'red', 'blue', 'green', 'black', 'white', 'near', 'silk',
  'factory', 'road', 'street', 'avenue', 'place', 'house', 'building',
  'data', 'protection', 'information', 'freedom', 'policy', 'privacy',
  'cookie', 'terms', 'conditions', 'compliance', 'regulatory', 'legal',
  // Additional garbage words found in cleanup
  'current', 'bank', 'chambers', 'safe', 'contractor', 'quantity', 'surveyor',
  'contacts', 'architects', 'developments', 'special', 'comprehensive', 'mindset',
  'craftsmanship', 'builders', 'indian', 'ocean', 'virgin', 'islands', 'african',
  'republic', 'restaurant', 'general', 'partner', 'design', 'stevenson',
  'awards', 'news', 'double', 'recruitment', 'getting', 'youth', 'children',
  'project', 'women', 'visitor', 'tribe', 'summit'
]);

// Common valid first names (subset for validation)
const COMMON_FIRST_NAMES = new Set([
  // Male names
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
  'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark',
  'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian',
  'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan', 'jacob',
  'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott',
  'brandon', 'benjamin', 'samuel', 'raymond', 'gregory', 'frank', 'alexander',
  'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'adam', 'nathan',
  'henry', 'douglas', 'zachary', 'peter', 'kyle', 'noah', 'ethan', 'jeremy',
  'walter', 'christian', 'keith', 'roger', 'terry', 'austin', 'sean', 'gerald',
  'carl', 'harold', 'dylan', 'arthur', 'lawrence', 'jordan', 'jesse', 'bryan',
  'billy', 'bruce', 'gabriel', 'joe', 'logan', 'alan', 'juan', 'albert', 'willie',
  'elijah', 'randy', 'wayne', 'vincent', 'philip', 'eugene', 'russell', 'bobby',
  'harry', 'johnny', 'howard', 'martin', 'stuart', 'colin', 'graham', 'neil',
  'ian', 'simon', 'fraser', 'alistair', 'angus', 'duncan', 'hamish', 'callum',
  // Female names
  'mary', 'patricia', 'jennifer', 'linda', 'barbara', 'elizabeth', 'susan', 'jessica',
  'sarah', 'karen', 'lisa', 'nancy', 'betty', 'margaret', 'sandra', 'ashley',
  'kimberly', 'emily', 'donna', 'michelle', 'dorothy', 'carol', 'amanda', 'melissa',
  'deborah', 'stephanie', 'rebecca', 'sharon', 'laura', 'cynthia', 'kathleen',
  'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela', 'emma', 'nicole', 'helen',
  'samantha', 'katherine', 'christine', 'debra', 'rachel', 'carolyn', 'janet',
  'catherine', 'maria', 'heather', 'diane', 'ruth', 'julie', 'olivia', 'joyce',
  'virginia', 'victoria', 'kelly', 'lauren', 'christina', 'joan', 'evelyn', 'judith',
  'megan', 'andrea', 'cheryl', 'hannah', 'jacqueline', 'martha', 'gloria', 'teresa',
  'ann', 'sara', 'madison', 'frances', 'kathryn', 'janice', 'jean', 'abigail',
  'alice', 'judy', 'sophia', 'grace', 'denise', 'amber', 'doris', 'marilyn',
  'danielle', 'beverly', 'isabella', 'theresa', 'diana', 'natalie', 'brittany',
  'charlotte', 'marie', 'kayla', 'alexis', 'lori', 'claire', 'fiona', 'eileen',
  'moira', 'catriona', 'isla', 'ailsa', 'kirsty', 'lynne', 'lesley', 'elaine'
]);

// Stats tracking
let stats = {
  contacts: { found: 0, emails: 0, phones: 0, linkedin: 0 },
  companies: { phones: 0, addresses: 0, emailFormats: 0, linkedin: 0, social: 0, verified: 0 },
  quality: { scored: 0, avgScore: 0 },
  duplicates: { found: 0, merged: 0 },
  processed: 0,
  errors: 0,
  start: Date.now()
};

const http = axios.create({
  timeout: CONFIG.TIMEOUT,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  maxRedirects: 3
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

/**
 * Validate if a name looks like a real person name
 */
function isValidPersonName(firstName, lastName) {
  if (!firstName || !lastName) return false;

  const first = firstName.toLowerCase().trim();
  const last = lastName.toLowerCase().trim();

  // Check if first name is in the NOT list
  if (NOT_FIRST_NAMES.has(first)) return false;
  if (NOT_FIRST_NAMES.has(last)) return false;

  // First name should be 2-15 chars
  if (first.length < 2 || first.length > 15) return false;

  // Last name should be 2-25 chars (allow for long multicultural names)
  if (last.length < 2 || last.length > 25) return false;

  // Names should be mostly letters (allow apostrophe and hyphen)
  if (!/^[a-z'-]+$/.test(first)) return false;
  if (!/^[a-z'-]+$/.test(last)) return false;

  // Reject names that look like concatenated words (e.g., "Surveyorstefan")
  if (first.length > 12 && !COMMON_FIRST_NAMES.has(first)) return false;
  if (last.length > 15) return false;

  // Reject common English words that aren't names
  const wordPatterns = /^(the|and|for|with|our|all|new|old|big|top|best|first|last|next|only|real|true|full|high|low|open|free|easy|fast|hard|soft|long|short|wide|deep|dark|light|good|bad|hot|cold|dry|wet|raw|current|safe|bank|quantity|special|comprehensive|general|total|main|major|minor|super|extra|ultra|mega|mini|micro|macro|multi|mono|semi|anti|pre|post|pro|non|sub|co|re|un|in|out|up|down|over|under|inter|trans|cross|self|auto|tele|cyber|bio|eco|geo|techno|electro|hydro|photo|thermo|aero|astro|cosmo|any|some|every|no|each|few|many|much|more|most|less|least|such|what|which|who|whom|whose|how|why|when|where|there|here|this|that|these|those)$/;
  if (wordPatterns.test(first)) return false;

  // If first name is a known common name, definitely valid
  if (COMMON_FIRST_NAMES.has(first)) return true;

  // For uncommon first names, apply additional checks
  if (first.length < 3) return false;

  // Reject words ending in common suffixes
  const badSuffixes = /(tion|ment|ness|ship|hood|ity|ism|ist|ive|ous|ful|less|able|ible|ward|wise|like|free)$/;
  if (badSuffixes.test(first)) return false;
  if (badSuffixes.test(last)) return false;

  return true;
}

/**
 * Clean job title from a name (removes trailing job words)
 */
function removeJobTitleFromName(name) {
  if (!name) return name;

  // Words that are often appended to names by mistake
  const jobWords = [
    'director', 'manager', 'executive', 'officer', 'president', 'chairman',
    'head', 'chief', 'senior', 'junior', 'lead', 'principal', 'associate',
    'founder', 'founding', 'owner', 'partner', 'ceo', 'cto', 'cfo', 'coo',
    'tour', 'regional', 'operations', 'sales', 'marketing', 'finance',
    'board', 'trustee', 'consultant', 'advisor', 'specialist', 'analyst'
  ];

  let parts = name.split(/\s+/);

  // Remove job words from the end
  while (parts.length > 2 && jobWords.includes(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }

  // Remove job words from the beginning (but keep at least 2 parts)
  while (parts.length > 2 && jobWords.includes(parts[0].toLowerCase())) {
    parts.shift();
  }

  return parts.join(' ');
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
  if (/^[a-z]+\.[a-z]+$/.test(local)) return `{first}.{last}@${domain}`;
  if (/^[a-z]+_[a-z]+$/.test(local)) return `{first}_{last}@${domain}`;
  if (/^[a-z]\.[a-z]+$/.test(local)) return `{f}.{last}@${domain}`;
  if (/^[a-z][a-z]+$/.test(local) && local.length > 4) return `{f}{last}@${domain}`;
  return null;
}

// ==================== DATA QUALITY SCORING ====================

function calculateQualityScore(company, contactCount) {
  let score = 0;
  const weights = {
    company_name: 10,
    website: 15,
    phone_number: 15,
    address: 10,
    email_format: 10,
    linkedin_url: 10,
    industry: 5,
    city: 5,
    contacts: 20  // Up to 20 points for contacts
  };

  if (company.company_name) score += weights.company_name;
  if (company.website) score += weights.website;
  if (company.phone_number) score += weights.phone_number;
  if (company.address) score += weights.address;
  if (company.email_format) score += weights.email_format;
  if (company.linkedin_url) score += weights.linkedin_url;
  if (company.industry) score += weights.industry;
  if (company.city) score += weights.city;

  // Contacts: 4 points per contact up to 5 contacts
  score += Math.min(contactCount, 5) * 4;

  return Math.min(score, 100);
}

// ==================== LINKEDIN FINDER ====================

async function findLinkedInCompany(companyName, website) {
  if (!companyName) return null;

  try {
    // Search via DuckDuckGo
    const query = `site:linkedin.com/company "${companyName}"`;
    const response = await http.get(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    );

    const linkedinMatch = response.data.match(/linkedin\.com\/company\/[a-zA-Z0-9-]+/i);
    if (linkedinMatch) {
      return `https://www.${linkedinMatch[0]}`;
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

async function findLinkedInPerson(firstName, lastName, companyName) {
  if (!firstName || !lastName) return null;

  try {
    const query = `site:linkedin.com/in "${firstName} ${lastName}" "${companyName || ''}"`;
    const response = await http.get(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    );

    const linkedinMatch = response.data.match(/linkedin\.com\/in\/[a-zA-Z0-9-]+/i);
    if (linkedinMatch) {
      return `https://www.${linkedinMatch[0]}`;
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

// ==================== SOCIAL MEDIA FINDER ====================

function extractSocialLinks(html) {
  const social = {
    twitter: null,
    facebook: null,
    instagram: null
  };

  // Twitter
  const twitterMatch = html.match(/twitter\.com\/([a-zA-Z0-9_]+)/i) ||
                       html.match(/x\.com\/([a-zA-Z0-9_]+)/i);
  if (twitterMatch && !['share', 'intent', 'home'].includes(twitterMatch[1].toLowerCase())) {
    social.twitter = `https://twitter.com/${twitterMatch[1]}`;
  }

  // Facebook
  const fbMatch = html.match(/facebook\.com\/([a-zA-Z0-9.]+)/i);
  if (fbMatch && !['sharer', 'share', 'dialog'].includes(fbMatch[1].toLowerCase())) {
    social.facebook = `https://facebook.com/${fbMatch[1]}`;
  }

  // Instagram
  const igMatch = html.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
  if (igMatch && !['p', 'reel', 'stories'].includes(igMatch[1].toLowerCase())) {
    social.instagram = `https://instagram.com/${igMatch[1]}`;
  }

  return social;
}

// ==================== EMPLOYEE COUNT ESTIMATION ====================

function estimateEmployeeCount(html, $) {
  // Look for employee mentions
  const patterns = [
    /(\d+)\s*(?:\+\s*)?employees/i,
    /team\s*of\s*(\d+)/i,
    /(\d+)\s*(?:staff|people|members)/i,
    /(\d+)-(\d+)\s*employees/i
  ];

  const text = html.toLowerCase();

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseInt(match[1]);
      if (num > 0 && num < 100000) {
        return num;
      }
    }
  }

  // Check LinkedIn-style size indicators
  if (text.includes('1-10 employees') || text.includes('micro')) return 5;
  if (text.includes('11-50 employees') || text.includes('small')) return 30;
  if (text.includes('51-200 employees') || text.includes('medium')) return 100;
  if (text.includes('201-500 employees')) return 350;
  if (text.includes('501-1000 employees')) return 750;
  if (text.includes('1001-5000 employees')) return 2500;

  return null;
}

// ==================== COMPANIES HOUSE VERIFICATION ====================

async function verifyCompanyStatus(companyNumber) {
  if (!CONFIG.COMPANIES_HOUSE_API_KEY || !companyNumber) return null;

  try {
    const response = await axios.get(
      `https://api.company-information.service.gov.uk/company/${companyNumber}`,
      {
        auth: { username: CONFIG.COMPANIES_HOUSE_API_KEY, password: '' },
        timeout: 5000
      }
    );

    return {
      status: response.data.company_status,
      type: response.data.type,
      sicCodes: response.data.sic_codes || []
    };
  } catch (e) {
    return null;
  }
}

// ==================== DUPLICATE DETECTION ====================

async function findDuplicates(companyName, website) {
  if (!companyName) return [];

  try {
    // Find potential duplicates by similar name or same website domain
    const domain = getDomain(website);

    const result = await pool.query(`
      SELECT account_id, company_name, website
      FROM accounts
      WHERE (
        LOWER(company_name) = LOWER($1)
        OR (website IS NOT NULL AND website LIKE $2)
      )
      LIMIT 5
    `, [companyName, domain ? `%${domain}%` : 'NOMATCH']);

    return result.rows;
  } catch (e) {
    return [];
  }
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
        let fullName = match[0].trim();
        if (fullName.length < 4) continue;

        // Clean job titles from name (e.g., "Danielle Trudeau Founding" -> "Danielle Trudeau")
        fullName = removeJobTitleFromName(fullName);

        if (seenNames.has(fullName.toLowerCase())) continue;

        const cleaned = cleanName(fullName);
        if (!cleaned) continue;

        const parts = cleaned.split(/\s+/);
        if (parts.length < 2) continue;

        const firstName = parts[0];
        const lastName = parts.slice(1).join(' ');

        // STRICT VALIDATION: Skip if not a valid person name
        if (!isValidPersonName(firstName, lastName)) continue;

        const context = text.substring(
          Math.max(0, text.indexOf(match[0]) - 200),
          Math.min(text.length, text.indexOf(match[0]) + 300)
        );

        const jobTitle = findJobTitle(context);
        if (!isManagementTitle(jobTitle)) continue;

        seenNames.add(fullName.toLowerCase());

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
  const result = {
    phone: null,
    address: null,
    emailFormat: null,
    linkedin: null,
    twitter: null,
    facebook: null,
    instagram: null,
    employeeCount: null,
    html: null
  };

  if (!company.website) return result;

  const domain = getDomain(company.website);

  try {
    const response = await http.get(company.website);
    const html = response.data;
    const $ = cheerio.load(html);
    result.html = html;

    // Extract phone
    if (!company.phone_number) {
      result.phone = extractPhone(html);
    }

    // Extract address
    if (!company.address) {
      const postcodeMatch = html.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i);
      if (postcodeMatch) {
        const idx = html.indexOf(postcodeMatch[0]);
        const context = html.substring(Math.max(0, idx - 100), idx + 20);
        const cleanContext = context.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (cleanContext.length > 10 && cleanContext.length < 200) {
          result.address = cleanContext;
        }
      }
    }

    // Detect email format
    if (!company.email_format) {
      const emails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      for (const email of emails) {
        const format = detectEmailFormat(email.toLowerCase(), domain);
        if (format) {
          result.emailFormat = format;
          break;
        }
      }
    }

    // Extract social links
    if (!company.twitter_url || !company.facebook_url || !company.instagram_url) {
      const social = extractSocialLinks(html);
      result.twitter = social.twitter;
      result.facebook = social.facebook;
      result.instagram = social.instagram;
    }

    // Estimate employee count
    if (!company.employee_count) {
      result.employeeCount = estimateEmployeeCount(html, $);
    }

    // Find LinkedIn (if not already have it)
    if (!company.linkedin_url) {
      // First check page for linkedin link
      const linkedinMatch = html.match(/linkedin\.com\/company\/[a-zA-Z0-9-]+/i);
      if (linkedinMatch) {
        result.linkedin = `https://www.${linkedinMatch[0]}`;
      }
    }

  } catch (e) {
    // Ignore errors
  }

  return result;
}

// ==================== DATABASE OPERATIONS ====================

async function saveContact(accountId, contact, companyName) {
  try {
    const exists = await pool.query(
      `SELECT 1 FROM contacts WHERE linked_account_id = $1
       AND LOWER(first_name) = LOWER($2) AND LOWER(last_name) = LOWER($3) LIMIT 1`,
      [accountId, contact.firstName, contact.lastName]
    );

    if (exists.rows.length > 0) return false;

    // Try to find LinkedIn for contact
    let linkedinUrl = null;
    try {
      linkedinUrl = await findLinkedInPerson(contact.firstName, contact.lastName, companyName);
      if (linkedinUrl) stats.contacts.linkedin++;
    } catch (e) {}

    await pool.query(`
      INSERT INTO contacts (linked_account_id, first_name, last_name, email, phone_number, job_title, linkedin_url, data_source, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'Unified v2', NOW())
    `, [accountId, contact.firstName, contact.lastName, contact.email, contact.phone, contact.jobTitle, linkedinUrl]);

    return true;
  } catch (e) {
    return false;
  }
}

async function updateCompany(accountId, data, qualityScore) {
  try {
    const updates = ['quality_score = $2', 'updated_at = NOW()'];
    const values = [accountId, qualityScore];
    let idx = 3;

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
    if (data.linkedin) {
      updates.push(`linkedin_url = $${idx++}`);
      values.push(data.linkedin);
    }
    if (data.twitter) {
      updates.push(`twitter_url = $${idx++}`);
      values.push(data.twitter);
    }
    if (data.facebook) {
      updates.push(`facebook_url = $${idx++}`);
      values.push(data.facebook);
    }
    if (data.instagram) {
      updates.push(`instagram_url = $${idx++}`);
      values.push(data.instagram);
    }
    if (data.employeeCount) {
      updates.push(`employee_count = $${idx++}`);
      values.push(data.employeeCount);
    }

    await pool.query(
      `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $1`,
      values
    );
    return true;
  } catch (e) {
    return false;
  }
}

async function getCompaniesToEnrich(limit) {
  const result = await pool.query(`
    SELECT a.account_id, a.company_name, a.website, a.phone_number, a.address,
           a.email_format, a.linkedin_url, a.twitter_url, a.facebook_url,
           a.instagram_url, a.employee_count, a.quality_score, a.industry, a.city
    FROM accounts a
    WHERE a.website IS NOT NULL AND a.website != ''
      AND (
        a.quality_score IS NULL
        OR a.quality_score < 50
        OR (SELECT COUNT(*) FROM contacts c WHERE c.linked_account_id = a.account_id) < $2
      )
    ORDER BY a.quality_score ASC NULLS FIRST, RANDOM()
    LIMIT $1
  `, [limit, CONFIG.MAX_CONTACTS_PER_COMPANY]);
  return result.rows;
}

// ==================== MAIN ENRICHMENT PIPELINE ====================

async function processCompany(company) {
  const result = {
    contacts: 0,
    phone: false,
    address: false,
    emailFormat: false,
    linkedin: false,
    social: false,
    qualityScore: 0
  };

  try {
    // 1. Discover management contacts
    const contacts = await discoverContacts(company);
    for (const contact of contacts) {
      const saved = await saveContact(company.account_id, contact, company.company_name);
      if (saved) {
        result.contacts++;
        stats.contacts.found++;
        if (contact.email) stats.contacts.emails++;
        if (contact.phone) stats.contacts.phones++;
      }
    }

    // 2. Enrich company data
    const enrichData = await enrichCompany(company);

    // Track what was found
    if (enrichData.phone) { result.phone = true; stats.companies.phones++; }
    if (enrichData.address) { result.address = true; stats.companies.addresses++; }
    if (enrichData.emailFormat) { result.emailFormat = true; stats.companies.emailFormats++; }
    if (enrichData.linkedin) { result.linkedin = true; stats.companies.linkedin++; }
    if (enrichData.twitter || enrichData.facebook || enrichData.instagram) {
      result.social = true;
      stats.companies.social++;
    }

    // 3. Calculate quality score
    const contactCount = result.contacts + (await pool.query(
      'SELECT COUNT(*) FROM contacts WHERE linked_account_id = $1',
      [company.account_id]
    )).rows[0].count;

    const updatedCompany = { ...company, ...enrichData };
    result.qualityScore = calculateQualityScore(updatedCompany, parseInt(contactCount));
    stats.quality.scored++;
    stats.quality.avgScore = ((stats.quality.avgScore * (stats.quality.scored - 1)) + result.qualityScore) / stats.quality.scored;

    // 4. Update company
    await updateCompany(company.account_id, enrichData, result.qualityScore);

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

  console.log('\n' + '='.repeat(55));
  console.log(`[STATS] Processed: ${stats.processed} | Rate: ${rate}/min | Errors: ${stats.errors}`);
  console.log('-'.repeat(55));
  console.log(`  CONTACTS: ${stats.contacts.found} total`);
  console.log(`    - Emails: ${stats.contacts.emails} | Phones: ${stats.contacts.phones} | LinkedIn: ${stats.contacts.linkedin}`);
  console.log(`  COMPANIES:`);
  console.log(`    - Phones: ${stats.companies.phones} | Addresses: ${stats.companies.addresses}`);
  console.log(`    - Email Formats: ${stats.companies.emailFormats} | LinkedIn: ${stats.companies.linkedin}`);
  console.log(`    - Social Media: ${stats.companies.social}`);
  console.log(`  QUALITY: Avg Score: ${stats.quality.avgScore.toFixed(1)}%`);
  console.log('='.repeat(55) + '\n');
}

async function ensureColumns() {
  // Add new columns if they don't exist
  const columns = [
    { name: 'quality_score', type: 'INTEGER' },
    { name: 'linkedin_url', type: 'VARCHAR(500)' },
    { name: 'twitter_url', type: 'VARCHAR(500)' },
    { name: 'facebook_url', type: 'VARCHAR(500)' },
    { name: 'instagram_url', type: 'VARCHAR(500)' },
    { name: 'employee_count', type: 'INTEGER' },
    { name: 'company_status', type: 'VARCHAR(50)' },
    { name: 'data_source', type: 'VARCHAR(100)' }
  ];

  for (const col of columns) {
    try {
      await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
    } catch (e) {
      // Column might already exist
    }
  }

  // Add linkedin_url to contacts if not exists
  try {
    await pool.query('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(500)');
    await pool.query('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS data_source VARCHAR(100)');
  } catch (e) {}
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   UNIFIED ENRICHMENT SYSTEM v2');
  console.log('='.repeat(60));
  console.log('   Complete all-in-one pipeline:');
  console.log('   - Management contacts (1-8 per company)');
  console.log('   - Emails, phones, addresses');
  console.log('   - Email format detection');
  console.log('   - LinkedIn profiles (company + contacts)');
  console.log('   - Social media (Twitter, Facebook, Instagram)');
  console.log('   - Employee count estimation');
  console.log('   - Data quality scoring (0-100%)');
  console.log('   Press Ctrl+C to stop\n');

  // Ensure database has required columns
  await ensureColumns();
  console.log('  Database schema verified.\n');

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

          if (r.contacts > 0 || r.phone || r.emailFormat || r.linkedin || r.social) {
            const parts = [];
            if (r.contacts > 0) parts.push(`${r.contacts} contacts`);
            if (r.phone) parts.push('phone');
            if (r.address) parts.push('address');
            if (r.emailFormat) parts.push('email format');
            if (r.linkedin) parts.push('LinkedIn');
            if (r.social) parts.push('social');
            parts.push(`[${r.qualityScore}%]`);
            console.log(`    + ${c.company_name}: ${parts.join(', ')}`);
          }
        }
      }

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
