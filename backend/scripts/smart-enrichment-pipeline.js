#!/usr/bin/env node

/**
 * SMART ENRICHMENT PIPELINE v3
 *
 * Research chain (your trick):
 *   We have: company name + location/industry/reg number
 *   Step 1: Find LinkedIn company page (often has website listed)
 *   Step 2: Find website (from LinkedIn OR DuckDuckGo search)
 *   Step 3: Deep scrape website (phone, email pattern, contacts, social)
 *   Step 4: Companies House lookup for UK companies (directors, status)
 *   Step 5: Generate contact emails using email format + found names
 *
 * Key principles:
 *   - Use what we HAVE to find what we DON'T have
 *   - LinkedIn is the bridge between name → website → everything else
 *   - Every data point found unlocks more data points
 *   - Research thoroughly, don't skip steps
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');
const { isValidPersonName, isValidJobTitle } = require('../src/services/nameVerifier');

// ==================== CONFIGURATION ====================
const CONFIG = {
  PARALLEL_COMPANIES: 8,      // Companies enriched in parallel
  BATCH_SIZE: 100,             // Companies per batch
  REQUEST_TIMEOUT: 12000,      // 12s per request
  DELAY_BETWEEN_BATCHES: 2000, // 2s between batches
  COMPANIES_HOUSE_API_KEY: process.env.COMPANIES_HOUSE_API_KEY || null,
};

// ==================== ANTI-RATE-LIMIT: USER-AGENT ROTATION ====================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(min = 200, max = 800) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

const http = axios.create({
  timeout: CONFIG.REQUEST_TIMEOUT,
  maxRedirects: 5
});

// Add random UA to every request
http.interceptors.request.use(config => {
  config.headers['User-Agent'] = randomUA();
  return config;
});

// ==================== SEARCH ENGINE ROTATION ====================
// Rotate between multiple search engines to avoid rate limits on any single one

let searchEngineIndex = 0;

async function webSearch(query) {
  const engines = [
    // DuckDuckGo HTML
    async (q) => {
      const res = await http.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
      return res.data;
    },
    // Bing
    async (q) => {
      const res = await http.get(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=10`, {
        headers: { 'User-Agent': randomUA(), 'Accept-Language': 'en-US,en;q=0.9' }
      });
      return res.data;
    },
    // Brave Search
    async (q) => {
      const res = await http.get(`https://search.brave.com/search?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': randomUA(), 'Accept': 'text/html' }
      });
      return res.data;
    },
    // Ecosia (uses Bing backend but different rate limits)
    async (q) => {
      const res = await http.get(`https://www.ecosia.org/search?method=index&q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': randomUA(), 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }
      });
      return res.data;
    },
    // Mojeek (independent search engine)
    async (q) => {
      const res = await http.get(`https://www.mojeek.com/search?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': randomUA(), 'Accept': 'text/html' }
      });
      return res.data;
    },
    // AOL Search (uses Bing backend)
    async (q) => {
      const res = await http.get(`https://search.aol.com/aol/search?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': randomUA(), 'Accept': 'text/html' }
      });
      return res.data;
    },
  ];

  // Rotate through engines
  const startIdx = searchEngineIndex;

  for (let attempt = 0; attempt < engines.length; attempt++) {
    const idx = (startIdx + attempt) % engines.length;
    try {
      await randomDelay(100, 500); // Jitter before each request
      const result = await engines[idx](query);
      searchEngineIndex = (idx + 1) % engines.length; // Next engine for next call
      return result;
    } catch (e) {
      // This engine failed (rate limited?), try next
      continue;
    }
  }

  return null; // All engines failed
}

// Extract URLs from any search engine's HTML
function extractUrlsFromSearch(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const rawUrls = [];

  // Helper: clean and validate a URL
  function addUrl(raw) {
    if (!raw) return;
    let url = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].split(' ')[0].trim().toLowerCase();
    if (url && url.includes('.') && url.length > 4 && url.length < 80) {
      rawUrls.push(url);
    }
  }

  // DuckDuckGo format - use href from result links, NOT the displayed URL text
  $('.result__a').each((_, el) => {
    const href = $(el).attr('href') || '';
    // DDG wraps URLs in redirect: extract the actual target
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try { addUrl(decodeURIComponent(uddg[1])); } catch {}
    } else {
      addUrl(href);
    }
  });
  // Also try the snippet URL display
  $('.result__url').each((_, el) => {
    addUrl($(el).text().trim());
  });

  // Bing format - use actual href, not cite text
  $('li.b_algo h2 a').each((_, el) => {
    addUrl($(el).attr('href'));
  });
  $('cite').each((_, el) => {
    addUrl($(el).text().trim());
  });

  // Brave format
  $('[data-type="web"] .url, .result-url, .netloc').each((_, el) => {
    addUrl($(el).text().trim());
  });
  $('a.result-header').each((_, el) => {
    addUrl($(el).attr('href'));
  });

  // Ecosia format
  $('a.result-title, a.result__link').each((_, el) => {
    addUrl($(el).attr('href'));
  });

  // Mojeek format
  $('a.ob, .results-standard a[href^="http"]').each((_, el) => {
    addUrl($(el).attr('href'));
  });

  // AOL format
  $('.algo-sr .compTitle a, .ov-a').each((_, el) => {
    addUrl($(el).attr('href'));
  });

  // Generic fallback: find URLs in the raw HTML
  const urlRegex = /https?:\/\/([a-zA-Z0-9][a-zA-Z0-9-]*\.(?:com|co\.uk|org|net|io|biz|info|co|uk|us|ca|au|de|fr|es|it|nl|be|se|no|dk|fi|at|ch|ie|nz))/g;
  let match;
  while ((match = urlRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  // Deduplicate and FILTER OUT search engines, social media, and junk domains
  const urls = [...new Set(rawUrls)].filter(url => !SKIP_DOMAINS.has(url));
  return urls;
}

// ==================== DOMAIN GUESSING (ZERO API CALLS) ====================

async function guessWebsite(companyName, country) {
  const cleanName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.|& co|company|group|holdings|services|solutions)\.?\s*/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (cleanName.length < 3 || cleanName.length > 30) return null;

  // Generate domain candidates based on country
  const isUK = country && (country.toLowerCase().includes('kingdom') || country.toLowerCase().includes('uk'));
  const domains = isUK
    ? [`${cleanName}.co.uk`, `${cleanName}.com`, `${cleanName}.uk`, `${cleanName}.org.uk`]
    : [`${cleanName}.com`, `${cleanName}.co`, `${cleanName}.net`, `${cleanName}.org`];

  // Also try with hyphens for multi-word names
  const hyphenName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.|& co|company|group|holdings|services|solutions)\.?\s*/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

  if (hyphenName !== cleanName && hyphenName.length >= 3) {
    if (isUK) {
      domains.push(`${hyphenName}.co.uk`, `${hyphenName}.com`);
    } else {
      domains.push(`${hyphenName}.com`, `${hyphenName}.co`);
    }
  }

  // Try each domain with a quick HEAD request (fast, no rate limit issues)
  for (const domain of domains) {
    try {
      const response = await axios.head(`https://www.${domain}`, {
        timeout: 5000,
        maxRedirects: 3,
        headers: { 'User-Agent': randomUA() },
        validateStatus: (status) => status < 500 // Accept redirects and 4xx
      });

      // If we get 200 or a redirect, the site exists
      if (response.status >= 200 && response.status < 400) {
        return `https://www.${domain}`;
      }
    } catch (e) {
      // Try without www
      try {
        const response2 = await axios.head(`https://${domain}`, {
          timeout: 4000,
          maxRedirects: 3,
          headers: { 'User-Agent': randomUA() },
          validateStatus: (status) => status < 500
        });
        if (response2.status >= 200 && response2.status < 400) {
          return `https://${domain}`;
        }
      } catch {}
    }
  }

  return null;
}

