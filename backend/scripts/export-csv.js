#!/usr/bin/env node

/**
 * DATA BUNKER — CSV EXPORTER
 *
 * Exports enriched company and contact data to CSV files.
 *
 * Usage:
 *   node scripts/export-csv.js                   → exports all 3 files
 *   node scripts/export-csv.js --with-email       → contacts with email only
 *   node scripts/export-csv.js --country=GB       → filter by country
 *   node scripts/export-csv.js --industry=Tech    → filter by industry (partial match)
 *   node scripts/export-csv.js --limit=5000       → cap rows per file
 *   node scripts/export-csv.js --dir=./my-exports → custom output folder
 *
 * Output files (written to ./exports/ by default):
 *   companies.csv  — one row per company, all enriched fields
 *   contacts.csv   — one row per contact, all enriched fields
 *   combined.csv   — one row per contact WITH all company fields merged in
 *                    (best for CRM import / outreach tools)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/db/connection');
const fs   = require('fs');
const path = require('path');

// ─── Parse CLI args ───────────────────────────────────────────────────────────
const argv        = process.argv.slice(2);
const getArg      = (key) => (argv.find(a => a.startsWith(`--${key}=`)) || '').split('=').slice(1).join('=') || null;
const hasFlag     = (key) => argv.includes(`--${key}`);

const WITH_EMAIL  = hasFlag('with-email');
const COUNTRY     = getArg('country');
const INDUSTRY    = getArg('industry');
const LIMIT       = parseInt(getArg('limit') || '0') || 0;   // 0 = no limit
const OUT_DIR     = getArg('dir') || path.join(__dirname, '../../exports');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape a value for CSV: wrap in quotes, escape inner quotes */
function esc(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).replace(/\r?\n/g, ' ').trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(...vals) {
  return vals.map(esc).join(',');
}

function writeCSV(filePath, header, rows) {
  const lines = [header, ...rows];
  fs.writeFileSync(filePath, lines.join('\r\n') + '\r\n', 'utf8');
}

function now() {
  return new Date().toLocaleTimeString();
}

function log(msg) {
  console.log(`[${now()}] ${msg}`);
}

