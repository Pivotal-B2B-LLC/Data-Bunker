#!/usr/bin/env node

/**
 * POPULATE DISCOVERY QUEUE
 *
 * Fetches ALL populated places from OSM Overpass for:
 *   - USA: all 50 states (cities, towns, villages, suburbs, hamlets)
 *   - UK, Canada, Germany, France, Australia + more
 *
 * Inserts into discovery_queue table.
 * Safe to re-run: ON CONFLICT DO NOTHING (won't duplicate rows).
 *
 * Usage:
 *   node populate-discovery-queue.js        (all countries)
 *   node populate-discovery-queue.js US     (USA only)
 *   node populate-discovery-queue.js GB     (UK only)
 *   node populate-discovery-queue.js US-CA  (California only)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const { pool } = require('../src/db/connection');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const DELAY_MS = 3500;   // respectful delay between Overpass requests
const TIMEOUT_S = 120;
const BATCH_INSERT_SIZE = 500; // max rows per INSERT (PostgreSQL param limit)

// ── All 50 US states with ISO 3166-2 codes ──────────────────────────────────
const US_STATES = [
  { name: 'Alabama',        code: 'US-AL' }, { name: 'Alaska',         code: 'US-AK' },
  { name: 'Arizona',        code: 'US-AZ' }, { name: 'Arkansas',       code: 'US-AR' },
  { name: 'California',     code: 'US-CA' }, { name: 'Colorado',       code: 'US-CO' },
  { name: 'Connecticut',    code: 'US-CT' }, { name: 'Delaware',       code: 'US-DE' },
  { name: 'Florida',        code: 'US-FL' }, { name: 'Georgia',        code: 'US-GA' },
  { name: 'Hawaii',         code: 'US-HI' }, { name: 'Idaho',          code: 'US-ID' },
  { name: 'Illinois',       code: 'US-IL' }, { name: 'Indiana',        code: 'US-IN' },
  { name: 'Iowa',           code: 'US-IA' }, { name: 'Kansas',         code: 'US-KS' },
  { name: 'Kentucky',       code: 'US-KY' }, { name: 'Louisiana',      code: 'US-LA' },
  { name: 'Maine',          code: 'US-ME' }, { name: 'Maryland',       code: 'US-MD' },
  { name: 'Massachusetts',  code: 'US-MA' }, { name: 'Michigan',       code: 'US-MI' },
  { name: 'Minnesota',      code: 'US-MN' }, { name: 'Mississippi',    code: 'US-MS' },
  { name: 'Missouri',       code: 'US-MO' }, { name: 'Montana',        code: 'US-MT' },
  { name: 'Nebraska',       code: 'US-NE' }, { name: 'Nevada',         code: 'US-NV' },
  { name: 'New Hampshire',  code: 'US-NH' }, { name: 'New Jersey',     code: 'US-NJ' },
  { name: 'New Mexico',     code: 'US-NM' }, { name: 'New York',       code: 'US-NY' },
  { name: 'North Carolina', code: 'US-NC' }, { name: 'North Dakota',   code: 'US-ND' },
  { name: 'Ohio',           code: 'US-OH' }, { name: 'Oklahoma',       code: 'US-OK' },
  { name: 'Oregon',         code: 'US-OR' }, { name: 'Pennsylvania',   code: 'US-PA' },
  { name: 'Rhode Island',   code: 'US-RI' }, { name: 'South Carolina', code: 'US-SC' },
  { name: 'South Dakota',   code: 'US-SD' }, { name: 'Tennessee',      code: 'US-TN' },
  { name: 'Texas',          code: 'US-TX' }, { name: 'Utah',           code: 'US-UT' },
  { name: 'Vermont',        code: 'US-VT' }, { name: 'Virginia',       code: 'US-VA' },
  { name: 'Washington',     code: 'US-WA' }, { name: 'West Virginia',  code: 'US-WV' },
  { name: 'Wisconsin',      code: 'US-WI' }, { name: 'Wyoming',        code: 'US-WY' },
];

// ── Other countries (queried at country level, state derived from OSM tags) ─
const OTHER_COUNTRIES = [
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Canada',         code: 'CA' },
  { name: 'Germany',        code: 'DE' },
  { name: 'France',         code: 'FR' },
  { name: 'Australia',      code: 'AU' },
  { name: 'Netherlands',    code: 'NL' },
  { name: 'Spain',          code: 'ES' },
  { name: 'Italy',          code: 'IT' },
  { name: 'Ireland',        code: 'IE' },
  { name: 'Sweden',         code: 'SE' },
  { name: 'Norway',         code: 'NO' },
  { name: 'Denmark',        code: 'DK' },
  { name: 'Belgium',        code: 'BE' },
  { name: 'Switzerland',    code: 'CH' },
  { name: 'Austria',        code: 'AT' },
  { name: 'New Zealand',    code: 'NZ' },
  { name: 'Singapore',      code: 'SG' },
  { name: 'United Arab Emirates', code: 'AE' },
  { name: 'Japan',          code: 'JP' },
  { name: 'India',          code: 'IN' },
];

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function assignPriority(placeType, population) {
  const pop = parseInt(population) || 0;
  if (placeType === 'city' && pop > 100000) return 1;
  if (placeType === 'city' || (placeType === 'town' && pop > 10000)) return 2;
  if (placeType === 'town' || placeType === 'village') return 3;
  if (placeType === 'suburb' || placeType === 'neighbourhood') return 4;
  return 5; // hamlet, locality, everything else
}

async function overpassQuery(queryBody) {
  let retries = 0;
  while (retries < 5) {
    try {
      const res = await axios.post(OVERPASS_URL, queryBody, {
        headers: { 'Content-Type': 'text/plain' },
        timeout: (TIMEOUT_S + 30) * 1000
      });
      return res.data.elements || [];
    } catch (e) {
      retries++;
      const wait = 15000 * retries;
      const status = e.response?.status;
      console.log(`    Overpass error (attempt ${retries}/5, status ${status}): ${e.message}. Waiting ${wait / 1000}s...`);
      await delay(wait);
    }
  }
  console.log('    All Overpass retries failed. Skipping this query.');
  return [];
}

async function insertBatch(rows) {
  if (rows.length === 0) return 0;
  let totalInserted = 0;

  // Chunk into BATCH_INSERT_SIZE to avoid PostgreSQL parameter limit
  for (let start = 0; start < rows.length; start += BATCH_INSERT_SIZE) {
    const chunk = rows.slice(start, start + BATCH_INSERT_SIZE);
    const values = [];
    const placeholders = chunk.map((r, i) => {
      const b = i * 10;
      values.push(
        r.country, r.country_code, r.state_region, r.state_code,
        r.city, r.place_type, r.population, r.latitude, r.longitude, r.priority
      );
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`;
    }).join(',');

    const sql = `
      INSERT INTO discovery_queue
        (country, country_code, state_region, state_code, city, place_type,
         population, latitude, longitude, priority)
      VALUES ${placeholders}
      ON CONFLICT (country_code, state_code, city) DO NOTHING
    `;
    const result = await pool.query(sql, values);
    totalInserted += result.rowCount || 0;
  }
  return totalInserted;
}

// ── USA: query per state ─────────────────────────────────────────────────────
async function populateUSA(stateFilter) {
  const states = stateFilter
    ? US_STATES.filter(s => s.code === stateFilter || s.name.toLowerCase() === stateFilter.toLowerCase())
    : US_STATES;

  if (states.length === 0) {
    console.log(`No matching US state for filter: ${stateFilter}`);
    return;
  }

  console.log(`\n=== USA: processing ${states.length} state(s) ===`);
  let totalInserted = 0;

  for (const state of states) {
    console.log(`\n  ${state.name} (${state.code})`);

    const query = `
[out:json][timeout:${TIMEOUT_S}];
area["ISO3166-2"="${state.code}"][admin_level=4]->.state;
(
  node["place"~"city|town|village|suburb|hamlet|locality|neighbourhood"](area.state);
);
out body;
`;

    const elements = await overpassQuery(query);
    console.log(`    ${elements.length} place nodes found`);

    const rows = elements
      .filter(el => el.tags && el.tags.name)
      .map(el => ({
        country:      'United States',
        country_code: 'US',
        state_region: state.name,
        state_code:   state.code,
        city:         el.tags.name,
        place_type:   el.tags.place || 'locality',
        population:   parseInt(el.tags.population) || 0,
        latitude:     el.lat,
        longitude:    el.lon,
        priority:     assignPriority(el.tags.place, el.tags.population)
      }));

    const inserted = await insertBatch(rows);
    totalInserted += inserted;
    console.log(`    ${inserted} new rows inserted`);

    await delay(DELAY_MS);
  }

  console.log(`\nUSA total inserted: ${totalInserted}`);
}

// ── Other countries: query at country level ──────────────────────────────────
async function populateCountry(country) {
  console.log(`\n=== ${country.name} (${country.code}) ===`);

  const query = `
[out:json][timeout:${TIMEOUT_S}];
area["ISO3166-1:alpha2"="${country.code}"]->.country;
(
  node["place"~"city|town|village|suburb|hamlet|locality|neighbourhood"](area.country);
);
out body;
`;

  const elements = await overpassQuery(query);
  console.log(`  ${elements.length} place nodes found`);

  const rows = elements
    .filter(el => el.tags && el.tags.name)
    .map(el => {
      // Derive state/region from OSM tags — cascade through several possible tags
      const stateRegion =
        el.tags['addr:state']   ||
        el.tags['is_in:state']  ||
        el.tags['addr:county']  ||
        el.tags['is_in:county'] ||
        el.tags['addr:region']  ||
        country.name; // fallback

      return {
        country:      country.name,
        country_code: country.code,
        state_region: stateRegion,
        state_code:   null,
        city:         el.tags.name,
        place_type:   el.tags.place || 'locality',
        population:   parseInt(el.tags.population) || 0,
        latitude:     el.lat,
        longitude:    el.lon,
        priority:     assignPriority(el.tags.place, el.tags.population)
      };
    });

  const inserted = await insertBatch(rows);
  console.log(`  ${inserted} new rows inserted`);
  await delay(DELAY_MS);
}

async function printStats() {
  const result = await pool.query(`
    SELECT
      status,
      COUNT(*) AS count,
      COUNT(DISTINCT country) AS countries,
      COUNT(DISTINCT state_region) AS states
    FROM discovery_queue
    GROUP BY status
    ORDER BY status
  `);

  const total = await pool.query('SELECT COUNT(*) FROM discovery_queue');

  console.log('\n── Queue stats ────────────────────────────────────────');
  console.log(`  Total locations in queue: ${total.rows[0].count}`);
  result.rows.forEach(r => {
    console.log(`  ${r.status.padEnd(12)} ${String(r.count).padStart(7)} locations  (${r.countries} countries, ${r.states} states)`);
  });
  console.log('────────────────────────────────────────────────────────\n');
}

async function main() {
  const arg = (process.argv[2] || 'ALL').toUpperCase();
  console.log(`\nPopulate Discovery Queue — target: ${arg}`);
  console.log('This may take 20-40 minutes for ALL countries (Overpass rate limits).\n');

  try {
    if (arg.startsWith('US-')) {
      // Single US state: e.g. US-CA
      await populateUSA(arg);
    } else if (arg === 'US') {
      await populateUSA(null);
    } else if (arg === 'ALL') {
      await populateUSA(null);
      for (const country of OTHER_COUNTRIES) {
        await populateCountry(country);
      }
    } else {
      // Check if it matches a non-US country code
      const country = OTHER_COUNTRIES.find(c => c.code === arg);
      if (country) {
        await populateCountry(country);
      } else {
        console.log(`Unknown target: ${arg}`);
        console.log('Usage: node populate-discovery-queue.js [US|GB|CA|DE|FR|AU|ALL|US-CA|...]');
      }
    }

    await printStats();

  } catch (e) {
    console.error('Fatal:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