// ==================== WEBSITE VERIFICATION ====================
// Verify that a found website actually belongs to the company

async function verifyWebsite(url, companyName) {
  if (!url || !companyName) return { valid: false, confidence: 0 };

  const cleanName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.|& co|company|group|holdings|services|solutions)\.?\s*/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .toLowerCase();

  // Words to match (split company name into tokens)
  const nameWords = cleanName.split(/\s+/).filter(w => w.length > 2);
  if (nameWords.length === 0) return { valid: true, confidence: 50 }; // Can't check short names

  try {
    const response = await http.get(url, { timeout: 8000 });
    const html = response.data;
    const $ = cheerio.load(html);

    let score = 0;

    // Check page title
    const title = $('title').text().toLowerCase();
    const titleMatches = nameWords.filter(w => title.includes(w)).length;
    if (titleMatches >= Math.ceil(nameWords.length * 0.5)) score += 40;
    else if (titleMatches > 0) score += 20;

    // Check meta description
    const metaDesc = ($('meta[name="description"]').attr('content') || '').toLowerCase();
    const metaMatches = nameWords.filter(w => metaDesc.includes(w)).length;
    if (metaMatches >= Math.ceil(nameWords.length * 0.5)) score += 20;
    else if (metaMatches > 0) score += 10;

    // Check OG site name
    const ogSiteName = ($('meta[property="og:site_name"]').attr('content') || '').toLowerCase();
    if (ogSiteName && nameWords.some(w => ogSiteName.includes(w))) score += 15;

    // Check domain itself contains company name
    const domain = getDomain(url) || '';
    const domainClean = domain.replace(/[-_.]/g, '').toLowerCase();
    const nameNoSpaces = cleanName.replace(/\s/g, '');
    if (domainClean.includes(nameNoSpaces) || nameNoSpaces.includes(domainClean.split('.')[0])) {
      score += 25;
    }

    // Check h1 headings
    const h1Text = $('h1').first().text().toLowerCase();
    if (h1Text && nameWords.some(w => h1Text.includes(w))) score += 10;

    // Check footer (often has company legal name)
    const footerText = $('footer').text().toLowerCase();
    const footerMatches = nameWords.filter(w => footerText.includes(w)).length;
    if (footerMatches >= Math.ceil(nameWords.length * 0.5)) score += 15;

    // Cap at 100
    score = Math.min(score, 100);

    return { valid: score >= 30, confidence: score };
  } catch (e) {
    // If we can't fetch the page, check domain name only
    const domain = getDomain(url) || '';
    const domainClean = domain.replace(/[-_.]/g, '').toLowerCase();
    const nameNoSpaces = cleanName.replace(/\s/g, '');
    const domainMatch = domainClean.includes(nameNoSpaces) || nameNoSpaces.includes(domainClean.split('.')[0]);
    return { valid: domainMatch, confidence: domainMatch ? 40 : 10 };
  }
}