// ─── Build WHERE clauses ──────────────────────────────────────────────────────
function buildAccountsWhere(alias = 'a') {
  const clauses = [];
  const params  = [];

  if (COUNTRY) {
    params.push(`%${COUNTRY}%`);
    clauses.push(`${alias}.country ILIKE $${params.length}`);
  }
  if (INDUSTRY) {
    params.push(`%${INDUSTRY}%`);
    clauses.push(`${alias}.industry ILIKE $${params.length}`);
  }

  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

function buildContactsWhere(alias = 'c', accountAlias = 'a') {
  const clauses = [];
  const params  = [];

  if (WITH_EMAIL) {
    clauses.push(`${alias}.email IS NOT NULL AND ${alias}.email != ''`);
  }
  if (COUNTRY) {
    params.push(`%${COUNTRY}%`);
    clauses.push(`${accountAlias}.country ILIKE $${params.length}`);
  }
  if (INDUSTRY) {
    params.push(`%${INDUSTRY}%`);
    clauses.push(`${accountAlias}.industry ILIKE $${params.length}`);
  }

  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

// ─── EXPORT: COMPANIES ────────────────────────────────────────────────────────
async function exportCompanies(outPath) {
  log('Exporting companies…');

  const { where, params } = buildAccountsWhere('a');
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';

  const result = await pool.query(`
    SELECT
      a.account_id,
      a.company_name,
      a.industry,
      a.company_category,
      a.company_size,
      a.revenue,
      a.country,
      a.state_region,
      a.city,
      a.district,
      a.ward,
      a.address,
      a.headquarters_address,
      a.website,
      a.phone_number,
      a.email_format,
      a.linkedin_url,
      a.rating,
      a.total_ratings,
      a.verified,
      a.data_source,
      a.created_at,
      -- Count contacts linked to this company
      COUNT(c.contact_id) AS contact_count,
      COUNT(CASE WHEN c.email IS NOT NULL THEN 1 END) AS contacts_with_email
    FROM accounts a
    LEFT JOIN contacts c ON c.linked_account_id = a.account_id
    ${where}
    GROUP BY a.account_id
    ORDER BY a.company_name ASC
    ${limitClause}
  `, params);

  const header = row(
    'Account ID', 'Company Name', 'Industry', 'Category', 'Company Size', 'Revenue',
    'Country', 'State/Region', 'City', 'District', 'Ward',
    'Address', 'HQ Address',
    'Website', 'Phone', 'Email Format', 'LinkedIn URL',
    'Rating', 'Total Ratings',
    'Verified', 'Data Source', 'Created At',
    'Total Contacts', 'Contacts With Email'
  );

  const rows = result.rows.map(r => row(
    r.account_id, r.company_name, r.industry, r.company_category, r.company_size, r.revenue,
    r.country, r.state_region, r.city, r.district, r.ward,
    r.address, r.headquarters_address,
    r.website, r.phone_number, r.email_format, r.linkedin_url,
    r.rating, r.total_ratings,
    r.verified ? 'Yes' : 'No', r.data_source, r.created_at,
    r.contact_count, r.contacts_with_email
  ));

  writeCSV(outPath, header, rows);
  log(`  ✓ ${rows.length.toLocaleString()} companies → ${path.basename(outPath)}`);
  return rows.length;
}

// ─── EXPORT: CONTACTS ─────────────────────────────────────────────────────────
async function exportContacts(outPath) {
  log('Exporting contacts…');

  const { where, params } = buildContactsWhere('c', 'a');
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';

  const result = await pool.query(`
    SELECT
      c.contact_id,
      c.first_name,
      c.last_name,
      (c.first_name || ' ' || c.last_name)    AS full_name,
      c.job_title,
      c.email,
      c.phone_number                           AS contact_phone,
      c.country                                AS contact_country,
      c.city                                   AS contact_city,
      c.data_source,
      c.verified,
      c.verified_at,
      c.confidence_score,
      c.companies_house_id,
      c.created_at,
      -- Company fields
      a.account_id,
      a.company_name,
      a.website,
      a.phone_number                           AS company_phone,
      a.email_format,
      a.linkedin_url,
      a.industry,
      a.company_category,
      a.company_size,
      a.country                                AS company_country,
      a.state_region,
      a.city                                   AS company_city,
      a.address,
      a.verified                               AS company_verified
    FROM contacts c
    JOIN accounts a ON a.account_id = c.linked_account_id
    ${where}
    ORDER BY a.company_name ASC, c.last_name ASC, c.first_name ASC
    ${limitClause}
  `, params);

  const header = row(
    'Contact ID', 'First Name', 'Last Name', 'Full Name', 'Job Title',
    'Email', 'Contact Phone',
    'Contact Country', 'Contact City',
    'Data Source', 'Verified', 'Verified At', 'Confidence Score', 'Companies House ID',
    'Created At',
    // Company columns
    'Account ID', 'Company Name', 'Company Website', 'Company Phone',
    'Email Format', 'Company LinkedIn', 'Industry', 'Company Category',
    'Company Size', 'Company Country', 'State/Region', 'Company City', 'Company Address',
    'Company Verified'
  );

  const rows = result.rows.map(r => row(
    r.contact_id, r.first_name, r.last_name, r.full_name, r.job_title,
    r.email, r.contact_phone,
    r.contact_country, r.contact_city,
    r.data_source, r.verified ? 'Yes' : 'No', r.verified_at, r.confidence_score, r.companies_house_id,
    r.created_at,
    r.account_id, r.company_name, r.website, r.company_phone,
    r.email_format, r.linkedin_url, r.industry, r.company_category,
    r.company_size, r.company_country, r.state_region, r.company_city, r.address,
    r.company_verified ? 'Yes' : 'No'
  ));

  writeCSV(outPath, header, rows);
  log(`  ✓ ${rows.length.toLocaleString()} contacts → ${path.basename(outPath)}`);
  return rows.length;
}

// ─── EXPORT: COMBINED (flat, one row per contact) ─────────────────────────────
async function exportCombined(outPath) {
  log('Exporting combined (contacts + company in one row)…');

  const { where, params } = buildContactsWhere('c', 'a');
  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';

  const result = await pool.query(`
    SELECT
      -- Contact identity
      c.first_name,
      c.last_name,
      (c.first_name || ' ' || c.last_name)    AS full_name,
      c.job_title,
      -- Contact email (direct or generated via format)
      c.email,
      -- Contact phone (if any)
      c.phone_number                           AS contact_phone,
      -- Company identity
      a.company_name,
      a.industry,
      a.company_size,
      -- Company contact info
      a.website,
      a.phone_number                           AS company_phone,
      a.email_format,
      a.linkedin_url,
      -- Location
      a.country,
      a.state_region,
      a.city,
      a.address,
      -- Meta
      c.data_source                            AS contact_source,
      c.confidence_score,
      c.verified                               AS contact_verified,
      a.data_source                            AS company_source,
      a.verified                               AS company_verified,
      c.created_at
    FROM contacts c
    JOIN accounts a ON a.account_id = c.linked_account_id
    ${where}
    ORDER BY a.company_name ASC, c.last_name ASC, c.first_name ASC
    ${limitClause}
  `, params);

  const header = row(
    // Person
    'First Name', 'Last Name', 'Full Name', 'Job Title', 'Email', 'Direct Phone',
    // Company
    'Company', 'Industry', 'Company Size', 'Website', 'Company Phone',
    'Email Format', 'LinkedIn',
    // Location
    'Country', 'State/Region', 'City', 'Address',
    // Meta
    'Contact Source', 'Confidence Score', 'Contact Verified',
    'Company Source', 'Company Verified', 'Added On'
  );

  const rows = result.rows.map(r => row(
    r.first_name, r.last_name, r.full_name, r.job_title, r.email, r.contact_phone,
    r.company_name, r.industry, r.company_size, r.website, r.company_phone,
    r.email_format, r.linkedin_url,
    r.country, r.state_region, r.city, r.address,
    r.contact_source, r.confidence_score,
    r.contact_verified ? 'Yes' : 'No',
    r.company_source,
    r.company_verified ? 'Yes' : 'No',
    r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : ''
  ));

  writeCSV(outPath, header, rows);
  log(`  ✓ ${rows.length.toLocaleString()} rows → ${path.basename(outPath)}`);
  return rows.length;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Create output directory
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('\n' + '='.repeat(60));
  console.log('   DATA BUNKER — CSV EXPORT');
  console.log('='.repeat(60));
  console.log(`   Output dir:  ${OUT_DIR}`);
  if (WITH_EMAIL) console.log('   Filter:      contacts with email only');
  if (COUNTRY)    console.log(`   Filter:      country = "${COUNTRY}"`);
  if (INDUSTRY)   console.log(`   Filter:      industry contains "${INDUSTRY}"`);
  if (LIMIT)      console.log(`   Limit:       ${LIMIT.toLocaleString()} rows per file`);
  console.log('='.repeat(60) + '\n');

  // Quick totals for reference
  try {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM accounts) AS companies,
        (SELECT COUNT(*) FROM contacts) AS contacts,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL) AS contacts_with_email
    `);
    const t = totals.rows[0];
    log(`Database: ${parseInt(t.companies).toLocaleString()} companies | ` +
        `${parseInt(t.contacts).toLocaleString()} contacts ` +
        `(${parseInt(t.contacts_with_email).toLocaleString()} with email)`);
    console.log('');
  } catch (e) {
    log(`Could not fetch totals: ${e.message}`);
  }

  const companiesPath = path.join(OUT_DIR, `companies_${timestamp}.csv`);
  const contactsPath  = path.join(OUT_DIR, `contacts_${timestamp}.csv`);
  const combinedPath  = path.join(OUT_DIR, `combined_${timestamp}.csv`);

  const [numCompanies, numContacts, numCombined] = await Promise.all([
    exportCompanies(companiesPath),
    exportContacts(contactsPath),
    exportCombined(combinedPath),
  ]);

  console.log('\n' + '='.repeat(60));
  console.log('   EXPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`   companies.csv  → ${numCompanies.toLocaleString()} rows`);
  console.log(`   contacts.csv   → ${numContacts.toLocaleString()} rows`);
  console.log(`   combined.csv   → ${numCombined.toLocaleString()} rows  ← best for CRM/outreach`);
  console.log(`\n   Files saved to: ${OUT_DIR}`);
  console.log('='.repeat(60) + '\n');
}

main()
  .catch(e => { console.error('Export failed:', e.message); process.exit(1); })
  .finally(() => pool.end());
