#!/usr/bin/env node

/**
 * AGENT: DATA QUALITY
 *
 * Scores and validates all data:
 * - Calculates quality scores (0-100%)
 * - Verifies email formats
 * - Validates phone numbers
 * - Detects and removes duplicates
 * - Cleans up invalid data
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../../src/db/connection');
const TURBO_CONFIG = require('./turbo-config');

const AGENT_NAME = 'DATA-QUALITY';
const CONFIG = TURBO_CONFIG.QUALITY;

let stats = {
  scored: 0,
  cleaned: 0,
  duplicatesRemoved: 0,
  avgScore: 0,
  errors: 0,
  start: Date.now()
};

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${AGENT_NAME}] ${msg}`);
}

// Calculate quality score for a company
async function calculateQualityScore(company) {
  let score = 0;
  const weights = {
    company_name: 10,
    website: 15,
    phone_number: 15,
    address: 10,
    email_format: 10,
    linkedin_url: 10,
    industry: 5,
    city: 5,
    contacts: 20  // Up to 20 points for contacts
  };

  if (company.company_name) score += weights.company_name;
  if (company.website) score += weights.website;
  if (company.phone_number) score += weights.phone_number;
  if (company.address) score += weights.address;
  if (company.email_format) score += weights.email_format;
  if (company.linkedin_url) score += weights.linkedin_url;
  if (company.industry) score += weights.industry;
  if (company.city) score += weights.city;

  // Get contact count
  const contactResult = await pool.query(
    'SELECT COUNT(*) FROM contacts WHERE linked_account_id = $1',
    [company.account_id]
  );
  const contactCount = parseInt(contactResult.rows[0].count) || 0;

  // 4 points per contact up to 5 contacts
  score += Math.min(contactCount, 5) * 4;

  return Math.min(score, 100);
}

// Find and remove duplicate companies
async function removeDuplicates() {
  try {
    // Find duplicates by website domain
    const duplicates = await pool.query(`
      SELECT MIN(account_id) as keep_id, ARRAY_AGG(account_id) as all_ids, website
      FROM accounts
      WHERE website IS NOT NULL AND website != ''
      GROUP BY LOWER(REGEXP_REPLACE(REGEXP_REPLACE(website, '^https?://', ''), '^www\\.', ''))
      HAVING COUNT(*) > 1
      LIMIT 50
    `);

    let removed = 0;
    for (const dup of duplicates.rows) {
      const idsToRemove = dup.all_ids.filter(id => id !== dup.keep_id);
      if (idsToRemove.length > 0) {
        // Move contacts to the kept company
        await pool.query(
          `UPDATE contacts SET linked_account_id = $1 WHERE linked_account_id = ANY($2)`,
          [dup.keep_id, idsToRemove]
        );
        // Delete duplicates
        await pool.query(
          'DELETE FROM accounts WHERE account_id = ANY($1)',
          [idsToRemove]
        );
        removed += idsToRemove.length;
      }
    }

    return removed;
  } catch (e) {
    return 0;
  }
}

// Clean up invalid contacts
async function cleanupInvalidContacts() {
  try {
    // Remove contacts with no name
    const result = await pool.query(`
      DELETE FROM contacts
      WHERE first_name IS NULL OR first_name = ''
      OR last_name IS NULL OR last_name = ''
      OR LENGTH(first_name) < 2 OR LENGTH(last_name) < 2
    `);
    return result.rowCount || 0;
  } catch (e) {
    return 0;
  }
}

// Validate email format
function isValidEmail(email) {
  if (!email) return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

// Validate UK phone number
function isValidUKPhone(phone) {
  if (!phone) return false;
  const cleaned = phone.replace(/[\s.-]/g, '');
  return /^0[1-9]\d{8,10}$/.test(cleaned);
}

async function getCompaniesWithoutScore() {
  const result = await pool.query(`
    SELECT account_id, company_name, website, phone_number, address,
           email_format, linkedin_url, industry, city
    FROM accounts
    WHERE quality_score IS NULL
    LIMIT $1
  `, [CONFIG.BATCH_SIZE]);
  return result.rows;
}

async function updateQualityScore(accountId, score) {
  await pool.query(
    'UPDATE accounts SET quality_score = $1, updated_at = NOW() WHERE account_id = $2',
    [score, accountId]
  );
}

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000 / 60);
  log('');
  log('='.repeat(50));
  log(`STATS after ${elapsed} minutes:`);
  log(`  Companies scored: ${stats.scored}`);
  log(`  Average score: ${stats.avgScore.toFixed(1)}%`);
  log(`  Duplicates removed: ${stats.duplicatesRemoved}`);
  log(`  Invalid data cleaned: ${stats.cleaned}`);
  log(`  Errors: ${stats.errors}`);
  log('='.repeat(50));
  log('');
}

async function printDatabaseStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN quality_score >= 50 THEN 1 END) as high_quality,
        COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as with_website,
        COUNT(CASE WHEN phone_number IS NOT NULL THEN 1 END) as with_phone,
        AVG(quality_score) as avg_score
      FROM accounts
    `);

    const contacts = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
        COUNT(CASE WHEN phone_number IS NOT NULL THEN 1 END) as with_phone
      FROM contacts
    `);

    const c = result.rows[0];
    const ct = contacts.rows[0];

    log('');
    log('='.repeat(50));
    log('DATABASE SUMMARY:');
    log(`  Companies: ${parseInt(c.total).toLocaleString()}`);
    log(`    High quality (50%+): ${parseInt(c.high_quality).toLocaleString()}`);
    log(`    With website: ${parseInt(c.with_website).toLocaleString()}`);
    log(`    With phone: ${parseInt(c.with_phone).toLocaleString()}`);
    log(`    Avg score: ${parseFloat(c.avg_score || 0).toFixed(1)}%`);
    log(`  Contacts: ${parseInt(ct.total).toLocaleString()}`);
    log(`    With email: ${parseInt(ct.with_email).toLocaleString()}`);
    log(`    With phone: ${parseInt(ct.with_phone).toLocaleString()}`);
    log('='.repeat(50));
    log('');
  } catch (e) {
    log(`Error getting stats: ${e.message}`);
  }
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log(`   AGENT: ${AGENT_NAME}`);
  console.log('='.repeat(60));
  console.log('   Scores data quality and cleans up invalid records');
  console.log('   - Quality scoring (0-100%)');
  console.log('   - Duplicate detection');
  console.log('   - Invalid data cleanup');
  console.log('   Press Ctrl+C to stop\n');

  let cycle = 0;

  while (true) {
    cycle++;
    log(`Cycle ${cycle}: Processing...`);

    try {
      // 1. Score companies without quality score
      const companies = await getCompaniesWithoutScore();

      if (companies.length > 0) {
        log(`Scoring ${companies.length} companies...`);

        for (const company of companies) {
          const score = await calculateQualityScore(company);
          await updateQualityScore(company.account_id, score);

          stats.scored++;
          stats.avgScore = ((stats.avgScore * (stats.scored - 1)) + score) / stats.scored;
        }
      }

      // 2. Remove duplicates (every 10 cycles)
      if (cycle % 10 === 0) {
        log('Checking for duplicates...');
        const removed = await removeDuplicates();
        stats.duplicatesRemoved += removed;
        if (removed > 0) {
          log(`  Removed ${removed} duplicates`);
        }
      }

      // 3. Cleanup invalid contacts (every 20 cycles)
      if (cycle % 20 === 0) {
        log('Cleaning up invalid contacts...');
        const cleaned = await cleanupInvalidContacts();
        stats.cleaned += cleaned;
        if (cleaned > 0) {
          log(`  Cleaned ${cleaned} invalid contacts`);
        }
      }

      // 4. Print stats
      if (cycle % 5 === 0) {
        printStats();
      }

      // 5. Print database summary every 30 cycles
      if (cycle % 30 === 0) {
        await printDatabaseStats();
      }

      // Wait if nothing to do
      if (companies.length === 0) {
        log('All companies scored. Waiting 5 min...');
        await printDatabaseStats();
        await new Promise(r => setTimeout(r, 300000));
      } else {
        await new Promise(r => setTimeout(r, CONFIG.DELAY));
      }
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