// Skip these domains when looking for company websites
const SKIP_DOMAINS = new Set([
  // Social media
  'linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'youtube.com',
  'instagram.com', 'tiktok.com', 'pinterest.com', 'reddit.com',
  // Search engines (CRITICAL - prevent scraping the search engine itself)
  'duckduckgo.com', 'bing.com', 'google.com', 'google.co.uk', 'yahoo.com',
  'brave.com', 'search.brave.com', 'ecosia.org', 'mojeek.com',
  'aol.com', 'search.aol.com', 'startpage.com', 'qwant.com',
  'ask.com', 'baidu.com', 'yandex.com', 'yandex.ru',
  // Directories & aggregators
  'wikipedia.org', 'yelp.com', 'tripadvisor.com', 'glassdoor.com',
  'indeed.com', 'crunchbase.com', 'bloomberg.com', 'gov.uk',
  'companies-house.gov.uk', 'yell.com', 'thomsonlocal.com',
  'trustpilot.com', 'bbb.org', 'yellowpages.com', 'whitepages.com',
  'dnb.com', 'zoominfo.com', 'apollo.io', 'lusha.com',
  // Other noise
  'w3.org', 'schema.org', 'cloudflare.com', 'amazonaws.com',
  'googleusercontent.com', 'gstatic.com', 'googleapis.com',
]);

const GENERIC_EMAIL_PREFIXES = new Set([
  'info', 'contact', 'hello', 'enquiries', 'admin', 'sales', 'support',
  'help', 'office', 'reception', 'mail', 'customer', 'service', 'bookings',
  'orders', 'accounts', 'hr', 'jobs', 'careers', 'marketing', 'press',
  'team', 'general', 'feedback', 'noreply', 'newsletter', 'billing',
  'enquiry', 'webmaster', 'postmaster', 'abuse'
]);

const MANAGEMENT_TITLES = [
  'director', 'managing director', 'executive director',
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio',
  'chief executive', 'chief technology', 'chief financial',
  'chief operating', 'chief marketing',
  'president', 'vice president', 'vp', 'svp',
  'owner', 'co-owner', 'founder', 'co-founder',
  'partner', 'managing partner', 'senior partner',
  'principal', 'head of', 'general manager'
];

// Stats
let stats = {
  processed: 0, enriched: 0, errors: 0,
  linkedin_found: 0, websites_found: 0, phones_found: 0,
  emails_found: 0, contacts_found: 0, directors_found: 0,
  email_formats_found: 0, social_found: 0,
  start: Date.now()
};

// ==================== STEP 1: FIND LINKEDIN ====================

async function findLinkedIn(companyName, city, country) {
  if (!companyName) return null;

  const cleanName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.)?\s*$/i, '')
    .trim();

  // Use rotating search engine
  const query = city
    ? `site:linkedin.com/company "${cleanName}" ${city}`
    : `site:linkedin.com/company "${cleanName}"`;

  try {
    const html = await webSearch(query);
    if (html) {
      const match = html.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/i);
      if (match) {
        return `https://www.linkedin.com/company/${match[1]}`;
      }
    }
  } catch (e) {}

  return null;
}

// ==================== STEP 2: FIND WEBSITE ====================

