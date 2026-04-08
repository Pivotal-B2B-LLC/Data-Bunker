#!/usr/bin/env node

/**
 * MULTI-CITY CONTINUOUS DISCOVERY
 * Discovers companies from multiple cities in parallel
 * Runs indefinitely, cycling through major UK cities
 */

const { spawn } = require('child_process');
const path = require('path');
const { pool } = require('../src/db/connection');

// Major UK cities to discover (sorted by population/business density)
const UK_CITIES = [
  // Top 50 UK Cities
  { city: 'London', region: 'Greater London' },
  { city: 'Birmingham', region: 'West Midlands' },
  { city: 'Leeds', region: 'West Yorkshire' },
  { city: 'Glasgow', region: 'Scotland' },
  { city: 'Sheffield', region: 'South Yorkshire' },
  { city: 'Bradford', region: 'West Yorkshire' },
  { city: 'Liverpool', region: 'Merseyside' },
  { city: 'Edinburgh', region: 'Scotland' },
  { city: 'Bristol', region: 'South West' },
  { city: 'Coventry', region: 'West Midlands' },
  { city: 'Leicester', region: 'East Midlands' },
  { city: 'Nottingham', region: 'East Midlands' },
  { city: 'Newcastle upon Tyne', region: 'Tyne and Wear' },
  { city: 'Kingston upon Hull', region: 'East Yorkshire' },
  { city: 'Plymouth', region: 'Devon' },
  { city: 'Stoke-on-Trent', region: 'Staffordshire' },
  { city: 'Wolverhampton', region: 'West Midlands' },
  { city: 'Derby', region: 'Derbyshire' },
  { city: 'Southampton', region: 'Hampshire' },
  { city: 'Portsmouth', region: 'Hampshire' },
  { city: 'Brighton', region: 'East Sussex' },
  { city: 'Milton Keynes', region: 'Buckinghamshire' },
  { city: 'Sunderland', region: 'Tyne and Wear' },
  { city: 'Norwich', region: 'Norfolk' },
  { city: 'Reading', region: 'Berkshire' },
  { city: 'Luton', region: 'Bedfordshire' },
  { city: 'Swindon', region: 'Wiltshire' },
  { city: 'Oxford', region: 'Oxfordshire' },
  { city: 'Cambridge', region: 'Cambridgeshire' },
  { city: 'York', region: 'North Yorkshire' },
  { city: 'Cardiff', region: 'Wales' },
  { city: 'Aberdeen', region: 'Scotland' },
  { city: 'Dundee', region: 'Scotland' },
  { city: 'Belfast', region: 'Northern Ireland' },
  { city: 'Bath', region: 'Somerset' },
  { city: 'Chester', region: 'Cheshire' },
  { city: 'Exeter', region: 'Devon' },
  { city: 'Gloucester', region: 'Gloucestershire' },
  { city: 'Lancaster', region: 'Lancashire' },
  { city: 'Lincoln', region: 'Lincolnshire' },
  { city: 'Peterborough', region: 'Cambridgeshire' },
  { city: 'Preston', region: 'Lancashire' },
  { city: 'Salisbury', region: 'Wiltshire' },
  { city: 'St Albans', region: 'Hertfordshire' },
  { city: 'Stirling', region: 'Scotland' },
  { city: 'Winchester', region: 'Hampshire' },
  { city: 'Worcester', region: 'Worcestershire' },
  { city: 'Carlisle', region: 'Cumbria' },
  { city: 'Durham', region: 'County Durham' },
  { city: 'Inverness', region: 'Scotland' }
];

async function checkIfCityCompleted(city, region) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM accounts WHERE LOWER(city) = LOWER($1) AND country = 'United Kingdom'`,
      [city]
    );
    const count = parseInt(result.rows[0].count);
    return { city, region, count, hasData: count > 100 };
  } catch (e) {
    return { city, region, count: 0, hasData: false };
  }
}

async function runDiscovery(city, region, processNumber) {
  console.log(`\n[Process ${processNumber}] Starting discovery for ${city}, ${region}...`);

  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'discover-fast.js');
    const process = spawn('node', [scriptPath, city, region, 'United Kingdom'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });

    process.on('close', (code) => {
      console.log(`\n[Process ${processNumber}] ${city} discovery completed (code ${code})`);
      resolve();
    });

    process.on('error', (err) => {
      console.error(`[Process ${processNumber}] ${city} error:`, err.message);
      resolve();
    });
  });
}

async function main() {
  const numParallel = parseInt(process.argv[2]) || 10;

  console.log('\n' + '='.repeat(70));
  console.log('   MULTI-CITY CONTINUOUS DISCOVERY');
  console.log(`   Running ${numParallel} cities in parallel`);
  console.log('='.repeat(70));
  console.log('');

  // Check which cities need discovery
  console.log('📊 Checking existing data for cities...\n');
  const cityStatus = [];
  for (const location of UK_CITIES) {
    const status = await checkIfCityCompleted(location.city, location.region);
    cityStatus.push(status);
    const marker = status.hasData ? '✓' : '○';
    console.log(`   ${marker} ${location.city}: ${status.count.toLocaleString()} companies`);
  }

  // Prioritize cities with less data
  cityStatus.sort((a, b) => a.count - b.count);

  console.log('\n' + '='.repeat(70));
  console.log('   STARTING DISCOVERY');
  console.log('='.repeat(70));
  console.log('');

  let batchNumber = 1;
  let cityIndex = 0;

  while (true) {
    console.log(`\n[BATCH ${batchNumber}] Processing ${numParallel} cities in parallel...\n`);

    const promises = [];
    for (let i = 0; i < numParallel; i++) {
      if (cityIndex >= cityStatus.length) {
        cityIndex = 0; // Loop back to start
      }

      const location = cityStatus[cityIndex];
      promises.push(runDiscovery(location.city, location.region, i + 1));
      cityIndex++;
    }

    // Wait for all parallel discoveries to complete
    await Promise.all(promises);

    batchNumber++;
    console.log(`\n✓ Batch ${batchNumber - 1} completed. Pausing 30 seconds before next batch...\n`);
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
