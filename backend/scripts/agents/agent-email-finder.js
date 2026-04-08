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
const dns = require('dns').promises;
const net = require('net');
const TURBO_CONFIG = require('./turbo-config');

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

// Generate email permutations
function generateEmailPatterns(firstName, lastName, domain) {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const l = lastName.toLowerCase().replace(/[^a-z]/g, '');

  if (!f || !l || !domain) return [];

  const fi = f.charAt(0);
  const li = l.charAt(0);

  return [
    `${f}.${l}@${domain}`,           // john.smith@
    `${f}${l}@${domain}`,            // johnsmith@
    `${fi}${l}@${domain}`,           // jsmith@
    `${f}${li}@${domain}`,           // johns@
    `${fi}.${l}@${domain}`,          // j.smith@
    `${f}_${l}@${domain}`,           // john_smith@
    `${l}.${f}@${domain}`,           // smith.john@
    `${l}${f}@${domain}`,            // smithjohn@
    `${f}-${l}@${domain}`,           // john-smith@
    `${fi}${l}${fi}@${domain}`,      // jsmithj@ (rare)
    `${f}@${domain}`,                // john@
    `${l}@${domain}`,                // smith@
  ];
}

// Get MX records for domain
async function getMxRecords(domain) {
  try {
    const records = await dns.resolveMx(domain);
    if (records && records.length > 0) {
      records.sort((a, b) => a.priority - b.priority);
      return records[0].exchange;
    }
  } catch (e) {}
  return null;
}

// Verify email via SMTP
async function verifyEmailSMTP(email, mxHost) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    let response = '';

    const finish = (result) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(CONFIG.SMTP_TIMEOUT);

    socket.on('timeout', () => finish({ valid: false, reason: 'timeout' }));
    socket.on('error', () => finish({ valid: false, reason: 'connection_error' }));

    socket.on('data', (data) => {
      response += data.toString();

      if (response.includes('220') && !response.includes('HELO')) {
        socket.write('HELO verify.local\r\n');
      } else if (response.includes('250') && response.includes('HELO')) {
        socket.write('MAIL FROM:<verify@verify.local>\r\n');
      } else if (response.includes('250') && response.includes('MAIL FROM')) {
        socket.write(`RCPT TO:<${email}>\r\n`);
      } else if (response.includes('RCPT TO')) {
        if (response.includes('250')) {
          finish({ valid: true, reason: 'accepted' });
        } else if (response.includes('550') || response.includes('551') || response.includes('552') || response.includes('553')) {
          finish({ valid: false, reason: 'mailbox_not_found' });
        } else if (response.includes('450') || response.includes('451') || response.includes('452')) {
          finish({ valid: false, reason: 'temporary_error' });
        } else {
          finish({ valid: false, reason: 'rejected' });
        }
      }
    });

    socket.connect(25, mxHost, () => {});
  });
}

// Find email for a contact
async function findEmailForContact(contact) {
  if (!contact.first_name || !contact.last_name) return null;

  // Get company domain
  const companyResult = await pool.query(
    'SELECT website FROM accounts WHERE account_id = $1',
    [contact.linked_account_id]
  );

  if (companyResult.rows.length === 0 || !companyResult.rows[0].website) return null;

  const website = companyResult.rows[0].website;
  const domain = website.toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  if (!domain || !domain.includes('.')) return null;

  // Get MX server
  const mxHost = await getMxRecords(domain);
  if (!mxHost) return { email: null, reason: 'no_mx_records' };

  // Generate and test email patterns
  const patterns = generateEmailPatterns(contact.first_name, contact.last_name, domain);

  for (const email of patterns) {
    try {
      const result = await verifyEmailSMTP(email, mxHost);
      if (result.valid) {
        return { email, reason: 'verified' };
      }
    } catch (e) {
      // Continue to next pattern
    }
  }

  return { email: null, reason: 'not_found' };
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
