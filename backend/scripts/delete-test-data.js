#!/usr/bin/env node

/**
 * Delete specific test/fake companies
 */

const { pool } = require('../src/db/connection');

async function deleteFakeCompanies() {
  console.log('\n🔍 Searching for fake/test companies...\n');

  const client = await pool.connect();

  try {
    // Find fake companies by name patterns
    const result = await client.query(`
      SELECT account_id, company_name, data_source, city, created_at
      FROM accounts
      WHERE company_name ILIKE '%Katz%Deli%'
         OR company_name ILIKE '%Strand Bookstore%'
         OR company_name ILIKE '%Test Company%'
         OR company_name ILIKE '%Ess-a-Bagel%'
         OR company_name ILIKE '%Levain Bakery%'
         OR company_name ILIKE '%Russ%Daughters%'
         OR company_name ILIKE '%Sample Company%'
         OR company_name ILIKE '%Demo Company%'
         OR city = 'New York'
         OR city = 'Manhattan'
         OR city = 'Brooklyn'
      ORDER BY created_at DESC
    `);

    console.log(`Found ${result.rows.length} potentially fake companies:\n`);

    if (result.rows.length === 0) {
      console.log('No fake companies found!');
      process.exit(0);
    }

    result.rows.slice(0, 20).forEach(r => {
      console.log(`  ❌ ${r.company_name} | ${r.city || 'Unknown'} | ${r.data_source || 'No source'}`);
    });

    if (result.rows.length > 20) {
      console.log(`  ... and ${result.rows.length - 20} more`);
    }

    console.log('\n⏳ Deleting in 3 seconds...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    await client.query('BEGIN');

    const fakeIds = result.rows.map(r => r.account_id);

    // Delete contacts first
    const contactsDeleted = await client.query(`
      DELETE FROM contacts WHERE linked_account_id = ANY($1) RETURNING contact_id
    `, [fakeIds]);
    console.log(`✅ Deleted ${contactsDeleted.rows.length} associated contacts`);

    // Delete companies
    const companiesDeleted = await client.query(`
      DELETE FROM accounts WHERE account_id = ANY($1) RETURNING account_id
    `, [fakeIds]);
    console.log(`✅ Deleted ${companiesDeleted.rows.length} fake companies`);

    await client.query('COMMIT');

    // Show remaining stats
    const stats = await client.query(`
      SELECT COUNT(*) as total FROM accounts
    `);
    console.log(`\n📊 Remaining companies: ${stats.rows[0].total}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

deleteFakeCompanies();
