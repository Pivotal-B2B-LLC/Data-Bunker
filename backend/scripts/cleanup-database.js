#!/usr/bin/env node

/**
 * DATABASE CLEANUP SCRIPT
 * Removes ALL fake, spam, and invalid data
 */

const { pool } = require('../src/db/connection');

async function cleanupDatabase() {
  console.log('\n' + '='.repeat(60));
  console.log('   DATABASE CLEANUP - Removing Fake Data');
  console.log('='.repeat(60) + '\n');

  const client = await pool.connect();
  let totalDeleted = 0;

  try {
    // 1. Delete companies with non-ASCII characters (Chinese, etc.)
    console.log('1. Removing non-English company names...');
    const chineseResult = await client.query(`
      DELETE FROM accounts
      WHERE company_name ~ '[^[:ascii:]]'
        AND (
          LENGTH(REGEXP_REPLACE(company_name, '[^a-zA-Z]', '', 'g')) < 3
          OR LENGTH(company_name) - LENGTH(REGEXP_REPLACE(company_name, '[^[:ascii:]]', '', 'g')) > LENGTH(company_name) * 0.3
        )
      RETURNING account_id
    `);
    console.log(`   Deleted: ${chineseResult.rowCount} companies with non-English names`);
    totalDeleted += chineseResult.rowCount;

    // 2. Delete spam patterns in company names
    console.log('\n2. Removing spam patterns...');
    const spamResult = await client.query(`
      DELETE FROM accounts
      WHERE LOWER(company_name) LIKE '%how to%'
         OR LOWER(company_name) LIKE '%what is%'
         OR LOWER(company_name) LIKE '%why does%'
         OR LOWER(company_name) LIKE '%where to%'
         OR LOWER(company_name) LIKE '%free download%'
         OR LOWER(company_name) LIKE '%click here%'
         OR LOWER(company_name) LIKE '%buy now%'
         OR (LOWER(company_name) LIKE '%best %' AND LOWER(company_name) LIKE '% 20%')
         OR LOWER(company_name) LIKE '%top 10%'
         OR LOWER(company_name) LIKE '%top 5%'
         OR LOWER(company_name) LIKE '% review%'
         OR LOWER(company_name) LIKE '%reviews%'
         OR LOWER(company_name) LIKE '%near me%'
         OR LOWER(company_name) LIKE '%wikipedia%'
         OR LOWER(company_name) LIKE '%facebook%'
         OR LOWER(company_name) LIKE '%twitter%'
         OR LOWER(company_name) LIKE '%instagram%'
         OR LOWER(company_name) LIKE '%youtube%'
         OR LOWER(company_name) LIKE '%linkedin.com%'
         OR LOWER(company_name) LIKE '%google.com%'
         OR LOWER(company_name) LIKE '%.pdf%'
         OR LOWER(company_name) LIKE '%.doc%'
      RETURNING account_id
    `);
    console.log(`   Deleted: ${spamResult.rowCount} spam entries`);
    totalDeleted += spamResult.rowCount;

    // 3. Delete companies with very short names (likely invalid)
    console.log('\n3. Removing invalid short names...');
    const shortResult = await client.query(`
      DELETE FROM accounts
      WHERE LENGTH(company_name) < 3
         OR company_name IS NULL
         OR TRIM(company_name) = ''
      RETURNING account_id
    `);
    console.log(`   Deleted: ${shortResult.rowCount} invalid entries`);
    totalDeleted += shortResult.rowCount;

    // 4. Delete companies with very long names (likely scraped text)
    console.log('\n4. Removing overly long names (scraped text)...');
    const longResult = await client.query(`
      DELETE FROM accounts
      WHERE LENGTH(company_name) > 100
      RETURNING account_id
    `);
    console.log(`   Deleted: ${longResult.rowCount} overly long entries`);
    totalDeleted += longResult.rowCount;

    // 5. Delete companies with URL patterns in name
    console.log('\n5. Removing URLs in company names...');
    const urlResult = await client.query(`
      DELETE FROM accounts
      WHERE company_name LIKE '%http%'
         OR company_name LIKE '%www.%'
         OR company_name LIKE '%.com%'
         OR company_name LIKE '%.co.uk%'
         OR company_name LIKE '%.org%'
         OR company_name LIKE '%.net%'
      RETURNING account_id
    `);
    console.log(`   Deleted: ${urlResult.rowCount} URL entries`);
    totalDeleted += urlResult.rowCount;

    // 6. Delete companies that don't have at least 3 letters
    console.log('\n6. Removing entries without proper names...');
    const numericResult = await client.query(`
      DELETE FROM accounts
      WHERE LENGTH(REGEXP_REPLACE(company_name, '[^a-zA-Z]', '', 'g')) < 3
      RETURNING account_id
    `);
    console.log(`   Deleted: ${numericResult.rowCount} invalid entries`);
    totalDeleted += numericResult.rowCount;

    // 7. Delete duplicate companies (keep the first one)
    console.log('\n7. Removing duplicates...');
    const dupResult = await client.query(`
      DELETE FROM accounts a
      USING accounts b
      WHERE a.account_id > b.account_id
        AND LOWER(TRIM(a.company_name)) = LOWER(TRIM(b.company_name))
        AND LOWER(COALESCE(a.city, '')) = LOWER(COALESCE(b.city, ''))
      RETURNING a.account_id
    `);
    console.log(`   Deleted: ${dupResult.rowCount} duplicate entries`);
    totalDeleted += dupResult.rowCount;

    // 8. Delete orphaned contacts (contacts without valid accounts)
    console.log('\n8. Removing orphaned contacts...');
    const orphanResult = await client.query(`
      DELETE FROM contacts
      WHERE linked_account_id NOT IN (SELECT account_id FROM accounts)
      RETURNING contact_id
    `);
    console.log(`   Deleted: ${orphanResult.rowCount} orphaned contacts`);

    // 9. Show remaining statistics
    console.log('\n' + '-'.repeat(60));
    const statsResult = await client.query(`
      SELECT
        COUNT(*) as total_companies,
        COUNT(DISTINCT country) as countries,
        COUNT(DISTINCT city) as cities
      FROM accounts
    `);
    const contactStats = await client.query(`SELECT COUNT(*) as total FROM contacts`);

    console.log('\n   REMAINING DATA:');
    console.log(`   Companies: ${statsResult.rows[0].total_companies}`);
    console.log(`   Contacts: ${contactStats.rows[0].total}`);
    console.log(`   Countries: ${statsResult.rows[0].countries}`);
    console.log(`   Cities: ${statsResult.rows[0].cities}`);

    // Show breakdown by country
    const countryBreakdown = await client.query(`
      SELECT country, COUNT(*) as count
      FROM accounts
      GROUP BY country
      ORDER BY count DESC
      LIMIT 10
    `);
    console.log('\n   BY COUNTRY:');
    for (const row of countryBreakdown.rows) {
      console.log(`   - ${row.country}: ${row.count}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`   TOTAL DELETED: ${totalDeleted} fake/spam entries`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('Error during cleanup:', error.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

cleanupDatabase();
