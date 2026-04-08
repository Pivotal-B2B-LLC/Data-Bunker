#!/usr/bin/env node

/**
 * AGENT: WEBSITE FINDER
 *
 * Finds websites for companies that don't have them
 * Uses: Google search, DuckDuckGo, Bing
 *
 * This is CRITICAL - without websites, other agents can't work!
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

const AGENT_NAME = 'WEBSITE-FINDER';
const TURBO = require('./turbo-config');
const CONFIG = {
  ...TURBO.WEBSITE || { BATCH_SIZE: 100, PARALLEL: 20, DELAY: 500 },
  GOOGLE_API_KEY: process.env.GOOGLE_PLACES_API_KEY || null,
  GOOGLE_CX: process.env.GOOGLE_CUSTOM_SEARCH_CX || null,
};

// Log Google Custom Search status
if (CONFIG.GOOGLE_API_KEY && CONFIG.GOOGLE_CX) {
  console.log('  Google Custom Search: ENABLED');
} else {
  console.log('  Google Custom Search: DISABLED (missing key or CX)');
}

const http = axios.create({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
});

let stats = {
  processed: 0,
  found: 0,
  errors: 0,
  start: Date.now()
};

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${AGENT_NAME}] ${msg}`);
}

function cleanWebsite(url) {
  if (!url) return null;

  // Skip social media, directories, and generic sites
  const skipDomains = [
    // Social media
    'facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com',
    'youtube.com', 'tiktok.com', 'tumblr.com', 'pinterest.com',
    // Directories & reviews
    'yell.com', 'thomsonlocal.com', 'yelp.com', 'tripadvisor.com',
    'trustpilot.com', 'glassdoor.com', 'indeed.com', 'crunchbase.com',
    // Search & tech giants
    'google.', 'bing.com', 'yahoo.com', 'amazon.', 'ebay.com', 'apple.com',
    'microsoft.com', 'support.microsoft.com', 'oracle.com', 'adobe.com',
    // Government & reference
    'gov.uk', 'gov.sa', 'wikipedia.org', 'britannica.com', 'companies-house.gov.uk',
    // International noise
    'zhihu.com', 'baidu.com', 'jingyan.baidu.com', 'zhidao.baidu.com',
    'baby-kingdom.com', 'esyoil.com', 'ccm.net', 'forumfree.it',
    'huispedia.nl', 'godzinyotwarcia', 'rbb24.de', 'volkswagen-net.de',
    'de.ccm.net', 'ivolta.pl', 'njd.forumfree',
    // Reference & dictionaries
    'collinsdictionary.com', 'wordreference.com', 'urbandictionary.com',
    'coinmarketcap.com', 'transfermarkt.com',
    // Forums & Q&A
    'forum.', 'reddit.com', 'quora.com', 'stackoverflow.com',
    // News
    'bbc.com', 'bbc.co.uk', 'theguardian.com', 'telegraph.co.uk',
    'dailymail.co.uk', 'mirror.co.uk', 'independent.co.uk', 'news.',
    // Hosting & blogging
    'blogspot.com', 'wordpress.com', 'wix.com', 'weebly.com', 'medium.com',
    'github.com', 'gitlab.com',
    // Famous brands that cause false positives
    'gemini.com', 'progressive.com', 'littlealchemy.com', 'virgin.com',
    'sky.com', 'bt.com', 'vodafone.com', 'tesco.com', 'asda.com',
    'sainsburys.co.uk', 'boots.com', 'argos.co.uk', 'currys.co.uk',
    'barclays.co.uk', 'hsbc.co.uk', 'lloydsbank.com', 'natwest.com',
    // Other
    'wiki.', '.edu', 'my.gov', 'xnxx'
  ];

  const lower = url.toLowerCase();
  for (const skip of skipDomains) {
    if (lower.includes(skip)) return null;
  }

  // Must not contain special chars that indicate it's not a URL
  if (url.includes('›') || url.includes('>') || url.includes(' ')) return null;

  // Extract domain properly
  let clean = url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];

  if (!clean.includes('.') || clean.length < 5) return null;

  // Must end with valid UK/common TLD
  const validTLDs = ['.co.uk', '.org.uk', '.uk', '.com', '.org', '.net', '.io', '.biz', '.eu'];
  const hasValidTLD = validTLDs.some(tld => clean.toLowerCase().endsWith(tld));
  if (!hasValidTLD) return null;

  // Must not be too long (probably not a real domain)
  if (clean.length > 50) return null;

  // Validate it looks like a domain (letters, numbers, hyphens, dots only)
  if (!/^[a-zA-Z0-9.-]+$/.test(clean)) return null;

  return `https://www.${clean}`;
}

async function searchDuckDuckGo(companyName, city) {
  try {
    const query = `"${companyName}" ${city || 'UK'} official website`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await http.get(url);
    const $ = cheerio.load(response.data);

    let website = null;

    $('.result__url').each((i, el) => {
      if (website) return false;
      const href = $(el).attr('href') || $(el).text();
      const cleaned = cleanWebsite(href);
      if (cleaned) {
        website = cleaned;
        return false;
      }
    });

    return website;
  } catch (e) {
    return null;
  }
}

async function searchBing(companyName, city) {
  try {
    const query = `"${companyName}" ${city || 'UK'} official site`;
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    const response = await http.get(url);
    const $ = cheerio.load(response.data);

    let website = null;

    $('cite').each((i, el) => {
      if (website) return false;
      const text = $(el).text();
      const cleaned = cleanWebsite(text);
      if (cleaned) {
        website = cleaned;
        return false;
      }
    });

    return website;
  } catch (e) {
    return null;
  }
}

// Google Custom Search API (100 free queries/day, most accurate)
async function searchGoogleCustom(companyName, city) {
  if (!CONFIG.GOOGLE_API_KEY || !CONFIG.GOOGLE_CX) return null;

  try {
    const query = `"${companyName}" ${city || 'UK'} official website`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${CONFIG.GOOGLE_API_KEY}&cx=${CONFIG.GOOGLE_CX}&q=${encodeURIComponent(query)}&num=5`;
    const response = await http.get(url);

    if (response.data.items && response.data.items.length > 0) {
      for (const item of response.data.items) {
        const cleaned = cleanWebsite(item.link);
        if (cleaned) {
          return cleaned;
        }
      }
    }
    return null;
  } catch (e) {
    // Quota exceeded or other error - fail silently
    return null;
  }
}

function domainMatchesCompany(domain, companyName) {
  if (!domain || !companyName) return false;

  // Extract just the domain name (no TLD)
  const domainOnly = domain.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('.')[0];

  // Famous companies/brands we should never match (common false positives)
  const famousBrands = [
    'gemini', 'progressive', 'little', 'apple', 'amazon', 'google', 'microsoft',
    'facebook', 'twitter', 'oracle', 'adobe', 'cisco', 'intel', 'dell',
    'samsung', 'sony', 'panasonic', 'philips', 'siemens', 'bosch',
    'virgin', 'barclays', 'hsbc', 'lloyds', 'natwest', 'santander',
    'vodafone', 'bt', 'sky', 'tesco', 'asda', 'sainsbury', 'morrisons',
    'boots', 'superdrug', 'argos', 'currys', 'halfords',
    'taylorswift', 'spotify', 'netflix', 'uber', 'airbnb', 'paypal',
    'stripe', 'shopify', 'slack', 'zoom', 'dropbox', 'salesforce'
  ];

  // If domain is a famous brand, require exact company name match
  if (famousBrands.includes(domainOnly)) {
    const cleanCompany = companyName.toLowerCase()
      .replace(/\s+(ltd|limited|llp|plc|inc|uk|holdings|group|services|solutions)\.?$/gi, '')
      .trim();
    // Must be an exact match or close
    return domainOnly === cleanCompany.replace(/[^a-z0-9]/g, '');
  }

  // Extract keywords from company name (remove common suffixes)
  const cleanName = companyName.toLowerCase()
    .replace(/\s+(ltd|limited|llp|plc|inc|uk|holdings|group|services|solutions|consulting|partners|associates)\.?$/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();

  const keywords = cleanName.split(/\s+/).filter(w => w.length > 2);

  // Count how many significant keywords match
  let matches = 0;
  for (const keyword of keywords) {
    if (keyword.length >= 4 && domainOnly.includes(keyword)) {
      matches++;
    }
  }

  // For single-word company names, require exact domain match
  if (keywords.length === 1) {
    return domainOnly === keywords[0] || domainOnly.startsWith(keywords[0]);
  }

  // For multi-word names, require at least 1 match AND domain should be related
  // Domain should contain company's main identifier
  if (matches >= 1) {
    // Check the domain is specific to this company (not too generic)
    if (domainOnly.length >= 5 && domainOnly.length <= 25) {
      return true;
    }
  }

  return false;
}

async function findWebsite(company) {
  let website = null;

  // Try Google Custom Search first (most accurate, but limited to 100/day)
  website = await searchGoogleCustom(company.company_name, company.city);
  if (website && domainMatchesCompany(website, company.company_name)) {
    return website;
  }

  // Try DuckDuckGo as fallback
  website = await searchDuckDuckGo(company.company_name, company.city);
  if (website && domainMatchesCompany(website, company.company_name)) {
    return website;
  }

  // Try Bing as last resort
  website = await searchBing(company.company_name, company.city);
  if (website && domainMatchesCompany(website, company.company_name)) {
    return website;
  }

  return null;
}

async function getCompaniesWithoutWebsite() {
  const result = await pool.query(`
    SELECT account_id, company_name, city
    FROM accounts
    WHERE (website IS NULL OR website = '')
    AND company_name IS NOT NULL
    AND LENGTH(company_name) > 3
    ORDER BY
      -- Prioritize half-enriched: companies that already have other data
      (CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 4 ELSE 0 END +
       CASE WHEN email_format IS NOT NULL AND email_format != '' THEN 4 ELSE 0 END +
       CASE WHEN linkedin_url IS NOT NULL AND linkedin_url != '' THEN 3 ELSE 0 END +
       CASE WHEN city IS NOT NULL AND city != '' THEN 2 ELSE 0 END +
       CASE WHEN industry IS NOT NULL AND industry != '' THEN 1 ELSE 0 END +
       CASE WHEN country IS NOT NULL AND country != '' THEN 1 ELSE 0 END) DESC,
      RANDOM()
    LIMIT $1
  `, [CONFIG.BATCH_SIZE]);
  return result.rows;
}

async function updateWebsite(accountId, website) {
  await pool.query(
    'UPDATE accounts SET website = $1, updated_at = NOW() WHERE account_id = $2',
    [website, accountId]
  );
}

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000 / 60);
  const rate = stats.processed > 0 ? (stats.found / stats.processed * 100).toFixed(1) : 0;
  log('');
  log('='.repeat(50));
  log(`STATS after ${elapsed} minutes:`);
  log(`  Processed: ${stats.processed}`);
  log(`  Websites found: ${stats.found} (${rate}% success)`);
  log(`  Errors: ${stats.errors}`);
  log('='.repeat(50));
  log('');
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log(`   AGENT: ${AGENT_NAME}`);
  console.log('='.repeat(60));
  console.log('   Finds websites for companies without them');
  console.log('   Sources: DuckDuckGo, Bing');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    log(`Batch ${batch}: Loading companies without websites...`);

    try {
      const companies = await getCompaniesWithoutWebsite();

      if (companies.length === 0) {
        log('All companies have websites. Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      log(`Processing ${companies.length} companies...`);

      for (let i = 0; i < companies.length; i += CONFIG.PARALLEL) {
        const chunk = companies.slice(i, i + CONFIG.PARALLEL);

        const results = await Promise.all(chunk.map(async (company) => {
          try {
            const website = await findWebsite(company);
            stats.processed++;

            if (website) {
              await updateWebsite(company.account_id, website);
              stats.found++;
              return { company, website };
            }
            return { company, website: null };
          } catch (e) {
            stats.errors++;
            return { company, website: null };
          }
        }));

        for (const r of results) {
          if (r.website) {
            log(`  + ${r.company.company_name}: ${r.website}`);
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
