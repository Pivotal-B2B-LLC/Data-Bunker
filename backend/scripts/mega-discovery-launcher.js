#!/usr/bin/env node

/**
 * MEGA DISCOVERY LAUNCHER
 * Discovers ALL active companies in USA, UK, and Canada
 * Excludes duplicates and dissolved companies
 *
 * Usage: node mega-discovery-launcher.js [parallel_processes]
 */

const { spawn } = require('child_process');
const path = require('path');
const { pool } = require('../src/db/connection');

const USA_CITIES = require('./usa-cities-complete');
const UK_CITIES = require('./uk-cities-complete');
const CANADA_CITIES = require('./canada-cities-complete');

async function getCompanyCount(city, state, country) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM accounts
       WHERE LOWER(city) = LOWER($1)
       AND LOWER(state_region) = LOWER($2)
       AND LOWER(country) = LOWER($3)`,
      [city, state || '', country]
    );
    return parseInt(result.rows[0].count);
  } catch (e) {
    return 0;
  }
}

async function runDiscovery(city, state, country, processNum) {
  const location = state ? `${city}, ${state}, ${country}` : `${city}, ${country}`;
  console.log(`[P${processNum}] 🚀 Starting: ${location}`);

  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'discover-fast.js');
    const args = [scriptPath, city, state || '', country];

    const proc = spawn('node', args, {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe' // Capture output
    });

    let companiesSaved = 0;

    proc.stdout.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/Companies Saved: (\d+)/i);
      if (match) {
        companiesSaved = parseInt(match[1]);
      }
    });

    proc.on('close', (code) => {
      console.log(`[P${processNum}] ✓ Completed: ${location} - ${companiesSaved} companies saved`);
      resolve(companiesSaved);
    });

    proc.on('error', (err) => {
      console.error(`[P${processNum}] ✗ Error: ${location} - ${err.message}`);
      resolve(0);
    });
  });
}

async function main() {
  const numParallel = parseInt(process.argv[2]) || 50;

  console.log('\n' + '='.repeat(80));
  console.log('   🌍 MEGA DISCOVERY SYSTEM - GLOBAL COVERAGE');
  console.log('   Finding ALL active companies in USA, UK, and Canada');
  console.log('   Excluding duplicates and dissolved companies');
  console.log('='.repeat(80));
  console.log('');
  console.log(`⚙️  Configuration:`);
  console.log(`   Parallel Processes: ${numParallel}`);
  console.log(`   USA Cities: ${USA_CITIES.length}`);
  console.log(`   UK Cities: ${UK_CITIES.length}`);
  console.log(`   Canada Cities: ${CANADA_CITIES.length}`);
  console.log(`   Total Locations: ${USA_CITIES.length + UK_CITIES.length + CANADA_CITIES.length}`);
  console.log('');

  // Combine all cities with their countries
  const allLocations = [
    ...USA_CITIES.map(c => ({ city: c.city, state: c.state, country: 'United States', priority: c.priority })),
    ...UK_CITIES.map(c => ({ city: c.city, state: c.region, country: 'United Kingdom', priority: c.priority })),
    ...CANADA_CITIES.map(c => ({ city: c.city, state: c.province, country: 'Canada', priority: c.priority }))
  ];

  console.log('📊 Checking existing coverage...\n');

  // Check existing coverage for all locations
  const locationsWithCounts = [];
  for (const loc of allLocations) {
    const count = await getCompanyCount(loc.city, loc.state, loc.country);
    locationsWithCounts.push({ ...loc, existingCount: count });
  }

  // Sort by priority (high first) then by existing count (low first)
  locationsWithCounts.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.existingCount - b.existingCount;
  });

  // Show top locations to process
  console.log('🎯 TOP 20 PRIORITY LOCATIONS:\n');
  locationsWithCounts.slice(0, 20).forEach((loc, i) => {
    const location = `${loc.city}, ${loc.state}, ${loc.country}`;
    console.log(`   ${(i + 1).toString().padStart(2)}. ${location.padEnd(45)} (${loc.existingCount.toLocaleString()} existing)`);
  });

  console.log('');
  console.log('='.repeat(80));
  console.log('   🚀 STARTING DISCOVERY');
  console.log('='.repeat(80));
  console.log('');

  let totalCompaniesFound = 0;
  let locationsProcessed = 0;
  let batchNumber = 1;

  // Process in batches
  for (let i = 0; i < locationsWithCounts.length; i += numParallel) {
    const batch = locationsWithCounts.slice(i, i + numParallel);

    console.log(`\n📦 BATCH ${batchNumber} - Processing ${batch.length} locations in parallel...\n`);

    const promises = batch.map((loc, idx) =>
      runDiscovery(loc.city, loc.state, loc.country, idx + 1)
    );

    const results = await Promise.all(promises);
    const batchTotal = results.reduce((sum, count) => sum + count, 0);

    totalCompaniesFound += batchTotal;
    locationsProcessed += batch.length;

    console.log('');
    console.log('─'.repeat(80));
    console.log(`   Batch ${batchNumber} Summary:`);
    console.log(`   Locations Processed: ${locationsProcessed}/${locationsWithCounts.length}`);
    console.log(`   Companies Found (This Batch): ${batchTotal.toLocaleString()}`);
    console.log(`   Total Companies Found: ${totalCompaniesFound.toLocaleString()}`);
    console.log(`   Progress: ${((locationsProcessed / locationsWithCounts.length) * 100).toFixed(1)}%`);
    console.log('─'.repeat(80));

    batchNumber++;

    // Pause between batches
    if (i + numParallel < locationsWithCounts.length) {
      console.log('\n⏸️  Pausing 30 seconds before next batch...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('   🎉 MEGA DISCOVERY COMPLETE!');
  console.log('='.repeat(80));
  console.log('');
  console.log(`   Total Locations Processed: ${locationsProcessed.toLocaleString()}`);
  console.log(`   Total Companies Discovered: ${totalCompaniesFound.toLocaleString()}`);
  console.log('');
  console.log('='.repeat(80));
  console.log('');

  await pool.end();
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