async function findWebsite(companyName, city, country, linkedinUrl) {
  // Strategy A (FASTEST - zero API calls): Guess the domain directly
  const guessedSite = await guessWebsite(companyName, country);
  if (guessedSite) {
    // Verify domain-guessed websites match the company
    const verification = await verifyWebsite(guessedSite, companyName);
    if (verification.valid) {
      stats.domain_guessed = (stats.domain_guessed || 0) + 1;
      stats.verified_websites = (stats.verified_websites || 0) + 1;
      return guessedSite;
    }
    // Domain exists but doesn't match - might be a different company with same name
  }

  // Strategy B: Try to extract website from LinkedIn page
  if (linkedinUrl) {
    try {
      const liResponse = await http.get(linkedinUrl, { timeout: 8000 });
      const liHtml = liResponse.data;
      // LinkedIn pages often show company website
      const websiteMatch = liHtml.match(/(?:website|Website|external-link)[^"]*href="(https?:\/\/[^"]+)"/i);
      if (websiteMatch) {
        const liWebsite = websiteMatch[1].replace(/\?.*$/, ''); // Strip tracking params
        const domain = getDomain(liWebsite);
        if (domain && !SKIP_DOMAINS.has(domain)) {
          stats.linkedin_website = (stats.linkedin_website || 0) + 1;
          return liWebsite;
        }
      }
    } catch {}
  }

  // Strategy C: Search with rotating engines - try multiple results and verify
  const cleanName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.)?\s*$/i, '')
    .trim();

  const locationCtx = [city, country].filter(Boolean).join(' ');
  const query = `"${cleanName}" ${locationCtx} official website`;

  try {
    const html = await webSearch(query);
    if (html) {
      const urls = extractUrlsFromSearch(html);
      const candidates = [];

      // Collect up to 5 candidate URLs
      for (const url of urls) {
        if (candidates.length >= 5) break;
        if (!SKIP_DOMAINS.has(url) && url.includes('.')) {
          candidates.push(url);
        }
      }

      // Try candidates - verify they belong to this company
      for (const url of candidates) {
        let fullUrl = null;
        try {
          await axios.head(`https://${url}`, { timeout: 4000, headers: { 'User-Agent': randomUA() } });
          fullUrl = `https://${url}`;
        } catch {
          try {
            await axios.head(`https://www.${url}`, { timeout: 4000, headers: { 'User-Agent': randomUA() } });
            fullUrl = `https://www.${url}`;
          } catch {}
        }

        if (fullUrl) {
          // For the first candidate, do a quick verification
          // For other candidates, require higher confidence
          const verification = await verifyWebsite(fullUrl, companyName);
          if (verification.valid) {
            stats.verified_websites = (stats.verified_websites || 0) + 1;
            return fullUrl;
          }
          // First result gets benefit of the doubt if we can't scrape it
          if (candidates.indexOf(url) === 0 && verification.confidence >= 20) {
            return fullUrl;
          }
        }
      }

      // If no verified match, return first working candidate anyway (better than nothing)
      for (const url of candidates) {
        try {
          await axios.head(`https://${url}`, { timeout: 3000, headers: { 'User-Agent': randomUA() } });
          stats.unverified_websites = (stats.unverified_websites || 0) + 1;
          return `https://${url}`;
        } catch {
          try {
            await axios.head(`https://www.${url}`, { timeout: 3000, headers: { 'User-Agent': randomUA() } });
            stats.unverified_websites = (stats.unverified_websites || 0) + 1;
            return `https://www.${url}`;
          } catch {}
        }
      }
    }
  } catch (e) {}

  return null;
}

// ==================== STEP 3: DEEP WEBSITE SCRAPE ====================

async function deepScrapeWebsite(websiteUrl) {
  const result = {
    phones: [],
    emails: [],
    emailFormat: null,
    address: null,
    social: { twitter: null, facebook: null, instagram: null, linkedin: null },
    contacts: [],
    employeeCount: null,
    description: null,
  };

  if (!websiteUrl) return result;

  const baseUrl = websiteUrl.replace(/\/$/, '');
  const domain = getDomain(websiteUrl);
  if (!domain) return result;

  // Scrape multiple pages for maximum data
  const pagesToScrape = [
    baseUrl,
    `${baseUrl}/contact`,
    `${baseUrl}/contact-us`,
    `${baseUrl}/about`,
    `${baseUrl}/about-us`,
    `${baseUrl}/team`,
    `${baseUrl}/our-team`,
    `${baseUrl}/leadership`,
    `${baseUrl}/people`,
  ];

  const allEmails = new Set();
  const allPhones = new Set();
  const allContacts = [];
  const seenContactNames = new Set();

  // Fetch pages in parallel (max 4 at a time)
  for (let i = 0; i < pagesToScrape.length; i += 4) {
    const chunk = pagesToScrape.slice(i, i + 4);
    const responses = await Promise.allSettled(
      chunk.map(url => http.get(url).catch(() => null))
    );

    for (const res of responses) {
      if (res.status !== 'fulfilled' || !res.value?.data) continue;

      const html = res.value.data;
      const $ = cheerio.load(html);
      const bodyText = $('body').text();

      // --- Extract emails ---
      const emailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      for (const email of emailMatches) {
        const lower = email.toLowerCase();
        if (!lower.includes('example') && !lower.includes('test') && !lower.includes('sentry') && !lower.includes('webpack')) {
          allEmails.add(lower);
        }
      }

      // Also check mailto: links
      $('a[href^="mailto:"]').each((_, el) => {
        const href = $(el).attr('href');
        const email = href.replace('mailto:', '').split('?')[0].toLowerCase().trim();
        if (email && email.includes('@') && !email.includes('example')) {
          allEmails.add(email);
        }
      });

      // --- Extract phones ---
      // From tel: links first (most reliable)
      $('a[href^="tel:"]').each((_, el) => {
        const href = $(el).attr('href');
        const phone = href.replace('tel:', '').replace(/[^\d+]/g, '');
        if (phone.length >= 10) allPhones.add(phone);
      });

      // From text patterns
      const phonePatterns = [
        /\+?44[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
        /0\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
        /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g
      ];
      for (const pattern of phonePatterns) {
        const matches = bodyText.match(pattern) || [];
        for (const m of matches) {
          const phone = m.replace(/[^\d+]/g, '');
          if (phone.length >= 10 && phone.length <= 15) allPhones.add(phone);
        }
      }

      // --- Extract social media ---
      const linkedinMatch = html.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/i);
      if (linkedinMatch && !result.social.linkedin) {
        result.social.linkedin = `https://www.linkedin.com/company/${linkedinMatch[1]}`;
      }

      const twitterMatch = html.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/i);
      if (twitterMatch && !['share', 'intent', 'home', 'search'].includes(twitterMatch[1].toLowerCase())) {
        result.social.twitter = `https://twitter.com/${twitterMatch[1]}`;
      }

      const fbMatch = html.match(/facebook\.com\/([a-zA-Z0-9.]+)/i);
      if (fbMatch && !['sharer', 'share', 'dialog', 'plugins'].includes(fbMatch[1].toLowerCase())) {
        result.social.facebook = `https://facebook.com/${fbMatch[1]}`;
      }

      const igMatch = html.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
      if (igMatch && !['p', 'reel', 'stories', 'explore'].includes(igMatch[1].toLowerCase())) {
        result.social.instagram = `https://instagram.com/${igMatch[1]}`;
      }

      // --- Extract contacts (management team) ---
      extractPeopleFromHTML($, bodyText, domain, allContacts, seenContactNames);

      // --- Extract address (UK postcode) ---
      if (!result.address) {
        const postcodeMatch = bodyText.match(/[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i);
        if (postcodeMatch) {
          const idx = bodyText.indexOf(postcodeMatch[0]);
          const context = bodyText.substring(Math.max(0, idx - 120), idx + 20).trim();
          if (context.length > 10 && context.length < 250) {
            result.address = context.replace(/\s+/g, ' ');
          }
        }
      }

      // --- Employee count ---
      if (!result.employeeCount) {
        const empMatch = bodyText.match(/(\d+)\s*(?:\+\s*)?(?:employees|staff|people|team members)/i);
        if (empMatch) {
          const num = parseInt(empMatch[1]);
          if (num > 0 && num < 100000) result.employeeCount = num;
        }
      }
    }
  }

  // Detect email format from found emails
  result.emails = Array.from(allEmails);
  result.phones = Array.from(allPhones);
  result.contacts = allContacts.slice(0, 10);

  // Detect email format
  for (const email of result.emails) {
    const emailDomain = email.split('@')[1];
    if (emailDomain === domain) {
      const local = email.split('@')[0];
      if (GENERIC_EMAIL_PREFIXES.has(local.split('.')[0])) continue;
      if (/^[a-z]+\.[a-z]+$/.test(local)) { result.emailFormat = `{first}.{last}@${domain}`; break; }
      if (/^[a-z]+_[a-z]+$/.test(local)) { result.emailFormat = `{first}_{last}@${domain}`; break; }
      if (/^[a-z]\.[a-z]+$/.test(local)) { result.emailFormat = `{f}.{last}@${domain}`; break; }
      if (/^[a-z][a-z]+$/.test(local) && local.length > 4) { result.emailFormat = `{f}{last}@${domain}`; break; }
      if (/^[a-z]+$/.test(local) && local.length <= 10) { result.emailFormat = `{first}@${domain}`; break; }
    }
  }

  return result;
}

function extractPeopleFromHTML($, bodyText, domain, contacts, seenNames) {
  const selectors = [
    '.team-member', '.staff-member', '.person', '.member',
    '[class*="team"]', '[class*="staff"]', '[class*="people"]',
    '[class*="director"]', '[class*="leader"]', '[class*="partner"]',
    'article', '.card', '.profile'
  ];

  for (const selector of selectors) {
    $(selector).each((i, el) => {
      if (contacts.length >= 10) return false;
      const text = $(el).text();
      const namePattern = /([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]+)?)/g;

      let match;
      while ((match = namePattern.exec(text)) !== null) {
        const firstName = match[1];
        const lastName = match[2].split(/\s+/)[0]; // Take first part of multi-word
        const key = `${firstName} ${lastName}`.toLowerCase();

        if (seenNames.has(key)) continue;
        if (!isValidPersonName(firstName, lastName)) continue;

        // Find job title near the name
        const nameIdx = text.indexOf(match[0]);
        const context = text.substring(nameIdx, Math.min(text.length, nameIdx + 200));
        let jobTitle = null;

        for (const title of MANAGEMENT_TITLES) {
          if (context.toLowerCase().includes(title)) {
            const titleRegex = new RegExp(`([\\w\\s]*${title}[\\w\\s]{0,20})`, 'i');
            const titleMatch = context.match(titleRegex);
            if (titleMatch) {
              jobTitle = titleMatch[1].trim().substring(0, 50);
              jobTitle = jobTitle.split(/\s+/)
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ');
            }
            break;
          }
        }

        // Find email near the name
        let email = null;
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const emailMatches = context.match(emailRegex) || [];
        for (const e of emailMatches) {
          const local = e.split('@')[0].toLowerCase();
          if (!GENERIC_EMAIL_PREFIXES.has(local.split('.')[0])) {
            email = e.toLowerCase();
            break;
          }
        }

        // Validate job title isn't garbage
        if (jobTitle && !isValidJobTitle(jobTitle)) jobTitle = null;

        seenNames.add(key);
        contacts.push({ firstName, lastName, jobTitle, email, phone: null });
      }
    });
  }
}

