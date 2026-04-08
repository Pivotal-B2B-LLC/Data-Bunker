#!/usr/bin/env node

/**
 * Officers Import Script
 * Imports officers from Companies House API into the database
 * Works with simplified officers table schema
 */

const axios = require('axios');
const db = require('../src/db/database');

const API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const BASE_URL = 'https://api.company-information.service.gov.uk';
const BATCH_SIZE = 100;
const DELAY_MS = 100; // 100ms between requests = 600 per minute max

let totalImported = 0;
let totalSkipped = 0;
let totalErrors = 0;

/**
 * Fetch officers from Companies House API
 */
async function fetchOfficers(companyNumber) {
  try {
    const auth = Buffer.from(`${API_KEY}:`).toString('base64');
    const response = await axios.get(
      `${BASE_URL}/company/${companyNumber}/officers`,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    );
    return response.data.items || [];
  } catch (error) {
    if (error.response?.status === 404) {
      return null; // No officers found
    }
    throw error;
  }
}

/**
 * Parse date from Companies House format
 */
function parseDate(dateObj) {
  if (!dateObj) return null;
  const { year, month, day } = dateObj;
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Import officers for a single company
 */
async function importCompanyOfficers(companyNumber, companyId) {
  try {
    const officers = await fetchOfficers(companyNumber);
    
    if (!officers || officers.length === 0) {
      return { imported: 0, skipped: 1 };
    }

    let imported = 0;
    
    for (const officer of officers) {
      // Skip resigned officers
      if (officer.resigned_on) {
        continue;
      }

      const appointedDate = parseDate(officer.appointed_on);
      const dateOfBirth = officer.date_of_birth ? 
        `${officer.date_of_birth.year}-${String(officer.date_of_birth.month || 1).padStart(2, '0')}-01` : 
        null;

      const query = `
        INSERT INTO officers (
          company_id, name, role, appointed_date, 
          resigned_date, nationality, date_of_birth, 
          occupation, address
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;

      const address = officer.address ? 
        `${officer.address.address_line_1 || ''}, ${officer.address.locality || ''}, ${officer.address.postal_code || ''}`.trim() :
        null;

      await db.query(query, [
        companyId,
        officer.name,
        officer.officer_role || 'director',
        appointedDate,
        null, // resigned_date (already filtered out)
        officer.nationality,
        dateOfBirth,
        officer.occupation,
        address
      ]);

      imported++;
    }

    return { imported, skipped: 0 };
    
  } catch (error) {
    console.error(`Error importing officers for ${companyNumber}:`, error.message);
    return { imported: 0, skipped: 0, error: true };
  }
}

/**
 * Main batch import function
 */
async function batchImport(limit = 1000) {
  console.log('\n╔' + '═'.repeat(64) + '╗');
  console.log('║  OFFICERS BATCH IMPORT                                        ║');
  console.log('╚' + '═'.repeat(64) + '╝\n');

  if (!API_KEY) {
    console.error('❌ COMPANIES_HOUSE_API_KEY not set!');
    process.exit(1);
  }

  console.log('🔍 Finding companies without officers...\n');

  // Get companies that don't have officers yet
  const companiesQuery = `
    SELECT c.id, c.company_number, c.name
    FROM companies c
    WHERE c.jurisdiction = 'gb'
      AND NOT EXISTS (
        SELECT 1 FROM officers o WHERE o.company_id = c.id
      )
    ORDER BY c.created_at DESC
    LIMIT $1
  `;

  const result = await db.query(companiesQuery, [limit]);
  const companies = result.rows;

  if (companies.length === 0) {
    console.log('✅ All companies already have officers imported!');
    process.exit(0);
  }

  console.log(`📊 Found ${companies.length} companies to process`);
  console.log(`⏱️  Estimated time: ~${Math.ceil(companies.length * 0.1 / 60)} minutes\n`);
  console.log('─'.repeat(66));

  const startTime = Date.now();

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    
    const stats = await importCompanyOfficers(company.company_number, company.id);
    
    if (stats.imported > 0) {
      totalImported += stats.imported;
    }
    if (stats.skipped > 0) {
      totalSkipped += stats.skipped;
    }
    if (stats.error) {
      totalErrors++;
    }

    // Progress update every 10 companies
    if ((i + 1) % 10 === 0 || (i + 1) === companies.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = ((i + 1) / (elapsed / 60)).toFixed(1);
      const progress = ((i + 1) / companies.length * 100).toFixed(1);
      
      process.stdout.write(
        `\r✅ Progress: ${i + 1}/${companies.length} (${progress}%) | ` +
        `Officers: ${totalImported} | Rate: ${rate}/min | Errors: ${totalErrors}`
      );
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }

  console.log('\n');
  console.log('─'.repeat(66));
  console.log('\n✅ Batch Import Complete!');
  console.log(`   Companies Processed: ${companies.length}`);
  console.log(`   Officers Imported:   ${totalImported}`);
  console.log(`   Skipped/No Officers: ${totalSkipped}`);
  console.log(`   Errors:              ${totalErrors}`);
  console.log(`   Time:                ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes\n`);

  process.exit(0);
}

// Get limit from command line args
const limit = parseInt(process.argv[2]) || 1000;

// Run import
batchImport(limit).catch(error => {
  console.error('\n❌ Import failed:', error);
  process.exit(1);
});
