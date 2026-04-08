#!/usr/bin/env node

/**
 * VERIFY EXISTING CONTACTS
 *
 * Goes through all contacts and verifies each first name using:
 * 1. Local database of 5000+ real names (instant)
 * 2. Blocklist of known non-name words (instant)
 * 3. Bad suffix/pattern detection (instant)
 *
 * Deletes contacts whose first names are not real person names.
 */

require('dotenv').config();
const { pool } = require('../src/db/connection');
const { isValidPersonName, getCacheStats } = require('../src/services/nameVerifier');

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('   VERIFY CONTACTS (Name Database Check)');
  console.log('='.repeat(60));
  console.log('   Checking first names against 5000+ name database');
  console.log('   + blocklist + pattern detection\n');

  const stats = getCacheStats();
  console.log(`   Local name DB: ${stats.localDbSize} known names`);
  console.log(`   Blocked words: ${stats.blockedWords}\n`);

  // Get all contacts
  const result = await pool.query(`
    SELECT contact_id, first_name, last_name, email, job_title
    FROM contacts
    ORDER BY contact_id
  `);

  const contacts = result.rows;
  console.log(`   Total contacts in database: ${contacts.length}\n`);

  if (contacts.length === 0) {
    console.log('   No contacts to verify.');
    process.exit(0);
  }

  const toDelete = [];
  let kept = 0;

  for (const contact of contacts) {
    const isValid = isValidPersonName(contact.first_name, contact.last_name);

    if (isValid) {
      kept++;
    } else {
      toDelete.push(contact);
    }
  }

  console.log(`   Results:`);
  console.log(`     Valid (real person names): ${kept}`);
  console.log(`     Invalid (not recognized): ${toDelete.length}\n`);

  if (toDelete.length > 0) {
    console.log('   Sample contacts being deleted:');
    for (const c of toDelete.slice(0, 30)) {
      const name = `${c.first_name || '?'} ${c.last_name || '?'}`;
      console.log(`     - "${name}" (${c.email || 'no email'}) ${c.job_title || ''}`);
    }
    console.log('');

    console.log('   Deleting unverified contacts...');
    const ids = toDelete.map(c => c.contact_id);
    let deleted = 0;

    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await pool.query(`DELETE FROM contacts WHERE contact_id = ANY($1)`, [batch]);
      deleted += batch.length;
      process.stdout.write(`     Deleted ${deleted}/${toDelete.length}\r`);
    }

    console.log(`\n\n   Deleted ${deleted} unverified contacts.`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('   VERIFICATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`   Kept: ${kept} verified contacts`);
  console.log(`   Deleted: ${toDelete.length} unverified contacts`);
  console.log('='.repeat(60) + '\n');

  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
