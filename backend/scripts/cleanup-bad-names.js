#!/usr/bin/env node

/**
 * Clean up non-company names from accounts table
 * Removes descriptions, article titles, and other non-company entries
 */

const { pool } = require('../src/db/connection');

async function cleanupBadNames() {
  console.log('🧹 Cleaning up bad company names...\n');
  console.log('⚠️  NOTICE: UK Companies House data will NOT be touched!\n');
  
  try {
    // Delete entries that are clearly not company names
    // BUT NEVER delete UK companies (they are from official Companies House registry)
    const patterns = [
      '%openings in your area%',
      '%urgent openings%',
      '%California Companies (Top%',
      '%Top 10K%',
      '%Governing AI%',
      '%For Nearly Half%',
      '%Startups In ...%',
      '%apply now%',
      '%click here%',
      '%read more%',
      '%learn more%',
      '%find out%',
      '%subscribe%',
      '%visit our%',
      '%call us%',
      '%contact us%'
    ];

    let totalDeleted = 0;

    for (const pattern of patterns) {
      const result = await pool.query(
        `DELETE FROM accounts 
         WHERE LOWER(company_name) LIKE LOWER($1)
         AND country != 'United Kingdom'
         RETURNING account_id, company_name`,
        [pattern]
      );
      
      if (result.rows.length > 0) {
        console.log(`\n❌ Deleted ${result.rows.length} entries matching "${pattern}":`);
        result.rows.slice(0, 5).forEach(row => {
          console.log(`   - ${row.company_name} (ID: ${row.account_id})`);
        });
        if (result.rows.length > 5) {
          console.log(`   ... and ${result.rows.length - 5} more`);
        }
        totalDeleted += result.rows.length;
      }
    }

    // Delete entries with suspicious length (too short or too long)
    // BUT NEVER delete UK companies
    const tooShortResult = await pool.query(
      `DELETE FROM accounts 
       WHERE (LENGTH(company_name) < 3 OR LENGTH(company_name) > 100)
       AND country != 'United Kingdom'
       RETURNING account_id, company_name`
    );
    
    if (tooShortResult.rows.length > 0) {
      console.log(`\n❌ Deleted ${tooShortResult.rows.length} entries with suspicious length`);
      totalDeleted += tooShortResult.rows.length;
    }

    // Delete entries that are all numbers
    // BUT NEVER delete UK companies
    const allNumbersResult = await pool.query(
      `DELETE FROM accounts 
       WHERE company_name ~ '^[0-9]+$'
       AND country != 'United Kingdom'
       RETURNING account_id, company_name`
    );
    
    if (allNumbersResult.rows.length > 0) {
      console.log(`\n❌ Deleted ${allNumbersResult.rows.length} entries that are all numbers`);
      totalDeleted += allNumbersResult.rows.length;
    }

    console.log(`\n✅ Cleanup complete! Total entries deleted: ${totalDeleted}\n`);

    // Show some valid company names for verification
    const validCompanies = await pool.query(
      `SELECT company_name, country 
       FROM accounts 
       WHERE company_name IS NOT NULL 
       ORDER BY RANDOM() 
       LIMIT 10`
    );

    console.log('📊 Sample of remaining companies:');
    validCompanies.rows.forEach(row => {
      console.log(`   ✓ ${row.company_name} (${row.country})`);
    });

  } catch (error) {
    console.error('❌ Error cleaning up names:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  cleanupBadNames()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = cleanupBadNames;
