#!/usr/bin/env node

/**
 * GOOGLE PLACES DISCOVERY
 *
 * Uses Google Places API to find ALL businesses in an area
 * - Systematic grid-based search
 * - Compares with existing database
 * - Adds missing companies
 *
 * Requires: GOOGLE_PLACES_API_KEY in .env
 * Free tier: $200/month (~5,000 searches)
 */

const { pool } = require('../src/db/connection');
const axios = require('axios');

// Configuration
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const RADIUS = 1000; // meters (1km radius per search)
const DELAY_MS = 200; // Delay between API calls to avoid rate limits

// Business types to search for
const BUSINESS_TYPES = [
  'accounting', 'attorney', 'bank', 'bar', 'beauty_salon', 'cafe',
  'car_dealer', 'car_repair', 'clothing_store', 'contractor', 'dentist',
  'doctor', 'electrician', 'electronics_store', 'finance', 'florist',
  'furniture_store', 'gym', 'hair_care', 'hardware_store', 'health',
  'home_goods_store', 'hospital', 'insurance_agency', 'jewelry_store',
  'lawyer', 'locksmith', 'lodging', 'meal_delivery', 'meal_takeaway',
  'moving_company', 'painter', 'pet_store', 'pharmacy', 'physiotherapist',
  'plumber', 'real_estate_agency', 'restaurant', 'roofing_contractor',
  'shoe_store', 'shopping_mall', 'spa', 'store', 'supermarket',
  'travel_agency', 'veterinary_care'
];

let stats = {
  searched: 0,
  found: 0,
  new: 0,
  existing: 0,
  errors: 0,
  start: Date.now()
};

/**
 * Search Google Places API for businesses
 */
