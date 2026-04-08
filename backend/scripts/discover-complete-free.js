#!/usr/bin/env node

/**
 * COMPLETE FREE BUSINESS DISCOVERY
 *
 * Uses multiple FREE sources to find ALL businesses:
 * 1. OpenStreetMap (Overpass API) - Completely free
 * 2. Yell.com scraping (UK Yellow Pages) - Public data
 * 3. Companies House API - Free, already have 4M+
 *
 * No API keys required!
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');
const cheerio = require('cheerio');

const DELAY_MS = 500;
const BATCH_SIZE = 50;

// UK cities with coordinates
const UK_CITIES = [
  { name: 'Edinburgh', lat: 55.9533, lng: -3.1883 },
  { name: 'Glasgow', lat: 55.8642, lng: -4.2518 },
  { name: 'Manchester', lat: 53.4808, lng: -2.2426 },
  { name: 'Birmingham', lat: 52.4862, lng: -1.8904 },
  { name: 'Leeds', lat: 53.8008, lng: -1.5491 },
  { name: 'Liverpool', lat: 53.4084, lng: -2.9916 },
  { name: 'Bristol', lat: 51.4545, lng: -2.5879 },
  { name: 'Sheffield', lat: 53.3811, lng: -1.4701 },
  { name: 'Newcastle', lat: 54.9783, lng: -1.6178 },
  { name: 'Nottingham', lat: 52.9548, lng: -1.1581 },
  { name: 'Leicester', lat: 52.6369, lng: -1.1398 },
  { name: 'Cardiff', lat: 51.4816, lng: -3.1791 },
  { name: 'Belfast', lat: 54.5973, lng: -5.9301 },
  { name: 'Aberdeen', lat: 57.1497, lng: -2.0943 },
  { name: 'Dundee', lat: 56.4620, lng: -2.9707 },
];

// Business categories for Yellow Pages
const YELL_CATEGORIES = [
  'accountants', 'architects', 'builders', 'car-dealers', 'car-repairs',
  'cleaning-services', 'dentists', 'doctors', 'electricians', 'estate-agents',
  'financial-advisers', 'florists', 'hairdressers', 'hotels', 'insurance',
  'lawyers', 'locksmiths', 'opticians', 'pet-shops', 'pharmacies',
  'photographers', 'plumbers', 'printers', 'recruitment', 'restaurants',
  'roofing', 'security', 'solicitors', 'taxis', 'vets'
];

// OSM business types
const OSM_TYPES = [
  { key: 'shop', values: ['supermarket', 'convenience', 'clothes', 'hairdresser', 'car', 'furniture', 'electronics', 'hardware', 'jewelry', 'florist', 'pet'] },
  { key: 'amenity', values: ['restaurant', 'cafe', 'bar', 'pub', 'bank', 'pharmacy', 'doctors', 'dentist', 'veterinary', 'fuel'] },
  { key: 'office', values: ['lawyer', 'accountant', 'insurance', 'estate_agent', 'company', 'it'] },
  { key: 'craft', values: ['plumber', 'electrician', 'carpenter', 'painter', 'photographer'] },
  { key: 'tourism', values: ['hotel', 'guest_house', 'hostel'] },
  { key: 'healthcare', values: ['hospital', 'clinic', 'physiotherapist'] }
];

let stats = {
  osm: { found: 0, new: 0 },
  yell: { found: 0, new: 0 },
  total: { new: 0, existing: 0 },
  start: Date.now()
};

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
});

/**
 * Query OpenStreetMap Overpass API
 */
async function queryOSM(lat, lng, radiusKm, key, value) {
  const radius = radiusKm * 1000;
  const query = `
    [out:json][timeout:60];
    (
      node["${key}"="${value}"](around:${radius},${lat},${lng});
      way["${key}"="${value}"](around:${radius},${lat},${lng});
    );
    out body center;
  `;

  try {
    const response = await http.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(query)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return response.data.elements || [];
  } catch (error) {
    return [];
  }
}

/**
 * Scrape Yell.com (UK Yellow Pages)
 */
async function scrapeYell(category, location, page = 1) {
  const url = `https://www.yell.com/ucs/UcsSearchAction.do?scrambleSeed=&keywords=${category}&location=${encodeURIComponent(location)}&pageNum=${page}`;

  try {
    const response = await http.get(url);
    const $ = cheerio.load(response.data);
    const businesses = [];

    $('.businessCapsule').each((i, el) => {
      const $el = $(el);
      const name = $el.find('.businessCapsule--name').text().trim();
      const address = $el.find('.businessCapsule--address').text().trim();
      const phone = $el.find('.businessCapsule--telephone').text().trim().replace(/\s/g, '');
      const website = $el.find('a[data-tracking="website"]').attr('href') || null;

      if (name) {
        businesses.push({ name, address, phone, website, source: 'Yell.com' });
      }
    });

    // Check if there's a next page
    const hasMore = $('.pagination__next').length > 0;

    return { businesses, hasMore };
  } catch (error) {
    return { businesses: [], hasMore: false };
  }
}

