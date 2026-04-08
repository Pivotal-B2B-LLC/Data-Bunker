#!/usr/bin/env node

/**
 * EMAIL FINDER SCRIPT
 *
 * Finds email addresses for contacts using name + company domain
 * Same as Mailmeteor/Hunter.io but FREE and UNLIMITED
 *
 * Usage: node scripts/find-emails.js
 */

require('dotenv').config();
const { pool } = require('../src/db/connection');
const { findEmail } = require('../src/services/emailFinder');

const CONFIG = {
  BATCH_SIZE: 20,
  PARALLEL: 3,
  DELAY_BETWEEN_BATCHES: 3000, // Be respectful to mail servers
  MAX_PATTERNS_TO_TRY: 8
};

let stats = {
  processed: 0,
  found: 0,
  notFound: 0,
  errors: 0,
  start: Date.now()
};

async function getContactsWithoutEmail(limit) {
  const result = await pool.query(`
    SELECT
      c.contact_id,
      c.first_name,
      c.last_name,
      c.job_title,
      a.company_name,
      a.website
    FROM contacts c
    LEFT JOIN accounts a ON c.linked_account_id = a.account_id
    WHERE (c.email IS NULL OR c.email = '')
      AND c.first_name IS NOT NULL
      AND c.last_name IS NOT NULL
      AND a.website IS NOT NULL
      AND a.website != ''
    ORDER BY c.created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

async function updateContactEmail(contactId, email, verified = true) {
  await pool.query(`
    UPDATE contacts
    SET
      email = $2,
      email_verified = $3,
      email_verification_reason = 'found_by_pattern',
      verified_at = NOW(),
      updated_at = NOW()
    WHERE contact_id = $1
  `, [contactId, email, verified]);
}

function extractDomain(website) {
  if (!website) return null;
  try {
    let domain = website.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
    return domain;
  } catch {
    return null;
  }
}

async function processBatch(contacts) {
  const results = [];

  for (let i = 0; i < contacts.length; i += CONFIG.PARALLEL) {
    const batch = contacts.slice(i, i + CONFIG.PARALLEL);

    const batchResults = await Promise.all(
      batch.map(async (contact) => {
        const fullName = `${contact.first_name} ${contact.last_name}`.trim();
        const domain = extractDomain(contact.website);

        if (!domain) {
          stats.errors++;
          return { contact, error: 'no_domain' };
        }

        try {
          const result = await findEmail(fullName, domain, {
            maxAttempts: CONFIG.MAX_PATTERNS_TO_TRY
          });

          stats.processed++;

          if (result.found && result.email) {
            stats.found++;
            await updateContactEmail(contact.contact_id, result.email);
            return { contact, result };
          } else {
            stats.notFound++;
            return { contact, result };
          }
        } catch (err) {
          stats.errors++;
          return { contact, error: err.message };
        }
      })
    );

    results.push(...batchResults);
  }

  return results;
}

function printStats() {
  const elapsed = (Date.now() - stats.start) / 1000;
  const rate = (stats.processed / elapsed * 60).toFixed(1);

  console.log('\n' + '='.repeat(55));
  console.log(`[STATS] Processed: ${stats.processed} | Rate: ${rate}/min`);
  console.log('-'.repeat(55));
  console.log(`  ✓ Found: ${stats.found}`);
  console.log(`  ✗ Not Found: ${stats.notFound}`);
  console.log(`  ! Errors: ${stats.errors}`);
  console.log(`  Success Rate: ${stats.processed > 0 ? ((stats.found / stats.processed) * 100).toFixed(1) : 0}%`);
  console.log('='.repeat(55) + '\n');
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   EMAIL FINDER - Like Mailmeteor but FREE');
  console.log('='.repeat(60));
  console.log('   Finds emails by: Name + Company Domain');
  console.log('   - Generates email patterns (first.last, flast, etc)');
  console.log('   - SMTP verifies each pattern');
  console.log('   - Saves valid emails to database');
  console.log('   Press Ctrl+C to stop\n');

  let batchNum = 0;

  while (true) {
    batchNum++;
    console.log(`[Batch ${batchNum}] Loading contacts without emails...`);

    const contacts = await getContactsWithoutEmail(CONFIG.BATCH_SIZE);

    if (contacts.length === 0) {
      console.log('✓ All contacts processed!');
      break;
    }

    console.log(`  Finding emails for ${contacts.length} contacts...\n`);

    const results = await processBatch(contacts);

    // Print results
    for (const { contact, result, error } of results) {
      const name = `${contact.first_name} ${contact.last_name}`;
      const company = contact.company_name || 'Unknown';

      if (error) {
        console.log(`  ✗ ${name} @ ${company}: ERROR - ${error}`);
      } else if (result?.found) {
        console.log(`  ✓ ${name} @ ${company}: ${result.email}`);
      } else {
        console.log(`  - ${name} @ ${company}: Not found (tried ${result?.attempts || 0} patterns)`);
      }
    }

    // Print stats every 5 batches
    if (batchNum % 5 === 0) {
      printStats();
    }

    // Delay between batches
    await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_BATCHES));
  }

  printStats();
  console.log('Email finding complete!');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