async function searchPlaces(lat, lng, type, pageToken = null) {
  const baseUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

  const params = pageToken ? {
    pagetoken: pageToken,
    key: API_KEY
  } : {
    location: `${lat},${lng}`,
    radius: RADIUS,
    type: type,
    key: API_KEY
  };

  try {
    const response = await axios.get(baseUrl, { params, timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error(`  API Error: ${error.message}`);
    stats.errors++;
    return null;
  }
}

/**
 * Get place details for more info
 */
async function getPlaceDetails(placeId) {
  const url = 'https://maps.googleapis.com/maps/api/place/details/json';

  try {
    const response = await axios.get(url, {
      params: {
        place_id: placeId,
        fields: 'name,formatted_address,formatted_phone_number,website,types,business_status',
        key: API_KEY
      },
      timeout: 10000
    });
    return response.data.result;
  } catch (error) {
    return null;
  }
}

/**
 * Extract domain from website
 */
function getDomain(url) {
  if (!url) return null;
  try {
    return url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
  } catch {
    return null;
  }
}

/**
 * Check if company exists in database
 */
async function companyExists(name, address) {
  try {
    // Check by name similarity
    const result = await pool.query(`
      SELECT account_id FROM accounts
      WHERE LOWER(company_name) = LOWER($1)
      OR (address IS NOT NULL AND LOWER(address) LIKE LOWER($2))
      LIMIT 1
    `, [name, `%${address?.substring(0, 30) || 'NOMATCH'}%`]);

    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Save new company to database
 */
async function saveCompany(place) {
  try {
    // Get more details
    const details = await getPlaceDetails(place.place_id);
    await new Promise(r => setTimeout(r, 100));

    const name = place.name;
    const address = details?.formatted_address || place.vicinity;
    const phone = details?.formatted_phone_number?.replace(/\s/g, '') || null;
    const website = details?.website || null;
    const lat = place.geometry?.location?.lat;
    const lng = place.geometry?.location?.lng;

    // Skip if already exists
    if (await companyExists(name, address)) {
      stats.existing++;
      return false;
    }

    // Insert new company
    await pool.query(`
      INSERT INTO accounts (company_name, address, phone, website, latitude, longitude, data_source, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'Google Places', NOW())
      ON CONFLICT DO NOTHING
    `, [name, address, phone, website, lat, lng]);

    stats.new++;
    return true;

  } catch (error) {
    stats.errors++;
    return false;
  }
}

/**
 * Search all pages for a location/type
 */
async function searchAllPages(lat, lng, type) {
  let pageToken = null;
  let totalFound = 0;

  do {
    if (pageToken) {
      // Google requires 2s delay before using page token
      await new Promise(r => setTimeout(r, 2000));
    }

    const data = await searchPlaces(lat, lng, type, pageToken);
    if (!data || !data.results) break;

    totalFound += data.results.length;
    stats.found += data.results.length;

    for (const place of data.results) {
      if (place.business_status === 'OPERATIONAL') {
        const isNew = await saveCompany(place);
        if (isNew) {
          console.log(`    + NEW: ${place.name}`);
        }
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    pageToken = data.next_page_token;
    stats.searched++;

  } while (pageToken);

  return totalFound;
}

/**
 * Generate grid points for an area
 */
function generateGridPoints(centerLat, centerLng, radiusKm, gridSpacingKm = 1.5) {
  const points = [];
  const latDegPerKm = 1 / 111; // Approximate
  const lngDegPerKm = 1 / (111 * Math.cos(centerLat * Math.PI / 180));

  const latSteps = Math.ceil(radiusKm / gridSpacingKm);
  const lngSteps = Math.ceil(radiusKm / gridSpacingKm);

  for (let i = -latSteps; i <= latSteps; i++) {
    for (let j = -lngSteps; j <= lngSteps; j++) {
      const lat = centerLat + (i * gridSpacingKm * latDegPerKm);
      const lng = centerLng + (j * gridSpacingKm * lngDegPerKm);

      // Check if within radius
      const dist = Math.sqrt(Math.pow(i * gridSpacingKm, 2) + Math.pow(j * gridSpacingKm, 2));
      if (dist <= radiusKm) {
        points.push({ lat, lng });
      }
    }
  }

  return points;
}

/**
 * Discover businesses in a city/area
 */
async function discoverArea(name, centerLat, centerLng, radiusKm = 10) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`   DISCOVERING: ${name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Center: ${centerLat}, ${centerLng}`);
  console.log(`   Radius: ${radiusKm}km`);
  console.log(`   Grid points: ${generateGridPoints(centerLat, centerLng, radiusKm).length}`);
  console.log(`   Business types: ${BUSINESS_TYPES.length}`);
  console.log();

  const gridPoints = generateGridPoints(centerLat, centerLng, radiusKm);

  for (const type of BUSINESS_TYPES) {
    console.log(`\n[${type.toUpperCase()}] Searching ${gridPoints.length} grid points...`);

    let typeTotal = 0;
    for (let i = 0; i < gridPoints.length; i++) {
      const { lat, lng } = gridPoints[i];
      const found = await searchAllPages(lat, lng, type);
      typeTotal += found;

      // Progress update every 5 points
      if ((i + 1) % 5 === 0) {
        const elapsed = Math.floor((Date.now() - stats.start) / 1000);
        console.log(`  Progress: ${i + 1}/${gridPoints.length} | Found: ${stats.found} | New: ${stats.new} | Time: ${elapsed}s`);
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    console.log(`  ${type}: Found ${typeTotal} businesses`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`   DISCOVERY COMPLETE: ${name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Total Found: ${stats.found}`);
  console.log(`   New Added: ${stats.new}`);
  console.log(`   Already Existed: ${stats.existing}`);
  console.log(`   API Calls: ${stats.searched}`);
  console.log(`   Errors: ${stats.errors}`);
}

/**
 * Get area stats from database
 */
async function getAreaStats(city) {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as with_website,
        COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as with_phone
      FROM accounts
      WHERE LOWER(address) LIKE LOWER($1)
    `, [`%${city}%`]);

    return result.rows[0];
  } catch {
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  if (!API_KEY) {
    console.error('\n ERROR: GOOGLE_PLACES_API_KEY not set in .env');
    console.log('\nTo get an API key:');
    console.log('1. Go to https://console.cloud.google.com/');
    console.log('2. Create a project');
    console.log('3. Enable "Places API"');
    console.log('4. Create credentials (API key)');
    console.log('5. Add to .env: GOOGLE_PLACES_API_KEY=your_key_here');
    console.log('\nFree tier: $200/month (~5,000 searches)\n');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('   GOOGLE PLACES BUSINESS DISCOVERY');
  console.log('='.repeat(60));
  console.log('   Finding ALL businesses using Google Places API');
  console.log('   This ensures complete coverage of an area');
  console.log();

  // Example: Edinburgh
  const cities = [
    { name: 'Edinburgh', lat: 55.9533, lng: -3.1883, radius: 12 },
    // Add more cities as needed
  ];

  // Show current stats
  for (const city of cities) {
    const dbStats = await getAreaStats(city.name);
    if (dbStats) {
      console.log(`\n${city.name} - Current Database Stats:`);
      console.log(`  Total companies: ${dbStats.total}`);
      console.log(`  With website: ${dbStats.with_website}`);
      console.log(`  With phone: ${dbStats.with_phone}`);
    }
  }

  // Start discovery
  for (const city of cities) {
    await discoverArea(city.name, city.lat, city.lng, city.radius);
  }

  console.log('\n\nDiscovery complete!');
  process.exit(0);
}

// Handle interrupts
process.on('SIGINT', () => {
  console.log('\n\nStopped.');
  console.log(`New companies added: ${stats.new}`);
  process.exit(0);
});

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
