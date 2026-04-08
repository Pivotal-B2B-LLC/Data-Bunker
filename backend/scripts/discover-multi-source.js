#!/usr/bin/env node

/**
 * MULTI-SOURCE COMPANY DISCOVERY v1
 *
 * Goes BEYOND OpenStreetMap to find companies from multiple free sources:
 *
 * 1. Wikidata SPARQL - Companies with structured data (HQ, industry, website)
 * 2. OpenCorporates - Free company registry search (100 per day free)
 * 3. Google Places API - Nearby business search (you have API key)
 * 4. FSA Food Hygiene - UK food businesses (100% free, no limit)
 * 5. Charity Commission - UK charities (free API)
 * 6. SEC EDGAR - US public companies (free, unlimited)
 * 7. Yellow Pages scraping - Business directories
 * 8. Industry directory scraping - Sector-specific listings
 *
 * All FREE. No payment required.
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

// ==================== CONFIG ====================
const CONFIG = {
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY || '',
  PARALLEL_SOURCES: 3,
  DELAY_BETWEEN_SAVES: 50,
  BATCH_PAUSE: 5000,
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const http = axios.create({ timeout: 15000, maxRedirects: 5 });
http.interceptors.request.use(config => {
  if (!config.headers['User-Agent']) config.headers['User-Agent'] = randomUA();
  return config;
});

let stats = {
  total_found: 0, total_saved: 0, duplicates: 0, errors: 0,
  by_source: {},
  start: Date.now()
};

// ==================== SAVE COMPANY ====================

async function saveCompany(company) {
  if (!company.name || company.name.length < 2) return false;

  try {
    // Check for duplicate
    const exists = await pool.query(
      `SELECT 1 FROM accounts WHERE LOWER(company_name) = LOWER($1)
       AND (LOWER(city) = LOWER($2) OR ($2 IS NULL AND city IS NULL))
       LIMIT 1`,
      [company.name.substring(0, 255), company.city || null]
    );

    if (exists.rows.length > 0) {
      stats.duplicates++;
      return false;
    }

    await pool.query(`
      INSERT INTO accounts (
        company_name, website, phone_number, city, state_region, country,
        industry, address, company_category, data_source, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      company.name.substring(0, 255),
      company.website || null,
      company.phone || null,
      company.city || null,
      company.state || null,
      company.country || null,
      company.industry || null,
      company.address || null,
      company.category || null,
      company.source || 'Multi-Source Discovery'
    ]);

    stats.total_saved++;
    stats.by_source[company.source] = (stats.by_source[company.source] || 0) + 1;
    return true;
  } catch (e) {
    if (!e.message.includes('duplicate')) stats.errors++;
    return false;
  }
}

// ==================== SOURCE 1: WIKIDATA SPARQL ====================
// Find companies with headquarters, websites, industries - fully structured

async function discoverFromWikidata(country, offset = 0) {
  const countryMap = {
    'United Kingdom': 'Q145', 'United States': 'Q30', 'Canada': 'Q16',
    'Australia': 'Q408', 'Germany': 'Q183', 'France': 'Q142',
    'India': 'Q668', 'Japan': 'Q17', 'Brazil': 'Q155', 'Mexico': 'Q96',
    'Italy': 'Q38', 'Spain': 'Q29', 'Netherlands': 'Q55', 'Sweden': 'Q34',
    'Switzerland': 'Q39', 'Ireland': 'Q27', 'New Zealand': 'Q664',
    'South Africa': 'Q258', 'Singapore': 'Q334', 'UAE': 'Q878',
  };

  const countryId = countryMap[country];
  if (!countryId) return [];

  const query = `
    SELECT ?company ?companyLabel ?website ?hqLabel ?industryLabel ?inception WHERE {
      ?company wdt:P31/wdt:P279* wd:Q4830453.
      ?company wdt:P17 wd:${countryId}.
      OPTIONAL { ?company wdt:P856 ?website. }
      OPTIONAL { ?company wdt:P159 ?hq. }
      OPTIONAL { ?company wdt:P452 ?industry. }
      OPTIONAL { ?company wdt:P571 ?inception. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 500
    OFFSET ${offset}
  `;

  try {
    const response = await http.get('https://query.wikidata.org/sparql', {
      params: { query, format: 'json' },
      headers: { 'User-Agent': 'DataBunker/1.0 (business research)', 'Accept': 'application/json' }
    });

    const results = response.data.results?.bindings || [];
    const companies = [];

    for (const r of results) {
      const name = r.companyLabel?.value;
      if (!name || name.startsWith('Q')) continue; // Skip unresolved Wikidata IDs

      companies.push({
        name,
        website: r.website?.value || null,
        city: r.hqLabel?.value || null,
        country,
        industry: r.industryLabel?.value || null,
        source: 'Wikidata'
      });
    }

    return companies;
  } catch (e) {
    console.log(`  [Wikidata] Error for ${country}: ${e.message}`);
    return [];
  }
}

// ==================== SOURCE 2: FSA FOOD HYGIENE (UK) ====================
// UK Food Standards Agency - ALL registered food businesses, 100% free

async function discoverFromFSA(pageNum = 1, pageSize = 100) {
  try {
    const response = await http.get('https://api.ratings.food.gov.uk/Establishments', {
      params: {
        pageNumber: pageNum,
        pageSize,
        sortOptionKey: 'rating',
        isAscending: false
      },
      headers: {
        'x-api-version': '2',
        'Accept': 'application/json'
      }
    });

    const establishments = response.data.establishments || [];
    const companies = [];

    for (const est of establishments) {
      if (!est.BusinessName || est.BusinessName === 'REMOVED') continue;

      const address = [
        est.AddressLine1, est.AddressLine2, est.AddressLine3, est.AddressLine4
      ].filter(Boolean).join(', ');

      companies.push({
        name: est.BusinessName,
        city: est.LocalAuthorityName || null,
        state: est.AddressLine3 || est.AddressLine4 || null,
        country: 'United Kingdom',
        address: address || null,
        industry: est.BusinessType || 'Food & Beverage',
        category: est.BusinessType || null,
        phone: null,
        source: 'FSA Food Hygiene'
      });
    }

    return { companies, totalPages: Math.ceil((response.data.meta?.totalCount || 0) / pageSize) };
  } catch (e) {
    console.log(`  [FSA] Error: ${e.message}`);
    return { companies: [], totalPages: 0 };
  }
}

// ==================== SOURCE 3: SEC EDGAR (US Public Companies) ====================
// Free, unlimited - all US public company filings

async function discoverFromSEC(offset = 0) {
  try {
    const response = await http.get('https://efts.sec.gov/LATEST/search-index?q=*&dateRange=custom&startdt=2024-01-01&enddt=2026-12-31&forms=10-K', {
      headers: { 'User-Agent': 'DataBunker research@databunker.io', 'Accept': 'application/json' },
      timeout: 15000
    });

    // Alternative: use the full company list
    const companyResponse = await http.get('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'DataBunker research@databunker.io' }
    });

    const tickers = companyResponse.data;
    const companies = [];

    for (const key of Object.keys(tickers).slice(offset, offset + 500)) {
      const t = tickers[key];
      if (!t.title) continue;

      companies.push({
        name: t.title,
        country: 'United States',
        industry: 'Public Company',
        category: `Ticker: ${t.ticker}`,
        source: 'SEC EDGAR'
      });
    }

    return companies;
  } catch (e) {
    console.log(`  [SEC] Error: ${e.message}`);
    return [];
  }
}

// ==================== SOURCE 4: GOOGLE PLACES API ====================
// Uses your API key - find businesses by type + location

async function discoverFromGooglePlaces(location, type) {
  if (!CONFIG.GOOGLE_PLACES_API_KEY) return [];

  const typeMap = {
    'accounting': 'accounting', 'lawyer': 'lawyer', 'dentist': 'dentist',
    'doctor': 'doctor', 'electrician': 'electrician', 'plumber': 'plumber',
    'real_estate_agency': 'real_estate_agency', 'restaurant': 'restaurant',
    'store': 'store', 'gym': 'gym', 'spa': 'spa', 'veterinary_care': 'veterinary_care',
    'car_repair': 'car_repair', 'insurance_agency': 'insurance_agency',
    'travel_agency': 'travel_agency', 'bank': 'bank', 'pharmacy': 'pharmacy',
    'hospital': 'hospital', 'lodging': 'lodging', 'cafe': 'cafe', 'bar': 'bar',
  };

  try {
    // Geocode the location first
    const geoResponse = await http.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: location, key: CONFIG.GOOGLE_PLACES_API_KEY }
    });

    const geoResult = geoResponse.data.results?.[0];
    if (!geoResult) return [];

    const { lat, lng } = geoResult.geometry.location;

    // Search for businesses
    const searchResponse = await http.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
      params: {
        location: `${lat},${lng}`,
        radius: 10000, // 10km radius
        type: typeMap[type] || type,
        key: CONFIG.GOOGLE_PLACES_API_KEY
      }
    });

    const places = searchResponse.data.results || [];
    const companies = [];

    for (const place of places) {
      if (!place.name) continue;

      // Extract city from address components
      const addressParts = (place.vicinity || '').split(',');
      const city = addressParts[addressParts.length - 1]?.trim() || null;

      companies.push({
        name: place.name,
        address: place.vicinity || null,
        city,
        country: location.split(',').pop()?.trim() || null,
        category: type,
        industry: type.replace(/_/g, ' '),
        source: 'Google Places'
      });
    }

    // Handle pagination (next_page_token)
    if (searchResponse.data.next_page_token) {
      await new Promise(r => setTimeout(r, 2000)); // Google requires 2s delay
      try {
        const page2 = await http.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
          params: { pagetoken: searchResponse.data.next_page_token, key: CONFIG.GOOGLE_PLACES_API_KEY }
        });
        for (const place of (page2.data.results || [])) {
          if (!place.name) continue;
          const addressParts = (place.vicinity || '').split(',');
          companies.push({
            name: place.name,
            address: place.vicinity || null,
            city: addressParts[addressParts.length - 1]?.trim() || null,
            country: location.split(',').pop()?.trim() || null,
            category: type, industry: type.replace(/_/g, ' '),
            source: 'Google Places'
          });
        }
      } catch {}
    }

    return companies;
  } catch (e) {
    console.log(`  [Google Places] Error: ${e.message}`);
    return [];
  }
}

// ==================== SOURCE 5: UK CHARITY COMMISSION ====================

async function discoverFromCharities(searchTerm, page = 0) {
  try {
    const response = await http.get('https://api.charitycommission.gov.uk/register/api/allcharitydetailsV2', {
      params: { searchText: searchTerm, pageNumber: page, pageSize: 50 },
      headers: { 'Accept': 'application/json' },
      timeout: 10000
    });

    const charities = response.data || [];
    return charities.map(c => ({
      name: c.charity_name || c.CharityName,
      city: c.address?.town || null,
      state: c.address?.county || null,
      country: 'United Kingdom',
      address: [c.address?.line1, c.address?.line2, c.address?.town, c.address?.postcode].filter(Boolean).join(', '),
      industry: 'Charity / Non-Profit',
      category: c.charity_classification || 'Charity',
      source: 'UK Charity Commission'
    })).filter(c => c.name);
  } catch (e) {
    // Try alternative API endpoint
    try {
      const response = await http.get(`https://api.charitycommission.gov.uk/register/api/searchCharities?searchText=${encodeURIComponent(searchTerm)}&page=${page}&pageSize=50`, {
        headers: { 'Accept': 'application/json' }
      });
      return (response.data?.charities || []).map(c => ({
        name: c.name, city: null, country: 'United Kingdom',
        industry: 'Charity / Non-Profit', source: 'UK Charity Commission'
      })).filter(c => c.name);
    } catch { return []; }
  }
}

// ==================== SOURCE 6: DIRECTORY SCRAPING ====================
// Scrape free business directories for company listings

async function discoverFromYellowPages(location, category) {
  try {
    const url = `https://www.yell.com/ucs/UcsSearchAction.do?scrambleSeed=&keywords=${encodeURIComponent(category)}&location=${encodeURIComponent(location)}`;

    const response = await http.get(url, {
      headers: { 'User-Agent': randomUA(), 'Accept': 'text/html' }
    });

    const $ = cheerio.load(response.data);
    const companies = [];

    $('.businessCapsule--mainRow').each((i, el) => {
      const name = $(el).find('.businessCapsule--name').text().trim();
      const phone = $(el).find('.businessCapsule--phone a').text().trim();
      const address = $(el).find('.businessCapsule--address').text().trim();
      const website = $(el).find('.businessCapsule--callToAction a[data-tracking="website"]').attr('href');

      if (name) {
        companies.push({
          name,
          phone: phone || null,
          address: address || null,
          website: website || null,
          city: location,
          country: 'United Kingdom',
          industry: category,
          source: 'Yell.com'
        });
      }
    });

    return companies;
  } catch (e) {
    return [];
  }
}

// Scrape Thomsonlocal (UK directory)
async function discoverFromThomsonLocal(location, category) {
  try {
    const url = `https://www.thomsonlocal.com/search/${encodeURIComponent(category)}/${encodeURIComponent(location)}`;

    const response = await http.get(url, {
      headers: { 'User-Agent': randomUA(), 'Accept': 'text/html' }
    });

    const $ = cheerio.load(response.data);
    const companies = [];

    $('.business-listing, .listing-item').each((i, el) => {
      const name = $(el).find('.listing-name, .business-name, h2 a, h3 a').first().text().trim();
      const phone = $(el).find('.phone-number, [class*="phone"]').first().text().trim();

      if (name) {
        companies.push({
          name,
          phone: phone?.replace(/[^\d+]/g, '') || null,
          city: location,
          country: 'United Kingdom',
          industry: category,
          source: 'Thomson Local'
        });
      }
    });

    return companies;
  } catch (e) {
    return [];
  }
}

// ==================== SOURCE 7: OPENCORPORATES (Free Tier) ====================

async function discoverFromOpenCorporates(jurisdiction, page = 1) {
  try {
    const response = await http.get(`https://api.opencorporates.com/v0.4/companies/search`, {
      params: {
        q: '*',
        jurisdiction_code: jurisdiction,
        per_page: 30,
        page,
        current_status: 'Active',
        order: 'incorporation_date'
      },
      timeout: 10000
    });

    const companies = (response.data?.results?.companies || []).map(item => {
      const c = item.company;
      return {
        name: c.name,
        city: c.registered_address?.locality || null,
        state: c.registered_address?.region || null,
        country: c.jurisdiction_code?.startsWith('gb') ? 'United Kingdom' :
                 c.jurisdiction_code?.startsWith('us') ? 'United States' :
                 c.jurisdiction_code?.startsWith('ca') ? 'Canada' :
                 c.jurisdiction_code?.startsWith('au') ? 'Australia' : null,
        address: [c.registered_address?.street_address, c.registered_address?.locality,
                  c.registered_address?.postal_code].filter(Boolean).join(', '),
        category: c.company_type || null,
        source: 'OpenCorporates'
      };
    });

    return companies.filter(c => c.name);
  } catch (e) {
    console.log(`  [OpenCorporates] Error: ${e.message}`);
    return [];
  }
}

// ==================== DISCOVERY ORCHESTRATOR ====================

const UK_CITIES = [
  'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Liverpool',
  'Edinburgh', 'Bristol', 'Sheffield', 'Newcastle', 'Nottingham', 'Cardiff',
  'Leicester', 'Brighton', 'Oxford', 'Cambridge', 'York', 'Bath',
  'Southampton', 'Reading', 'Coventry', 'Belfast', 'Aberdeen', 'Dundee',
  'Swansea', 'Plymouth', 'Derby', 'Wolverhampton', 'Stoke-on-Trent', 'Sunderland'
];

const US_CITIES = [
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
  'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
  'Fort Worth', 'Columbus', 'Charlotte', 'San Francisco', 'Indianapolis',
  'Seattle', 'Denver', 'Washington DC', 'Nashville', 'Oklahoma City',
  'Portland', 'Las Vegas', 'Memphis', 'Louisville', 'Baltimore', 'Milwaukee',
  'Albuquerque', 'Tucson', 'Fresno', 'Sacramento', 'Atlanta', 'Miami',
  'Boston', 'Minneapolis', 'Detroit', 'Pittsburgh', 'Cleveland', 'Tampa'
];

const BUSINESS_CATEGORIES = [
  'accountant', 'architect', 'builder', 'plumber', 'electrician', 'solicitor',
  'dentist', 'doctor', 'restaurant', 'hotel', 'garage', 'florist', 'bakery',
  'pharmacy', 'optician', 'veterinary', 'estate agent', 'insurance broker',
  'financial advisor', 'IT services', 'marketing agency', 'recruitment agency',
  'cleaning services', 'security company', 'printing services', 'web design',
  'landscaping', 'roofing', 'painter decorator', 'locksmith', 'photographer'
];

const GOOGLE_PLACE_TYPES = [
  'accounting', 'lawyer', 'dentist', 'doctor', 'electrician', 'plumber',
  'real_estate_agency', 'restaurant', 'gym', 'spa', 'veterinary_care',
  'car_repair', 'insurance_agency', 'travel_agency', 'pharmacy', 'cafe',
  'lodging', 'store', 'bar', 'hospital'
];

async function processAndSave(companies) {
  let saved = 0;
  for (const company of companies) {
    stats.total_found++;
    const wasSaved = await saveCompany(company);
    if (wasSaved) saved++;
    await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_SAVES));
  }
  return saved;
}

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000);
  const rate = elapsed > 0 ? (stats.total_saved / (elapsed / 60)).toFixed(0) : 0;

  console.log('\n' + '='.repeat(65));
  console.log(`  MULTI-SOURCE DISCOVERY | ${rate} saved/min | ${elapsed}s elapsed`);
  console.log('-'.repeat(65));
  console.log(`  Found: ${stats.total_found} | Saved: ${stats.total_saved} | Dupes: ${stats.duplicates} | Errors: ${stats.errors}`);
  console.log('  By source:');
  for (const [source, count] of Object.entries(stats.by_source).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${source}: ${count}`);
  }
  console.log('='.repeat(65) + '\n');
}

// ==================== MAIN LOOP ====================

async function run() {
  console.log('\n' + '='.repeat(65));
  console.log('   MULTI-SOURCE COMPANY DISCOVERY v1');
  console.log('='.repeat(65));
  console.log('   Sources:');
  console.log('   1. Wikidata SPARQL (global companies with structured data)');
  console.log('   2. FSA Food Hygiene (UK food businesses - unlimited)');
  console.log('   3. SEC EDGAR (US public companies)');
  console.log('   4. Google Places API (nearby businesses)');
  console.log('   5. UK Charity Commission');
  console.log('   6. Yell.com + Thomson Local (UK directories)');
  console.log('   7. OpenCorporates (company registries)');
  console.log(`   Google Places API: ${CONFIG.GOOGLE_PLACES_API_KEY ? 'ENABLED' : 'DISABLED (no key)'}`);
  console.log('   Press Ctrl+C to stop\n');

  // Ensure data_source column exists
  try { await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS data_source VARCHAR(100)'); } catch {}

  let round = 0;

  while (true) {
    round++;
    console.log(`\n${'='.repeat(40)} ROUND ${round} ${'='.repeat(40)}\n`);

    // ---- WIKIDATA: Global companies ----
    console.log('[1/7] Wikidata - Global companies...');
    const wikiCountries = ['United Kingdom', 'United States', 'Canada', 'Australia', 'Germany',
                           'France', 'India', 'Japan', 'Netherlands', 'Ireland', 'Sweden', 'Switzerland'];
    for (const country of wikiCountries) {
      const offset = (round - 1) * 500;
      const companies = await discoverFromWikidata(country, offset);
      if (companies.length > 0) {
        const saved = await processAndSave(companies);
        console.log(`  ${country}: found ${companies.length}, saved ${saved} new`);
      }
      await new Promise(r => setTimeout(r, 2000)); // Be nice to Wikidata
    }

    // ---- FSA: UK food businesses (massive dataset) ----
    console.log('\n[2/7] FSA Food Hygiene - UK food businesses...');
    const fsaStartPage = (round - 1) * 10 + 1;
    for (let page = fsaStartPage; page < fsaStartPage + 10; page++) {
      const { companies, totalPages } = await discoverFromFSA(page, 100);
      if (companies.length > 0) {
        const saved = await processAndSave(companies);
        console.log(`  Page ${page}/${totalPages}: found ${companies.length}, saved ${saved} new`);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    // ---- SEC EDGAR: US public companies ----
    console.log('\n[3/7] SEC EDGAR - US public companies...');
    const secOffset = (round - 1) * 500;
    const secCompanies = await discoverFromSEC(secOffset);
    if (secCompanies.length > 0) {
      const saved = await processAndSave(secCompanies);
      console.log(`  Found ${secCompanies.length}, saved ${saved} new`);
    }

    // ---- GOOGLE PLACES: Nearby businesses ----
    if (CONFIG.GOOGLE_PLACES_API_KEY) {
      console.log('\n[4/7] Google Places - Nearby businesses...');
      const cityIdx = (round - 1) % UK_CITIES.length;
      const typeIdx = (round - 1) % GOOGLE_PLACE_TYPES.length;

      // Do 3 city+type combos per round to conserve API quota
      for (let i = 0; i < 3; i++) {
        const city = UK_CITIES[(cityIdx + i) % UK_CITIES.length];
        const type = GOOGLE_PLACE_TYPES[(typeIdx + i) % GOOGLE_PLACE_TYPES.length];
        const companies = await discoverFromGooglePlaces(`${city}, UK`, type);
        if (companies.length > 0) {
          const saved = await processAndSave(companies);
          console.log(`  ${city} (${type}): found ${companies.length}, saved ${saved} new`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      // Also do US cities
      for (let i = 0; i < 2; i++) {
        const city = US_CITIES[(cityIdx + i) % US_CITIES.length];
        const type = GOOGLE_PLACE_TYPES[(typeIdx + i) % GOOGLE_PLACE_TYPES.length];
        const companies = await discoverFromGooglePlaces(`${city}, USA`, type);
        if (companies.length > 0) {
          const saved = await processAndSave(companies);
          console.log(`  ${city} (${type}): found ${companies.length}, saved ${saved} new`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    } else {
      console.log('\n[4/7] Google Places - SKIPPED (no API key)');
    }

    // ---- UK CHARITIES ----
    console.log('\n[5/7] UK Charities...');
    const charityTerms = ['education', 'health', 'community', 'children', 'arts', 'housing',
                          'disability', 'environment', 'sports', 'animal', 'elderly', 'youth'];
    const charityTerm = charityTerms[(round - 1) % charityTerms.length];
    const charities = await discoverFromCharities(charityTerm, round - 1);
    if (charities.length > 0) {
      const saved = await processAndSave(charities);
      console.log(`  "${charityTerm}": found ${charities.length}, saved ${saved} new`);
    }

    // ---- DIRECTORY SCRAPING ----
    console.log('\n[6/7] Directory scraping (Yell.com + Thomson Local)...');
    const dirCityIdx = (round - 1) % UK_CITIES.length;
    const dirCatIdx = (round - 1) * 3 % BUSINESS_CATEGORIES.length;

    for (let i = 0; i < 3; i++) {
      const city = UK_CITIES[(dirCityIdx + i) % UK_CITIES.length];
      const category = BUSINESS_CATEGORIES[(dirCatIdx + i) % BUSINESS_CATEGORIES.length];

      // Yell.com
      const yellCompanies = await discoverFromYellowPages(city, category);
      if (yellCompanies.length > 0) {
        const saved = await processAndSave(yellCompanies);
        console.log(`  Yell - ${city}/${category}: found ${yellCompanies.length}, saved ${saved}`);
      }

      // Thomson Local
      const thomsonCompanies = await discoverFromThomsonLocal(city, category);
      if (thomsonCompanies.length > 0) {
        const saved = await processAndSave(thomsonCompanies);
        console.log(`  Thomson - ${city}/${category}: found ${thomsonCompanies.length}, saved ${saved}`);
      }

      await new Promise(r => setTimeout(r, 2000)); // Rate limit
    }

    // ---- OPENCORPORATES ----
    console.log('\n[7/7] OpenCorporates - Company registries...');
    const jurisdictions = ['gb', 'us_ny', 'us_ca', 'us_tx', 'us_fl', 'ca_on', 'au', 'ie'];
    const jurIdx = (round - 1) % jurisdictions.length;
    for (let i = 0; i < 2; i++) {
      const jur = jurisdictions[(jurIdx + i) % jurisdictions.length];
      const companies = await discoverFromOpenCorporates(jur, round);
      if (companies.length > 0) {
        const saved = await processAndSave(companies);
        console.log(`  ${jur}: found ${companies.length}, saved ${saved} new`);
      }
      await new Promise(r => setTimeout(r, 3000)); // Respect free tier
    }

    // Print round stats
    printStats();

    // Pause between rounds
    console.log(`Waiting ${CONFIG.BATCH_PAUSE / 1000}s before next round...`);
    await new Promise(r => setTimeout(r, CONFIG.BATCH_PAUSE));
  }
}

process.on('SIGINT', () => {
  console.log('\n');
  printStats();
  console.log('Discovery stopped.');
  process.exit(0);
});

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
