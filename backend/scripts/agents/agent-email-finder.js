#!/usr/bin/env node

/**
 * AGENT: EMAIL FINDER
 *
 * Finds and verifies emails for contacts using:
 * - Email pattern generation (first.last@, flast@, etc.)
 * - SMTP verification (free, unlimited)
 * - MX record checking
 *
 * Works like Hunter.io / Mailmeteor but FREE
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../../src/db/connection');
const TURBO_CONFIG = require('./turbo-config');
const emailIntelligence = require('../../src/services/emailIntelligenceService');

const AGENT_NAME = 'EMAIL-FINDER';
const CONFIG = TURBO_CONFIG.EMAIL;

let stats = {
  processed: 0,
  found: 0,
  verified: 0,
  invalid: 0,
  errors: 0,
  start: Date.now()
};

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${AGENT_NAME}] ${msg}`);
}

// Find email for a contact
async function findEmailForContact(contact) {
  const found = await emailIntelligence.findForContact(contact.contact_id, { save: true });
  if (found.best && found.best.confidence !== 'invalid') {
    return { email: found.best.email, reason: found.best.confidence, score: found.best.score };
  }
  return { email: null, reason: found.error || 'not_found' };
}

async function getContactsWithoutEmail() {
  const result = await pool.query(`
    SELECT c.contact_id, c.first_name, c.last_name, c.linked_account_id
    FROM contacts c
    JOIN accounts a ON c.linked_account_id = a.account_id
    WHERE c.email IS NULL
    AND a.website IS NOT NULL
    ORDER BY c.created_at DESC
    LIMIT $1
  `, [CONFIG.BATCH_SIZE]);
  return result.rows;
}

async function updateContactEmail(contactId, email) {
  await pool.query(
    'UPDATE contacts SET email = $1, updated_at = NOW() WHERE contact_id = $2',
    [email, contactId]
  );
  await emailIntelligence.verifyContactEmail(contactId).catch(() => {});
}

function printStats() {
  const elapsed = Math.floor((Date.now() - stats.start) / 1000 / 60);
  log('');
  log('='.repeat(50));
  log(`STATS after ${elapsed} minutes:`);
  log(`  Processed: ${stats.processed}`);
  log(`  Emails found: ${stats.found}`);
  log(`  Verified: ${stats.verified}`);
  log(`  Invalid: ${stats.invalid}`);
  log(`  Errors: ${stats.errors}`);
  log('='.repeat(50));
  log('');
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log(`   AGENT: ${AGENT_NAME}`);
  console.log('='.repeat(60));
  console.log('   Finds emails for contacts using pattern + SMTP verification');
  console.log('   FREE unlimited email finding (like Hunter.io)');
  console.log('   Press Ctrl+C to stop\n');

  let batch = 0;

  while (true) {
    batch++;
    log(`Batch ${batch}: Loading contacts without emails...`);

    try {
      const contacts = await getContactsWithoutEmail();

      if (contacts.length === 0) {
        log('No contacts without emails. Waiting 5 min...');
        await new Promise(r => setTimeout(r, 300000));
        continue;
      }

      log(`Processing ${contacts.length} contacts...`);

      for (let i = 0; i < contacts.length; i += CONFIG.PARALLEL) {
        const chunk = contacts.slice(i, i + CONFIG.PARALLEL);

        const results = await Promise.all(chunk.map(async (contact) => {
          try {
            const result = await findEmailForContact(contact);
            stats.processed++;

            if (result?.email) {
              await updateContactEmail(contact.contact_id, result.email);
              stats.found++;
              stats.verified++;
              return { contact, email: result.email };
            } else {
              stats.invalid++;
              return { contact, email: null };
            }
          } catch (e) {
            stats.errors++;
            return { contact, email: null };
          }
        }));

        for (const r of results) {
          if (r.email) {
            log(`  + ${r.contact.first_name} ${r.contact.last_name}: ${r.email}`);
          }
        }
      }

      if (batch % 5 === 0) printStats();

      await new Promise(r => setTimeout(r, CONFIG.DELAY));
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
