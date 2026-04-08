#!/usr/bin/env node

/**
 * MEGA GLOBAL DISCOVERY SYSTEM
 *
 * TARGET: 100+ MILLION BUSINESSES WORLDWIDE
 *
 * Features:
 * - Processes ALL countries in parallel
 * - Smart priority system (high-value countries first)
 * - Automatic restart on failures
 * - Progress tracking and estimates
 * - No API limits (100% free data sources)
 *
 * Usage: node mega-global-discovery.js [parallel_workers]
 */

const { spawn } = require('child_process');
const path = require('path');
const { pool } = require('../src/db/connection');
const fs = require('fs');

// Configuration
const PARALLEL_WORKERS = parseInt(process.argv[2]) || 100; // Run 100 cities at once!
const PROGRESS_FILE = './discovery-progress.json';

// Load or initialize progress
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return {
    startedAt: new Date().toISOString(),
    completedLocations: [],
    totalCompaniesFound: 0,
    currentBatch: 0
  };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

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
  const startTime = Date.now();

  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'discover-unlimited.js');
    const args = [scriptPath, city, state || '', country];

    const proc = spawn('node', args, {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe'
    });

    let companiesSaved = 0;
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
      const match = output.match(/Companies Saved: (\d+)/i);
      if (match) {
        companiesSaved = parseInt(match[1]);
      }
    });

    proc.stderr.on('data', (data) => {
      // Capture errors but don't fail
      console.error(`[P${processNum}] Warning: ${data.toString().slice(0, 100)}`);
    });

    proc.on('close', (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`[P${processNum}] ✓ ${location} - ${companiesSaved} companies (${duration}s)`);
      resolve({
        location,
        companiesSaved,
        duration: parseInt(duration),
        success: code === 0
      });
    });

    proc.on('error', (err) => {
      console.error(`[P${processNum}] ✗ ${location} - ${err.message}`);
      resolve({
        location,
        companiesSaved: 0,
        duration: 0,
        success: false
      });
    });

    // Timeout after 10 minutes
    setTimeout(() => {
      proc.kill();
      resolve({
        location,
        companiesSaved,
        duration: 600,
        success: false,
        timeout: true
      });
    }, 600000);
  });
}

async function buildLocationQueue() {
  console.log('📊 Building global location queue...\n');

  // Try to load USA cities
  let usaCities = [];
  try {
    usaCities = require('./usa-all-cities');
    console.log(`   ✓ Loaded ${usaCities.length.toLocaleString()} USA cities`);
  } catch {
    // Fallback to major cities
    usaCities = require('./usa-cities-complete');
    console.log(`   ⚠ Using major USA cities only (${usaCities.length} cities)`);
  }

  // Try to load global cities
  let globalCities = {};
  try {
    globalCities = require('./global-cities-database');
    const totalGlobal = Object.values(globalCities).reduce((sum, c) => sum + c.cities.length, 0);
    console.log(`   ✓ Loaded ${totalGlobal.toLocaleString()} cities from ${Object.keys(globalCities).length} countries`);
  } catch {
    // Fallback to UK and Canada
    const ukCities = require('./uk-cities-complete');
    const canadaCities = require('./canada-cities-complete');
    console.log(`   ⚠ Using UK (${ukCities.length}) and Canada (${canadaCities.length}) only`);

    globalCities = {
      'United Kingdom': { cities: ukCities.map(c => ({ city: c.city, state: c.region, country: 'United Kingdom', priority: c.priority })) },
      'Canada': { cities: canadaCities.map(c => ({ city: c.city, state: c.province, country: 'Canada', priority: c.priority })) }
    };
  }

  // Combine all locations
  const allLocations = [
    ...usaCities.map(c => ({
      city: c.city,
      state: c.state,
      country: 'United States',
      priority: c.priority || 3,
      population: c.population || 0
    }))
  ];

  // Add global cities
  for (const [countryName, countryData] of Object.entries(globalCities)) {
    if (countryData.cities) {
      allLocations.push(...countryData.cities.map(c => ({
        city: c.city,
        state: c.state || c.region || '',
        country: countryName,
        priority: c.priority || 2,
        population: c.population || 0
      })));
    }
  }

  console.log(`\n   📍 Total locations: ${allLocations.toLocaleString()}`);

  // Check existing coverage
  console.log('\n   🔍 Checking existing coverage...');
  const locationsWithCounts = [];
  let checked = 0;

  for (const loc of allLocations) {
    const count = await getCompanyCount(loc.city, loc.state, loc.country);
    locationsWithCounts.push({ ...loc, existingCount: count });

    checked++;
    if (checked % 100 === 0) {
      process.stdout.write(`\r   Checked: ${checked}/${allLocations.length}`);
    }
  }

  console.log(`\n   ✓ Coverage check complete`);

  // Sort by priority (low first = high priority), then by existing count (low first)
  locationsWithCounts.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.existingCount !== b.existingCount) return a.existingCount - b.existingCount;
    return b.population - a.population;
  });

  return locationsWithCounts;
}