// ==================== STEP 4: COMPANIES HOUSE (UK) ====================

async function lookupCompaniesHouse(companyName, city) {
  if (!CONFIG.COMPANIES_HOUSE_API_KEY) return { officers: [], status: null };

  try {
    // Search for the company
    const searchResponse = await axios.get(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=5`,
      {
        auth: { username: CONFIG.COMPANIES_HOUSE_API_KEY, password: '' },
        timeout: 8000
      }
    );

    const companies = searchResponse.data.items || [];
    if (companies.length === 0) return { officers: [], status: null };

    // Find best match (prefer matching city)
    let bestMatch = companies[0];
    if (city) {
      const cityLower = city.toLowerCase();
      const cityMatch = companies.find(c =>
        c.address_snippet?.toLowerCase().includes(cityLower)
      );
      if (cityMatch) bestMatch = cityMatch;
    }

    const companyNumber = bestMatch.company_number;
    const companyStatus = bestMatch.company_status;

    // Get officers (directors)
    const officersResponse = await axios.get(
      `https://api.company-information.service.gov.uk/company/${companyNumber}/officers?items_per_page=10`,
      {
        auth: { username: CONFIG.COMPANIES_HOUSE_API_KEY, password: '' },
        timeout: 8000
      }
    );

    const officers = (officersResponse.data.items || [])
      .filter(o => !o.resigned_on) // Only active officers
      .map(o => {
        const nameParts = (o.name || '').split(',').map(s => s.trim());
        let firstName = '', lastName = '';
        if (nameParts.length >= 2) {
          lastName = nameParts[0];
          firstName = nameParts[1].split(/\s+/)[0];
        }
        // Capitalize properly
        firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
        lastName = lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase();

        return {
          firstName,
          lastName,
          jobTitle: o.officer_role === 'director' ? 'Director' :
                    o.officer_role === 'secretary' ? 'Company Secretary' :
                    o.officer_role || 'Officer',
          email: null,
          phone: null
        };
      })
      .filter(o => isValidPersonName(o.firstName, o.lastName));

    return {
      officers,
      status: companyStatus,
      regNumber: companyNumber,
      address: bestMatch.address_snippet
    };
  } catch (e) {
    return { officers: [], status: null };
  }
}

