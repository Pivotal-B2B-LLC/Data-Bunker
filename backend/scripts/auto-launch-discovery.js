#!/usr/bin/env node

/**
 * AUTO-LAUNCH DISCOVERY
 * Waits for city generation to complete, then automatically launches discovery
 */

const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

console.log('\n🤖 AUTO-LAUNCH MONITOR\n');
console.log('Waiting for city generation to complete...\n');

let checkCount = 0;

const checkInterval = setInterval(() => {
  checkCount++;

  const usaCitiesExists = fs.existsSync('./usa-all-cities.js');
  const globalCitiesExists = fs.existsSync('./global-cities-database.js');

  process.stdout.write(`\r⏳ Checking... (${checkCount}m) - USA: ${usaCitiesExists ? '✅' : '⏳'} | Global: ${globalCitiesExists ? '✅' : '⏳'}`);

  if (usaCitiesExists && globalCitiesExists) {
    clearInterval(checkInterval);

    console.log('\n\n✅ City generation COMPLETE!\n');
    console.log('📊 Generated Files:');

    // Get file stats
    const usaStats = fs.statSync('./usa-all-cities.js');
    const globalStats = fs.statSync('./global-cities-database.js');

    console.log(`   ✅ usa-all-cities.js (${(usaStats.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`   ✅ global-cities-database.js (${(globalStats.size / 1024 / 1024).toFixed(2)} MB)`);

    console.log('\n' + '='.repeat(80));
    console.log('   🚀 LAUNCHING MEGA GLOBAL DISCOVERY');
    console.log('   100 Parallel Workers');
    console.log('   Target: 217+ Million Businesses');
    console.log('='.repeat(80));
    console.log('\n');

    // Launch discovery
    const discovery = spawn('node', ['mega-global-discovery.js', '100'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });

    discovery.on('close', (code) => {
      console.log(`\n\n✅ Discovery completed with code ${code}`);
      process.exit(code);
    });

    discovery.on('error', (err) => {
      console.error(`\n\n❌ Discovery error:`, err);
      process.exit(1);
    });
  }

  // After 2 hours, check if generation failed
  if (checkCount > 120) {
    console.log('\n\n⚠️ City generation taking longer than expected.');
    console.log('Check the generation logs or run discovery manually:');
    console.log('   node mega-global-discovery.js 100\n');
  }

}, 60000); // Check every minute

// Handle interrupts
process.on('SIGINT', () => {
  clearInterval(checkInterval);
  console.log('\n\n⚠️ Monitoring stopped. Run again to resume.\n');
  process.exit(0);
});
