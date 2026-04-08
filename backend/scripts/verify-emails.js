#!/usr/bin/env node

/**
 * EMAIL VERIFICATION SCRIPT
 *
 * Verifies all contact emails in the database using SMTP checking.
 * Free and unlimited - no API keys needed.
 *
 * Usage: node scripts/verify-emails.js
 */

require('dotenv').config();
const { pool } = require('../src/db/connection');
const { verifyEmail } = require('../src/services/emailVerifier');

const CONFIG = {
  BATCH_SIZE: 20,
  PARALLEL: 5,
  DELAY_BETWEEN_BATCHES: 2000, // ms - be respectful to mail servers
};

let stats = {
  processed: 0,
  valid: 0,
  invalid: 0,
  unknown: 0,
  errors: 0,
  start: Date.now()
};

async function ensureColumns() {
  try {
    await pool.query(`
      ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS email_verification_score INTEGER DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS email_verification_reason TEXT DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP DEFAULT NULL
    `);
    console.log('✓ Database columns ready');
  } catch (err) {
    // Columns might already exist
    console.log('  Database columns checked');
  }
}

async function getUnverifiedEmails(limit) {
  const result = await pool.query(`
    SELECT contact_id, email, first_name, last_name
    FROM contacts
    WHERE email IS NOT NULL
      AND email != ''
      AND email_verified IS NULL
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

async function updateContactVerification(contactId, verificationResult) {
  await pool.query(`
    UPDATE contacts
    SET
      email_verified = $2,
      email_verification_score = $3,
      email_verification_reason = $4,
      verified_at = NOW()
    WHERE contact_id = $1
  `, [
    contactId,
    verificationResult.valid,
    verificationResult.score,
    verificationResult.reason
  ]);
}

async function verifyBatch(contacts) {
  const results = [];

  // Process in smaller parallel batches
  for (let i = 0; i < contacts.length; i += CONFIG.PARALLEL) {
    const batch = contacts.slice(i, i + CONFIG.PARALLEL);

    const batchResults = await Promise.all(
      batch.map(async (contact) => {
        try {
          const result = await verifyEmail(contact.email);
          await updateContactVerification(contact.contact_id, result);

          stats.processed++;
          if (result.valid === true) stats.valid++;
          else if (result.valid === false) stats.invalid++;
          else stats.unknown++;

          return {
            contact,
            result
          };
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

  console.log('\n' + '='.repeat(50));
  console.log(`[STATS] Processed: ${stats.processed} | Rate: ${rate}/min`);
  console.log('-'.repeat(50));
  console.log(`  ✓ Valid: ${stats.valid}`);
  console.log(`  ✗ Invalid: ${stats.invalid}`);
  console.log(`  ? Unknown: ${stats.unknown}`);
  console.log(`  ! Errors: ${stats.errors}`);
  console.log('='.repeat(50) + '\n');
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   EMAIL VERIFICATION SYSTEM');
  console.log('='.repeat(60));
  console.log('   Free SMTP-based email verification');
  console.log('   - Syntax validation');
  console.log('   - MX record checking');
  console.log('   - SMTP mailbox verification');
  console.log('   - Disposable email detection');
  console.log('   Press Ctrl+C to stop\n');

  await ensureColumns();

  let batchNum = 0;

  while (true) {
    batchNum++;
    console.log(`[Batch ${batchNum}] Loading unverified emails...`);

    const contacts = await getUnverifiedEmails(CONFIG.BATCH_SIZE);

    if (contacts.length === 0) {
      console.log('✓ All emails have been verified!');
      break;
    }

    console.log(`  Verifying ${contacts.length} emails...\n`);

    const results = await verifyBatch(contacts);

    // Print results
    for (const { contact, result, error } of results) {
      if (error) {
        console.log(`  ✗ ${contact.email}: ERROR - ${error}`);
      } else if (result.valid === true) {
        console.log(`  ✓ ${contact.email}: VALID (score: ${result.score})`);
      } else if (result.valid === false) {
        console.log(`  ✗ ${contact.email}: INVALID - ${result.reason}`);
      } else {
        console.log(`  ? ${contact.email}: UNKNOWN - ${result.reason}`);
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
  console.log('Email verification complete!');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