/**
 * Check if company exists
 */
async function companyExists(name, city) {
  try {
    const result = await pool.query(`
      SELECT 1 FROM accounts
      WHERE LOWER(company_name) = LOWER($1)
        AND (LOWER(address) LIKE LOWER($2) OR city = $3)
      LIMIT 1
    `, [name, `%${city}%`, city]);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Save company to database
 */
async function saveCompany(business, city, source) {
  try {
    if (await companyExists(business.name, city)) {
      stats.total.existing++;
      return false;
    }

    await pool.query(`
      INSERT INTO accounts (company_name, address, phone, website, city, data_source, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT DO NOTHING
    `, [
      business.name,
      business.address || null,
      business.phone || null,
      business.website || null,
      city,
      source
    ]);

    stats.total.new++;
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover from OpenStreetMap
 */
async function discoverOSM(city, lat, lng, radiusKm = 15) {
  console.log(`\n[OSM] Searching ${city} (${radiusKm}km radius)...`);

  for (const type of OSM_TYPES) {
    for (const value of type.values) {
      process.stdout.write(`  ${type.key}=${value}... `);

      const elements = await queryOSM(lat, lng, radiusKm, type.key, value);
      let newCount = 0;

      for (const el of elements) {
        const tags = el.tags || {};
        const name = tags.name;
        if (!name) continue;

        const business = {
          name,
          address: [tags['addr:street'], tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', '),
          phone: tags.phone || tags['contact:phone'],
          website: tags.website || tags['contact:website']
        };

        const isNew = await saveCompany(business, city, 'OpenStreetMap');
        if (isNew) {
          newCount++;
          stats.osm.new++;
        }
        stats.osm.found++;
      }

      console.log(`${elements.length} found, ${newCount} new`);
      await new Promise(r => setTimeout(r, 1000)); // Rate limit OSM
    }
  }
}

/**
 * Discover from Yell.com
 */
async function discoverYell(city) {
  console.log(`\n[YELL] Searching ${city}...`);

  for (const category of YELL_CATEGORIES) {
    process.stdout.write(`  ${category}... `);

    let page = 1;
    let totalFound = 0;
    let totalNew = 0;

    while (page <= 5) { // Max 5 pages per category
      const { businesses, hasMore } = await scrapeYell(category, city, page);

      for (const business of businesses) {
        const isNew = await saveCompany(business, city, 'Yell.com');
        if (isNew) {
          totalNew++;
          stats.yell.new++;
        }
        totalFound++;
        stats.yell.found++;
      }

      if (!hasMore || businesses.length === 0) break;
      page++;
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    console.log(`${totalFound} found, ${totalNew} new`);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

/**
 * Get database stats for a city
 */
async function getCityStats(city) {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) as total FROM accounts
      WHERE LOWER(address) LIKE LOWER($1) OR city = $2
    `, [`%${city}%`, city]);
    return parseInt(result.rows[0].total);
  } catch {
    return 0;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('   COMPLETE FREE BUSINESS DISCOVERY');
  console.log('='.repeat(60));
  console.log('   Sources: OpenStreetMap, Yell.com (Yellow Pages)');
  console.log('   No API keys required - 100% FREE');
  console.log('   Press Ctrl+C to stop\n');

  // Show current stats
  console.log('Current database counts by city:');
  for (const city of UK_CITIES.slice(0, 5)) {
    const count = await getCityStats(city.name);
    console.log(`  ${city.name}: ${count.toLocaleString()} companies`);
  }

  // Process each city
  for (const city of UK_CITIES) {
    const beforeCount = await getCityStats(city.name);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`   DISCOVERING: ${city.name.toUpperCase()}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   Current count: ${beforeCount.toLocaleString()}`);

    // OpenStreetMap discovery
    await discoverOSM(city.name, city.lat, city.lng, 15);

    // Yell.com discovery
    await discoverYell(city.name);

    const afterCount = await getCityStats(city.name);
    console.log(`\n   ${city.name} Complete!`);
    console.log(`   Before: ${beforeCount.toLocaleString()} | After: ${afterCount.toLocaleString()} | Added: ${afterCount - beforeCount}`);

    await new Promise(r => setTimeout(r, 2000));
  }

  // Final stats
  const elapsed = Math.floor((Date.now() - stats.start) / 1000 / 60);
  console.log('\n' + '='.repeat(60));
  console.log('   DISCOVERY COMPLETE');
  console.log('='.repeat(60));
  console.log(`   OpenStreetMap: ${stats.osm.found} found, ${stats.osm.new} new`);
  console.log(`   Yell.com: ${stats.yell.found} found, ${stats.yell.new} new`);
  console.log(`   Total New: ${stats.total.new}`);
  console.log(`   Already Existed: ${stats.total.existing}`);
  console.log(`   Time: ${elapsed} minutes`);

  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('\n\nStopped.');
  console.log(`New companies added: ${stats.total.new}`);
  process.exit(0);
});

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