// ==================== STEP 5: GENERATE CONTACT EMAILS ====================

function generateContactEmails(contacts, emailFormat, domain) {
  if (!emailFormat || !domain) return contacts;

  return contacts.map(contact => {
    if (contact.email) return contact; // Already has email

    const first = contact.firstName.toLowerCase();
    const last = contact.lastName.toLowerCase();

    let email = emailFormat
      .replace('{first}', first)
      .replace('{last}', last)
      .replace('{f}', first.charAt(0));

    return { ...contact, email, emailGenerated: true };
  });
}

// ==================== UTILITY ====================

function getDomain(url) {
  if (!url) return null;
  try {
    return url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0];
  } catch { return null; }
}

function isUKCompany(country, city) {
  if (!country) return false;
  const c = country.toLowerCase();
  return c.includes('united kingdom') || c.includes('uk') || c.includes('england') ||
         c.includes('scotland') || c.includes('wales') || c.includes('northern ireland');
}

// ==================== DATABASE ====================

async function getCompaniesToEnrich(limit) {
  // Two-phase approach:
  // Phase 1: Companies WITH websites but missing phone/email/linkedin (quick wins)
  // Phase 2: Companies WITHOUT websites (need full research chain)

  // Phase 1 (80%): Half-enriched — already have website, need remaining fields completed
  // Priority: companies closest to fully complete come first
  const phase1 = await pool.query(`
    SELECT a.account_id, a.company_name, a.website, a.phone_number,
           a.email_format, a.linkedin_url, a.city, a.state_region, a.country,
           a.industry, a.address, a.company_category
    FROM accounts a
    WHERE a.company_name IS NOT NULL AND a.company_name != ''
      AND a.website IS NOT NULL AND a.website != ''
      AND (
        a.phone_number IS NULL OR a.phone_number = ''
        OR a.email_format IS NULL OR a.email_format = ''
        OR a.linkedin_url IS NULL OR a.linkedin_url = ''
      )
      AND (a.updated_at IS NULL OR a.updated_at < NOW() - INTERVAL '24 hours')
    ORDER BY
      -- Most complete companies first (finish them off)
      (CASE WHEN a.phone_number IS NOT NULL AND a.phone_number != '' THEN 3 ELSE 0 END +
       CASE WHEN a.email_format IS NOT NULL AND a.email_format != '' THEN 3 ELSE 0 END +
       CASE WHEN a.linkedin_url IS NOT NULL AND a.linkedin_url != '' THEN 2 ELSE 0 END +
       CASE WHEN a.address IS NOT NULL AND a.address != '' THEN 2 ELSE 0 END +
       CASE WHEN a.industry IS NOT NULL AND a.industry != '' THEN 1 ELSE 0 END +
       CASE WHEN a.city IS NOT NULL AND a.city != '' THEN 1 ELSE 0 END) DESC,
      RANDOM()
    LIMIT $1
  `, [Math.floor(limit * 0.8)]);

  // Phase 2 (20%): Empty — no website yet, needs full research from scratch
  const phase2 = await pool.query(`
    SELECT a.account_id, a.company_name, a.website, a.phone_number,
           a.email_format, a.linkedin_url, a.city, a.state_region, a.country,
           a.industry, a.address, a.company_category
    FROM accounts a
    WHERE a.company_name IS NOT NULL AND a.company_name != ''
      AND (a.website IS NULL OR a.website = '')
      AND (a.updated_at IS NULL OR a.updated_at < NOW() - INTERVAL '24 hours')
    ORDER BY
      -- Among empty companies, prefer those with location data (easier to research)
      (CASE WHEN a.city IS NOT NULL AND a.city != '' THEN 2 ELSE 0 END +
       CASE WHEN a.country IS NOT NULL AND a.country != '' THEN 1 ELSE 0 END) DESC,
      RANDOM()
    LIMIT $1
  `, [Math.floor(limit * 0.2)]);

  const companies = [...phase1.rows, ...phase2.rows];
  console.log(`  Phase 1 half-enriched (80%): ${phase1.rows.length} | Phase 2 empty (20%): ${phase2.rows.length}`);
  return companies;
}

