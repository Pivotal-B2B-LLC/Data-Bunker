#!/usr/bin/env node

/**
 * Restore UK Companies from Companies House source table
 * Restores any UK companies that were accidentally deleted
 */

const { pool } = require('../src/db/connection');

async function restoreUKCompanies() {
  console.log('🔄 Restoring UK Companies from source table...\n');
  
  try {
    // Check if companies table exists (source data)
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'companies'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('⚠️  Source "companies" table not found. Cannot restore.');
      console.log('   UK companies may need to be re-imported from Companies House API.');
      return;
    }

    // Re-insert UK companies from companies table that don't exist in accounts
    const result = await pool.query(`
      INSERT INTO accounts (
        company_name, 
        country, 
        state_region, 
        address, 
        website, 
        phone_number, 
        created_at
      )
      SELECT 
        c.name,
        'United Kingdom',
        c.region,
        CONCAT_WS(', ', c.address_line_1, c.address_line_2, c.locality, c.postal_code),
        c.website,
        c.phone,
        c.incorporation_date
      FROM companies c
      WHERE c.jurisdiction = 'gb'
        AND c.name IS NOT NULL
        AND c.name != ''
        AND NOT EXISTS (
          SELECT 1 FROM accounts a 
          WHERE a.company_name = c.name 
          AND a.country = 'United Kingdom'
        )
      RETURNING account_id, company_name;
    `);

    console.log(`✅ Restored ${result.rows.length} UK companies!\n`);
    
    if (result.rows.length > 0) {
      console.log('Sample restored companies:');
      result.rows.slice(0, 10).forEach(row => {
        console.log(`   ✓ ${row.company_name} (ID: ${row.account_id})`);
      });
      if (result.rows.length > 10) {
        console.log(`   ... and ${result.rows.length - 10} more`);
      }
    }

    // Show current UK company count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM accounts
      WHERE country = 'United Kingdom';
    `);

    console.log(`\n📊 Total UK companies in accounts: ${parseInt(countResult.rows[0].total).toLocaleString()}`);

  } catch (error) {
    console.error('❌ Error restoring UK companies:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  restoreUKCompanies()
    .then(() => {
      console.log('\n✅ Restoration complete!');
      process.exit(0);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = restoreUKCompanies;
