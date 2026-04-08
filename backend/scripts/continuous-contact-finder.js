#!/usr/bin/env node

/**
 * CONTINUOUS CONTACT FINDER
 * Runs indefinitely, finding real contacts for all companies without contacts
 * Processes companies in batches of 100, with a short pause between batches
 */

const { spawn } = require('child_process');
const path = require('path');
const { pool } = require('../src/db/connection');

async function getStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_companies,
        (SELECT COUNT(DISTINCT linked_account_id) FROM contacts) as companies_with_contacts,
        (SELECT COUNT(*) FROM contacts) as total_contacts,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email != '') as contacts_with_email,
        (SELECT COUNT(*) FROM contacts WHERE phone_number IS NOT NULL AND phone_number != '') as contacts_with_phone
      FROM accounts
    `);
    return result.rows[0];
  } catch (e) {
    console.error('Stats error:', e.message);
    return null;
  }
}

async function runBatch(batchNumber) {
  console.log('\n' + '='.repeat(70));
  console.log(`   BATCH ${batchNumber} - Starting Contact Finder`);
  console.log('='.repeat(70));

  const stats = await getStats();
  if (stats) {
    const remaining = parseInt(stats.total_companies) - parseInt(stats.companies_with_contacts);
    console.log(`\n   Progress:`);
    console.log(`   - Total Companies: ${stats.total_companies.toLocaleString()}`);
    console.log(`   - Companies with Contacts: ${stats.companies_with_contacts.toLocaleString()}`);
    console.log(`   - Remaining to Process: ${remaining.toLocaleString()}`);
    console.log(`   - Total Contacts Found: ${stats.total_contacts.toLocaleString()}`);
    console.log(`   - With Email: ${stats.contacts_with_email}`);
    console.log(`   - With Phone: ${stats.contacts_with_phone}`);
    console.log('');
  }

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'find-real-contacts.js');
    const process = spawn('node', [scriptPath, 'all', '100'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });

    process.on('close', (code) => {
      if (code === 0) {
        console.log(`\n   Batch ${batchNumber} completed successfully\n`);
        resolve();
      } else {
        console.log(`\n   Batch ${batchNumber} exited with code ${code}\n`);
        resolve(); // Continue anyway
      }
    });

    process.on('error', (err) => {
      console.error(`   Batch ${batchNumber} error:`, err.message);
      resolve(); // Continue anyway
    });
  });
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('   CONTINUOUS CONTACT FINDER - STARTED');
  console.log('   Will run indefinitely until stopped (Ctrl+C)');
  console.log('='.repeat(70));

  let batchNumber = 1;

  while (true) {
    try {
      await runBatch(batchNumber);
      batchNumber++;

      // Short pause between batches (10 seconds)
      console.log('   Pausing 10 seconds before next batch...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (error) {
      console.error('Batch error:', error.message);
      console.log('Waiting 30 seconds before retry...');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
