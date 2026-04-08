#!/usr/bin/env node

/**
 * AGENT: COMPANY DISCOVERY
 *
 * Finds real UK companies from multiple sources:
 * - Google Places API (if available)
 * - OpenStreetMap
 * - Yell.com scraping
 * - Thomson Local scraping
 *
 * Runs continuously, discovering new companies
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');
const ollama = require('../../src/services/ollamaService');

const AGENT_NAME = 'COMPANY-DISCOVERY';
const CONFIG = {
  BATCH_SIZE: 30,
  DELAY_BETWEEN_SEARCHES: 1500,  // Faster! (was 3000)
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY || null,
};

// Log if Google Places is available
if (CONFIG.GOOGLE_PLACES_API_KEY) {
  console.log('  Google Places API: ENABLED');
} else {
  console.log('  Google Places API: DISABLED (no key)');
}

// UK Cities to search
const UK_CITIES = [
  'London', 'Birmingham', 'Manchester', 'Leeds', 'Glasgow', 'Liverpool',
  'Newcastle', 'Sheffield', 'Bristol', 'Edinburgh', 'Cardiff', 'Belfast',
  'Nottingham', 'Southampton', 'Leicester', 'Coventry', 'Bradford', 'Stoke',
  'Wolverhampton', 'Plymouth', 'Reading', 'Derby', 'Swansea', 'Aberdeen',
  'Cambridge', 'Oxford', 'York', 'Bath', 'Brighton', 'Bournemouth'
];

// Business categories to search - EXPANDED
const BUSINESS_CATEGORIES = [
  // Tech
  'software company', 'IT services', 'web development', 'app development',
  'cybersecurity company', 'data analytics company', 'cloud services',
  // Professional Services
  'law firm', 'solicitors', 'accounting firm', 'consulting company',
  'management consulting', 'HR consulting', 'business consulting',
  // Marketing & Creative
  'marketing agency', 'digital marketing', 'advertising agency',
  'design agency', 'PR agency', 'branding agency', 'SEO agency',
  // Finance
  'financial services', 'investment firm', 'insurance company',
  'wealth management', 'mortgage broker', 'fintech company',
  // Property & Construction
  'real estate agency', 'property management', 'construction company',
  'architecture firm', 'interior design', 'civil engineering',
  // Healthcare
  'healthcare company', 'pharmaceutical', 'medical device company',
  'dental practice', 'private clinic', 'care home',
  // Manufacturing & Logistics
  'manufacturing company', 'engineering company', 'logistics company',
  'freight company', 'warehouse company', 'distribution company',
  // Recruitment & HR
  'recruitment agency', 'staffing agency', 'executive search',
  // Other B2B
  'training company', 'event management', 'catering company',
  'cleaning company', 'security company', 'facilities management'
];

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
});

let stats = {
  discovered: 0,
  duplicates: 0,
  saved: 0,
  errors: 0,
  start: Date.now()
};

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${AGENT_NAME}] ${msg}`);
}

function cleanCompanyName(name) {
  if (!name) return null;
  return name
    .replace(/\s+(Ltd|Limited|LLP|PLC|Inc|LLC)\.?$/i, '')
    .replace(/[^\w\s&'-]/g, '')
    .trim();
}

function cleanWebsite(url) {
  if (!url) return null;
  let clean = url.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];
  if (!clean.includes('.')) return null;
  return `https://www.${clean}`;
}

async function companyExists(name, website) {
  const result = await pool.query(`
    SELECT 1 FROM accounts
    WHERE LOWER(company_name) = LOWER($1)
    OR (website IS NOT NULL AND website ILIKE $2)
    LIMIT 1
  `, [name, `%${website?.replace('https://www.', '')}%`]);
  return result.rows.length > 0;
}

async function saveCompany(company) {
  try {
    if (!company.name || company.name.length < 3) return false;

    const exists = await companyExists(company.name, company.website);
    if (exists) {
      stats.duplicates++;
      return false;
    }

    await pool.query(`
      INSERT INTO accounts (company_name, website, phone_number, address, city, industry, data_source, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      company.name,
      company.website,
      company.phone,
      company.address,
      company.city,
      company.industry,
      'Agent:Discovery'
    ]);

    stats.saved++;
    return true;
  } catch (e) {
    stats.errors++;
    return false;
  }
}

// Search via Yell.com
async function searchYell(category, city) {
  const companies = [];
  try {
    const url = `https://www.yell.com/ucs/UcsSearchAction.do?keywords=${encodeURIComponent(category)}&location=${encodeURIComponent(city)}`;
    const response = await http.get(url);
    const $ = cheerio.load(response.data);

    $('.businessCapsule').each((i, el) => {
      if (companies.length >= CONFIG.BATCH_SIZE) return false;

      const name = $(el).find('.businessCapsule--name').text().trim();
      const website = $(el).find('a[href*="http"]').attr('href');
      const phone = $(el).find('.businessCapsule--phone').text().trim();
      const address = $(el).find('.businessCapsule--address').text().trim();

      if (name && name.length > 2) {
        companies.push({
          name: cleanCompanyName(name),
          website: cleanWebsite(website),
          phone: phone || null,
          address: address || null,
          city,
          industry: category
        });
      }
    });
  } catch (e) {
    // Ignore errors
  }
  return companies;
}

// Search via Google Places API (if key available) - TURBO VERSION
async function searchGooglePlaces(category, city) {
  if (!CONFIG.GOOGLE_PLACES_API_KEY) return [];

  const companies = [];
  try {
    const query = `${category} in ${city}, UK`;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${CONFIG.GOOGLE_PLACES_API_KEY}`;
    const response = await http.get(url);

    // Process results in parallel for speed
    const detailPromises = (response.data.results || []).slice(0, 20).map(async (place) => {
      try {
        // Get details including website and phone
        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=website,formatted_phone_number,international_phone_number&key=${CONFIG.GOOGLE_PLACES_API_KEY}`;
        const details = await http.get(detailsUrl);
        const result = details.data.result || {};

        return {
          name: cleanCompanyName(place.name),
          website: cleanWebsite(result.website),
          phone: result.formatted_phone_number || result.international_phone_number || null,
          address: place.formatted_address,
          city,
          industry: category
        };
      } catch (e) {
        return {
          name: cleanCompanyName(place.name),
          website: null,
          phone: null,
          address: place.formatted_address,
          city,
          industry: category
        };
      }
    });

    const results = await Promise.all(detailPromises);
    companies.push(...results.filter(c => c.name));

    // Get next page if available (more results)
    if (response.data.next_page_token && companies.length < 40) {
      await new Promise(r => setTimeout(r, 2000)); // Google requires delay before next page
      try {
        const nextUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${response.data.next_page_token}&key=${CONFIG.GOOGLE_PLACES_API_KEY}`;
        const nextResponse = await http.get(nextUrl);
        for (const place of (nextResponse.data.results || []).slice(0, 10)) {
          companies.push({
            name: cleanCompanyName(place.name),
            website: null,
            phone: null,
            address: place.formatted_address,
            city,
            industry: category
          });
        }
      } catch (e) {}
    }

  } catch (e) {
    log(`Google Places error: ${e.message}`);
  }
  return companies;
}

// Search via DuckDuckGo (free, no API key)
async function searchDuckDuckGo(category, city) {
  const companies = [];
  try {
    const query = `${category} companies ${city} UK site:linkedin.com/company`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await http.get(url);
    const $ = cheerio.load(response.data);

    $('.result').each((i, el) => {
      if (companies.length >= 10) return false;

      const title = $(el).find('.result__title').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();

      // Extract company name from LinkedIn title
      const match = title.match(/^([^|–-]+)/);
      if (match) {
        const name = match[1].trim().replace(/ - LinkedIn$/, '').replace(/\s*\|.*$/, '');
        if (name.length > 3 && !name.toLowerCase().includes('linkedin')) {
          companies.push({
            name: cleanCompanyName(name),
            website: null,
            phone: null,
            address: null,
            city,
            industry: category
          });
        }
      }
    });
  } catch (e) {
    // Ignore errors
  }
  return companies;
}

async function discoverCompanies() {
  // Pick random city and category
  const city = UK_CITIES[Math.floor(Math.random() * UK_CITIES.length)];
  let category = BUSINESS_CATEGORIES[Math.floor(Math.random() * BUSINESS_CATEGORIES.length)];

  // Every 5th run, ask Llama 3.2 to generate a fresh search query
  if (Math.random() < 0.2) {
    try {
      const llmQueries = await ollama.generateDiscoveryQueries(city, 'UK', category);
      if (llmQueries && llmQueries.length > 0) {
        category = llmQueries[Math.floor(Math.random() * llmQueries.length)];
        log(`[LLM] Generated search query: "${category}"`);
      }
    } catch {
      // Fall back to static category
    }
  }

  log(`Searching: "${category}" in ${city}`);

  const allCompanies = [];

  // Try multiple sources
  const [yellResults, ddgResults, googleResults] = await Promise.allSettled([
    searchYell(category, city),
    searchDuckDuckGo(category, city),
    searchGooglePlaces(category, city)
  ]);

  if (yellResults.status === 'fulfilled') allCompanies.push(...yellResults.value);
  if (ddgResults.status === 'fulfilled') allCompanies.push(...ddgResults.value);
  if (googleResults.status === 'fulfilled') allCompanies.push(...googleResults.value);

  stats.discovered += allCompanies.length;

  // Save unique companies
  let saved = 0;
  for (const company of allCompanies) {
    const wasSaved = await saveCompany(company);
    if (wasSaved) {
      saved++;
      log(`  + ${company.name} (${company.city})`);
    }
  }

  if (saved > 0) {
    log(`  Saved ${saved} new companies from ${city}`);
  }
}

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000 / 60);
  log('');
  log('='.repeat(50));
  log(`STATS after ${elapsed} minutes:`);
  log(`  Discovered: ${stats.discovered}`);
  log(`  Saved: ${stats.saved}`);
  log(`  Duplicates: ${stats.duplicates}`);
  log(`  Errors: ${stats.errors}`);
  log('='.repeat(50));
  log('');
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log(`   AGENT: ${AGENT_NAME}`);
  console.log('='.repeat(60));
  console.log('   Discovers real UK companies from multiple sources');
  console.log('   Sources: Yell.com, DuckDuckGo, Google Places');
  console.log('   Press Ctrl+C to stop\n');

  let cycle = 0;

  while (true) {
    cycle++;

    try {
      await discoverCompanies();

      if (cycle % 10 === 0) printStats();

      await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_SEARCHES));
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