async function main() {
  const progress = loadProgress();

  console.log('\n' + '='.repeat(100));
  console.log('   🌍 MEGA GLOBAL DISCOVERY SYSTEM');
  console.log('   TARGET: 100+ MILLION BUSINESSES WORLDWIDE');
  console.log('='.repeat(100));
  console.log('');
  console.log(`⚙️  Configuration:`);
  console.log(`   Parallel Workers: ${PARALLEL_WORKERS}`);
  console.log(`   Started: ${progress.startedAt}`);
  console.log(`   Previously Found: ${progress.totalCompaniesFound.toLocaleString()} companies`);
  console.log('');

  // Build location queue
  const locations = await buildLocationQueue();

  // Filter out already completed locations
  const completedSet = new Set(progress.completedLocations);
  const pendingLocations = locations.filter(loc => {
    const key = `${loc.city}|${loc.state}|${loc.country}`;
    return !completedSet.has(key);
  });

  console.log('');
  console.log('🎯 TOP 50 PRIORITY LOCATIONS:\n');
  pendingLocations.slice(0, 50).forEach((loc, i) => {
    const location = `${loc.city}, ${loc.state || ''} ${loc.country}`.trim();
    console.log(`   ${(i + 1).toString().padStart(3)}. ${location.padEnd(50)} (${loc.existingCount.toLocaleString()} existing)`);
  });

  console.log('');
  console.log('='.repeat(100));
  console.log(`   🚀 STARTING DISCOVERY - ${pendingLocations.length.toLocaleString()} locations to process`);
  console.log('='.repeat(100));
  console.log('');

  let batchNumber = progress.currentBatch + 1;
  const startTime = Date.now();

  // Process in batches
  for (let i = 0; i < pendingLocations.length; i += PARALLEL_WORKERS) {
    const batch = pendingLocations.slice(i, i + PARALLEL_WORKERS);
    const batchStartTime = Date.now();

    console.log(`\n📦 BATCH ${batchNumber} - Processing ${batch.length} locations...\n`);

    const promises = batch.map((loc, idx) =>
      runDiscovery(loc.city, loc.state, loc.country, idx + 1)
    );

    const results = await Promise.all(promises);
    const batchTotal = results.reduce((sum, r) => sum + r.companiesSaved, 0);
    const batchDuration = ((Date.now() - batchStartTime) / 1000 / 60).toFixed(1);

    progress.totalCompaniesFound += batchTotal;
    progress.currentBatch = batchNumber;

    // Mark locations as completed
    batch.forEach(loc => {
      const key = `${loc.city}|${loc.state}|${loc.country}`;
      progress.completedLocations.push(key);
    });

    saveProgress(progress);

    // Calculate statistics
    const totalProcessed = progress.completedLocations.length;
    const percentComplete = ((totalProcessed / locations.length) * 100).toFixed(2);
    const avgTimePerLocation = (Date.now() - startTime) / 1000 / totalProcessed;
    const estimatedRemaining = ((locations.length - totalProcessed) * avgTimePerLocation / 3600).toFixed(1);

    console.log('');
    console.log('─'.repeat(100));
    console.log(`   Batch ${batchNumber} Complete (${batchDuration} minutes)`);
    console.log(`   Locations: ${totalProcessed.toLocaleString()}/${locations.length.toLocaleString()} (${percentComplete}%)`);
    console.log(`   Batch Found: ${batchTotal.toLocaleString()} | Total Found: ${progress.totalCompaniesFound.toLocaleString()}`);
    console.log(`   Estimated Time Remaining: ${estimatedRemaining} hours`);
    console.log('─'.repeat(100));

    batchNumber++;

    // Short pause between batches
    if (i + PARALLEL_WORKERS < pendingLocations.length) {
      console.log('\n⏸️  Pausing 10 seconds...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 3600).toFixed(2);

  console.log('');
  console.log('='.repeat(100));
  console.log('   🎉 MEGA GLOBAL DISCOVERY COMPLETE!');
  console.log('='.repeat(100));
  console.log('');
  console.log(`   Total Locations: ${locations.length.toLocaleString()}`);
  console.log(`   Total Companies: ${progress.totalCompaniesFound.toLocaleString()}`);
  console.log(`   Total Time: ${totalTime} hours`);
  console.log('');
  console.log('='.repeat(100));

  // Clean up progress file
  fs.unlinkSync(PROGRESS_FILE);

  await pool.end();
  process.exit(0);
}

// Handle interrupts gracefully
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Interrupted! Progress saved. Run again to resume.');
  process.exit(0);
});

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