async function saveEnrichmentResults(accountId, data) {
  const updates = [];
  const values = [];
  let idx = 1;

  if (data.website) { updates.push(`website = $${idx++}`); values.push(data.website); }
  if (data.phone) { updates.push(`phone_number = $${idx++}`); values.push(data.phone); }
  if (data.emailFormat) { updates.push(`email_format = $${idx++}`); values.push(data.emailFormat); }
  if (data.linkedinUrl) { updates.push(`linkedin_url = $${idx++}`); values.push(data.linkedinUrl); }
  if (data.address) { updates.push(`address = $${idx++}`); values.push(data.address); }
  if (data.twitter) { updates.push(`twitter_url = $${idx++}`); values.push(data.twitter); }
  if (data.facebook) { updates.push(`facebook_url = $${idx++}`); values.push(data.facebook); }
  if (data.instagram) { updates.push(`instagram_url = $${idx++}`); values.push(data.instagram); }
  if (data.employeeCount) { updates.push(`employee_count = $${idx++}`); values.push(data.employeeCount); }
  if (data.companyStatus) { updates.push(`company_status = $${idx++}`); values.push(data.companyStatus); }

  if (updates.length === 0) return;

  updates.push(`updated_at = NOW()`);
  values.push(accountId);

  await pool.query(
    `UPDATE accounts SET ${updates.join(', ')} WHERE account_id = $${idx}`,
    values
  );
}

async function saveContact(accountId, contact, companyName) {
  try {
    // Final safety net: validate name before saving
    if (!isValidPersonName(contact.firstName, contact.lastName)) return false;

    const exists = await pool.query(
      `SELECT 1 FROM contacts WHERE linked_account_id = $1
       AND LOWER(first_name) = LOWER($2) AND LOWER(last_name) = LOWER($3) LIMIT 1`,
      [accountId, contact.firstName, contact.lastName]
    );
    if (exists.rows.length > 0) return false;

    await pool.query(`
      INSERT INTO contacts (linked_account_id, first_name, last_name, email, phone_number,
        job_title, data_source, verified, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [
      accountId, contact.firstName, contact.lastName,
      contact.email, contact.phone, contact.jobTitle,
      contact.emailGenerated ? 'Smart Pipeline (generated)' : 'Smart Pipeline (scraped)',
      false
    ]);
    return true;
  } catch (e) {
    return false;
  }
}

// ==================== MAIN PIPELINE ====================

async function enrichOneCompany(company) {
  const name = company.company_name;
  const city = company.city;
  const country = company.country;
  const enriched = {};
  let log = [];

  try {
    // ---- STEP 1: Find LinkedIn (if missing) ----
    let linkedinUrl = company.linkedin_url;
    if (!linkedinUrl) {
      linkedinUrl = await findLinkedIn(name, city, country);
      if (linkedinUrl) {
        enriched.linkedinUrl = linkedinUrl;
        stats.linkedin_found++;
        log.push('LinkedIn');
      }
    }

    // ---- STEP 2: Find Website (if missing) ----
    let website = company.website;
    if (!website) {
      // Use LinkedIn URL to help find website
      website = await findWebsite(name, city, country, linkedinUrl);
      if (website) {
        enriched.website = website;
        stats.websites_found++;
        log.push('Website');
      }
    }

    // ---- STEP 3: Deep scrape website ----
    let scrapeData = null;
    if (website) {
      scrapeData = await deepScrapeWebsite(website);

      // Phone
      if (!company.phone_number && scrapeData.phones.length > 0) {
        enriched.phone = scrapeData.phones[0];
        stats.phones_found++;
        log.push('Phone');
      }

      // Email format
      if (!company.email_format && scrapeData.emailFormat) {
        enriched.emailFormat = scrapeData.emailFormat;
        stats.email_formats_found++;
        log.push('Email Format');
      }

      // Address
      if (!company.address && scrapeData.address) {
        enriched.address = scrapeData.address;
      }

      // Social media
      if (scrapeData.social.linkedin && !linkedinUrl) {
        enriched.linkedinUrl = scrapeData.social.linkedin;
        if (!company.linkedin_url) { stats.linkedin_found++; log.push('LinkedIn'); }
      }
      if (scrapeData.social.twitter) enriched.twitter = scrapeData.social.twitter;
      if (scrapeData.social.facebook) enriched.facebook = scrapeData.social.facebook;
      if (scrapeData.social.instagram) enriched.instagram = scrapeData.social.instagram;
      if (scrapeData.social.twitter || scrapeData.social.facebook || scrapeData.social.instagram) {
        stats.social_found++;
        log.push('Social');
      }

      if (scrapeData.employeeCount) enriched.employeeCount = scrapeData.employeeCount;
    }

    // ---- STEP 4: Companies House lookup (UK companies) ----
    let chOfficers = [];
    if (isUKCompany(country, city)) {
      const chData = await lookupCompaniesHouse(name, city);
      if (chData.officers.length > 0) {
        chOfficers = chData.officers;
        stats.directors_found += chOfficers.length;
        log.push(`${chOfficers.length} Directors`);
      }
      if (chData.status) enriched.companyStatus = chData.status;
      if (chData.address && !enriched.address && !company.address) {
        enriched.address = chData.address;
      }
    }

    // ---- STEP 5: Generate contact emails ----
    // Combine contacts from website scraping + Companies House
    let allContacts = [];
    if (scrapeData?.contacts) allContacts.push(...scrapeData.contacts);
    allContacts.push(...chOfficers);

    // Deduplicate by name
    const seen = new Set();
    allContacts = allContacts.filter(c => {
      const key = `${c.firstName} ${c.lastName}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Generate emails for contacts that don't have one
    const emailFormat = enriched.emailFormat || company.email_format;
    const domain = getDomain(website || company.website);
    if (emailFormat && domain) {
      allContacts = generateContactEmails(allContacts, emailFormat, domain);
    }

    // Save contacts
    let contactsSaved = 0;
    for (const contact of allContacts) {
      if (contact.firstName && contact.lastName) {
        const saved = await saveContact(company.account_id, contact, name);
        if (saved) contactsSaved++;
      }
    }
    if (contactsSaved > 0) {
      stats.contacts_found += contactsSaved;
      log.push(`${contactsSaved} Contacts`);
    }

    // ---- Save all enrichment data ----
    await saveEnrichmentResults(company.account_id, enriched);

    // Always mark as attempted so we don't reprocess too soon
    if (Object.keys(enriched).length === 0) {
      await pool.query('UPDATE accounts SET updated_at = NOW() WHERE account_id = $1', [company.account_id]);
    }

    stats.processed++;
    if (log.length > 0) {
      stats.enriched++;
      console.log(`  + ${name}: ${log.join(', ')}`);
    }

  } catch (e) {
    stats.errors++;
    stats.processed++;
    // Still mark as attempted
    try { await pool.query('UPDATE accounts SET updated_at = NOW() WHERE account_id = $1', [company.account_id]); } catch {}
  }
}

// ==================== MAIN LOOP ====================

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000);
  const rate = elapsed > 0 ? (stats.processed / elapsed * 60).toFixed(0) : 0;

  console.log('\n' + '='.repeat(65));
  console.log(`  SMART PIPELINE STATS | ${rate}/min | ${elapsed}s elapsed`);
  console.log('-'.repeat(65));
  console.log(`  Processed: ${stats.processed} | Enriched: ${stats.enriched} | Errors: ${stats.errors}`);
  console.log(`  LinkedIn:  ${stats.linkedin_found} | Websites: ${stats.websites_found} | Phones: ${stats.phones_found}`);
  console.log(`  Email Fmt: ${stats.email_formats_found} | Social: ${stats.social_found}`);
  console.log(`  Contacts:  ${stats.contacts_found} | Directors: ${stats.directors_found}`);
  console.log(`  Domain guessed (no API): ${stats.domain_guessed || 0} | LinkedIn website: ${stats.linkedin_website || 0}`);
  console.log(`  Verified:  ${stats.verified_websites || 0} | Unverified: ${stats.unverified_websites || 0}`);
  console.log('='.repeat(65) + '\n');
}

