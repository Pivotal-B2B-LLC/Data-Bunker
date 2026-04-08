#!/usr/bin/env node
'use strict';

/**
 * AGENT: QWEN-ENRICHER
 *
 * Continuously scans the database for records that are missing key fields
 * (industry, country, normalised job title, seniority) and uses the local
 * Qwen 2.5 (0.5B) model to fill in the blanks.
 *
 * What it enriches:
 *   contacts  — missing industry on linked account, missing country, unnormalised job title
 *   accounts  — missing industry, missing description, missing company_size
 *
 * Runs forever until killed. Safe to restart at any time (idempotent).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../../src/db/connection');
const qwen     = require('../../src/services/qwenService');
const path     = require('path');

const BATCH_SIZE   = 10;    // records per cycle (keep small — 0.5B is CPU-only)
const CYCLE_DELAY  = 2000;  // ms between batches
const IDLE_DELAY   = 30000; // ms when nothing left to do

// ── Colour helpers ─────────────────────────────────────────────────────────────
const CYAN   = '\x1b[96m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function log(msg, color = DIM) {
  process.stdout.write(`${color}[${new Date().toLocaleTimeString()}] [QWEN-ENRICHER] ${msg}${RESET}\n`);
}

// ── Make sure the DB has the extra columns we'll write to ─────────────────────
async function ensureSchema() {
  const queries = [
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS seniority VARCHAR(50)`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS job_title_normalised VARCHAR(300)`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_format_guess VARCHAR(30)`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS qwen_enriched BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(500)`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS connection_degree VARCHAR(20)`,
    `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS company_type VARCHAR(50)`,
    `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS qwen_enriched BOOLEAN DEFAULT FALSE`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_qwen ON contacts(qwen_enriched)`,
    `CREATE INDEX IF NOT EXISTS idx_accounts_qwen ON accounts(qwen_enriched)`,
  ];
  for (const q of queries) {
    await pool.query(q).catch(() => {}); // skip if column already exists
  }
}

// ── Enrich a batch of contacts ─────────────────────────────────────────────────
async function enrichContacts() {
  const { rows } = await pool.query(`
    SELECT c.contact_id, c.first_name, c.last_name, c.job_title,
           c.city, c.country,
           a.company_name, a.industry
    FROM contacts c
    JOIN accounts a ON a.account_id = c.linked_account_id
    WHERE (c.qwen_enriched IS NULL OR c.qwen_enriched = FALSE)
      AND c.first_name IS NOT NULL
    ORDER BY c.contact_id DESC
    LIMIT $1
  `, [BATCH_SIZE]);

  if (rows.length === 0) return 0;

  let enrichedCount = 0;
  for (const row of rows) {
    try {
      const result = await qwen.enrichContact({
        firstName: row.first_name,
        lastName:  row.last_name,
        jobTitle:  row.job_title,
        company:   row.company_name,
        city:      row.city,
        country:   row.country,
        industry:  row.industry,
      });

      if (result) {
        await pool.query(`
          UPDATE contacts SET
            job_title_normalised = COALESCE($1, job_title_normalised),
            seniority            = COALESCE($2, seniority),
            email_format_guess   = COALESCE($3, email_format_guess),
            country              = COALESCE(NULLIF(country,''), $4),
            qwen_enriched        = TRUE,
            updated_at           = NOW()
          WHERE contact_id = $5
        `, [
          result.jobTitleNormalised || null,
          result.seniority          || null,
          result.emailFormatGuess   || null,
          result.country            || null,
          row.contact_id,
        ]);
        enrichedCount++;
      } else {
        // Mark as processed even if result was null to avoid re-trying
        await pool.query(`UPDATE contacts SET qwen_enriched=TRUE WHERE contact_id=$1`, [row.contact_id]);
      }
    } catch (e) {
      log(`Contact ${row.contact_id} error: ${e.message}`, YELLOW);
    }
  }
  return enrichedCount;
}

// ── Enrich a batch of accounts (companies) ────────────────────────────────────
async function enrichAccounts() {
  const { rows } = await pool.query(`
    SELECT account_id, company_name, city, country, website, company_size, industry
    FROM accounts
    WHERE (qwen_enriched IS NULL OR qwen_enriched = FALSE)
      AND (industry IS NULL OR description IS NULL)
      AND company_name IS NOT NULL
    ORDER BY account_id DESC
    LIMIT $1
  `, [BATCH_SIZE]);

  if (rows.length === 0) return 0;

  let enrichedCount = 0;
  for (const row of rows) {
    try {
      const result = await qwen.enrichCompany({
        company:     row.company_name,
        city:        row.city,
        country:     row.country,
        website:     row.website,
        companySize: row.company_size,
      });

      if (result) {
        await pool.query(`
          UPDATE accounts SET
            industry     = COALESCE(NULLIF(industry,''), $1),
            description  = COALESCE(NULLIF(description,''), $2),
            company_type = COALESCE($3, company_type),
            company_size = COALESCE(NULLIF(company_size,''), $4),
            qwen_enriched = TRUE,
            updated_at   = NOW()
          WHERE account_id = $5
        `, [
          result.industry     || null,
          result.description  || null,
          result.companyType  || null,
          result.enrichedSize || null,
          row.account_id,
        ]);
        enrichedCount++;
      } else {
        await pool.query(`UPDATE accounts SET qwen_enriched=TRUE WHERE account_id=$1`, [row.account_id]);
      }
    } catch (e) {
      log(`Account ${row.account_id} error: ${e.message}`, YELLOW);
    }
  }
  return enrichedCount;
}

// ── Stats ──────────────────────────────────────────────────────────────────────
async function printStats() {
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM contacts WHERE qwen_enriched = TRUE) AS contacts_enriched,
        (SELECT COUNT(*) FROM contacts WHERE qwen_enriched IS NULL OR qwen_enriched = FALSE) AS contacts_pending,
        (SELECT COUNT(*) FROM accounts WHERE qwen_enriched = TRUE) AS accounts_enriched,
        (SELECT COUNT(*) FROM accounts WHERE qwen_enriched IS NULL OR qwen_enriched = FALSE
           AND (industry IS NULL OR description IS NULL)) AS accounts_pending
    `);
    const d = r.rows[0];
    log(`Stats: contacts enriched=${d.contacts_enriched} pending=${d.contacts_pending} | accounts enriched=${d.accounts_enriched} pending=${d.accounts_pending}`, CYAN);
  } catch (_) {}
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function run() {
  console.log('');
  console.log(`${CYAN}${'='.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}   AGENT: QWEN-ENRICHER${RESET}`);
  console.log(`${CYAN}${'='.repeat(60)}${RESET}`);
  console.log(`   Model  : ${YELLOW}qwen2.5:0.5b${RESET}  (local CPU)`);
  console.log(`   Tasks  : contact enrichment, company enrichment`);
  console.log(`   Fields : industry, seniority, country, job title normalisation`);
  console.log('');

  // Wait for Ollama to be ready
  let ready = false;
  while (!ready) {
    ready = await qwen.isAvailable().catch(() => false);
    if (!ready) {
      log('Waiting for Qwen / Ollama server to start…', YELLOW);
      await new Promise(r => setTimeout(r, 5000));
      qwen.available = null; // reset cache so we retry
    }
  }
  log('Qwen 2.5:0.5b is online ✓', GREEN);

  await ensureSchema();
  log('Schema ready', DIM);

  let cycles = 0;

  while (true) {
    try {
      const c = await enrichContacts();
      const a = await enrichAccounts();

      if (c > 0 || a > 0) {
        log(`Enriched ${c} contacts, ${a} companies`, GREEN);
      }

      cycles++;
      if (cycles % 20 === 0) await printStats();

      const total = c + a;
      await new Promise(r => setTimeout(r, total === 0 ? IDLE_DELAY : CYCLE_DELAY));
    } catch (e) {
      log(`Loop error: ${e.message}`, YELLOW);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

run().catch(e => {
  console.error('[QWEN-ENRICHER] Fatal error:', e.message);
  process.exit(1);
});