async function run() {
  console.log('\n' + '='.repeat(65));
  console.log('   SMART ENRICHMENT PIPELINE v3');
  console.log('='.repeat(65));
  console.log('   Research chain:');
  console.log('   1. Domain guessing (zero API calls - fastest)');
  console.log('   2. Name + Location → Find LinkedIn (rotating search engines)');
  console.log('   3. LinkedIn/Search → Find Website (DuckDuckGo + Bing + Brave)');
  console.log('   4. Website → Deep scrape (phone, email, contacts, social)');
  console.log('   5. Companies House → Directors (UK companies)');
  console.log('   6. Email format + Names → Generate contact emails');
  console.log('   Anti-rate-limit: UA rotation, engine rotation, jitter');
  console.log(`   Parallel: ${CONFIG.PARALLEL_COMPANIES} | Batch: ${CONFIG.BATCH_SIZE}`);
  console.log('   Press Ctrl+C to stop\n');

  // Ensure columns exist
  const columns = [
    'quality_score INTEGER', 'linkedin_url VARCHAR(500)',
    'twitter_url VARCHAR(500)', 'facebook_url VARCHAR(500)',
    'instagram_url VARCHAR(500)', 'employee_count INTEGER',
    'company_status VARCHAR(50)', 'data_source VARCHAR(100)'
  ];
  for (const col of columns) {
    try { await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ${col}`); } catch {}
  }

  let batch = 0;

  while (true) {
    batch++;
    console.log(`\n[Batch ${batch}] Loading companies...`);

    try {
      const companies = await getCompaniesToEnrich(CONFIG.BATCH_SIZE);

      if (companies.length === 0) {
        console.log('  All companies enriched! Waiting 2 min...');
        await new Promise(r => setTimeout(r, 120000));
        continue;
      }

      console.log(`  Processing ${companies.length} companies...\n`);

      // Process in parallel chunks
      for (let i = 0; i < companies.length; i += CONFIG.PARALLEL_COMPANIES) {
        const chunk = companies.slice(i, i + CONFIG.PARALLEL_COMPANIES);
        await Promise.all(chunk.map(c => enrichOneCompany(c)));
      }

      if (batch % 3 === 0) printStats();

      await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_BATCHES));

    } catch (e) {
      console.error(`[Error] ${e.message}`);
      stats.errors++;
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n');
  printStats();
  console.log('Pipeline stopped.');
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
