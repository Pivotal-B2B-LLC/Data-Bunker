#!/usr/bin/env node

/**
 * CLEANUP FAKE DATA
 *
 * Removes fake/generated data while keeping:
 * - Companies House UK data (5 million records)
 * - Any manually added data
 * - Real OpenStreetMap verified data
 */

const { pool } = require('../src/db/connection');

async function cleanupFakeData() {
  console.log('\n🧹 CLEANING UP FAKE DATA\n');
  console.log('This will remove:');
  console.log('  ❌ OpenAI generated fake companies');
  console.log('  ❌ Unverified test data');
  console.log('  ❌ Associated fake contacts\n');
  console.log('This will KEEP:');
  console.log('  ✅ Companies House UK data (5M records)');
  console.log('  ✅ OpenStreetMap verified data');
  console.log('  ✅ Manually added companies\n');

  const client = await pool.connect();

  try {
    // Start transaction
    await client.query('BEGIN');

    // Find fake data sources
    const sourcesResult = await client.query(`
      SELECT data_source, COUNT(*) as count
      FROM accounts
      WHERE data_source IS NOT NULL
      GROUP BY data_source
      ORDER BY count DESC
    `);

    console.log('📊 Current data sources in database:\n');
    sourcesResult.rows.forEach(row => {
      console.log(`   ${row.data_source}: ${row.count} companies`);
    });

    // Identify fake data patterns
    const fakeDataPatterns = [
      'OpenAI',
      'Fallback',
      'Generated',
      'Test'
    ];

    // Known fake/test company names to delete
    const fakeCompanyNames = [
      "Katz's Delicatessen",
      "Katz''s Delicatessen",
      "Strand Bookstore",
      "Test Company Ltd",
      "Ess-a-Bagel",
      "Levain Bakery",
      "Russ & Daughters",
      "Russ and Daughters",
      "Sample Company",
      "Demo Company",
      "Test Business"
    ];

    console.log('\n🔍 Identifying fake data...\n');

    // Find companies with fake data sources or no verification
    const fakeCompaniesResult = await client.query(`
      SELECT account_id, company_name, data_source, verified
      FROM accounts
      WHERE
        (data_source LIKE '%OpenAI%' OR
         data_source LIKE '%Fallback%' OR
         data_source LIKE '%Generated%' OR
         data_source LIKE '%Test%' OR
         (verified = false AND data_source IS NULL) OR
         (data_source IS NULL AND company_name ~ '^(Central|Downtown|Uptown|Midtown|Urban|Metro|Summit|Elite|Premier|Golden|Apex|Prime) .*(Bistro|Shop|Store|Services|Solutions|Partners|Group|Associates|Pros)$') OR
         company_name = ANY($1)
        )
        AND data_source NOT LIKE '%Companies House%'
        AND data_source NOT LIKE '%OpenStreetMap%'
    `, [fakeCompanyNames]);

    console.log(`Found ${fakeCompaniesResult.rows.length} fake companies to delete\n`);

    if (fakeCompaniesResult.rows.length > 0) {
      console.log('Examples of fake data to be deleted:');
      fakeCompaniesResult.rows.slice(0, 10).forEach(row => {
        console.log(`   ❌ ${row.company_name} (${row.data_source || 'No source'})`);
      });
      if (fakeCompaniesResult.rows.length > 10) {
        console.log(`   ... and ${fakeCompaniesResult.rows.length - 10} more\n`);
      }
    }

    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will permanently delete fake data!');
    console.log('Press Ctrl+C to cancel or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    if (fakeCompaniesResult.rows.length > 0) {
      const fakeIds = fakeCompaniesResult.rows.map(r => r.account_id);

      // Delete associated contacts first
      const deleteContactsResult = await client.query(`
        DELETE FROM contacts
        WHERE linked_account_id = ANY($1)
        RETURNING contact_id
      `, [fakeIds]);

      console.log(`✅ Deleted ${deleteContactsResult.rows.length} fake contacts`);

      // Delete fake companies
      const deleteCompaniesResult = await client.query(`
        DELETE FROM accounts
        WHERE account_id = ANY($1)
        RETURNING account_id
      `, [fakeIds]);

      console.log(`✅ Deleted ${deleteCompaniesResult.rows.length} fake companies`);
    }

    // Commit transaction
    await client.query('COMMIT');

    // Show remaining data
    console.log('\n📊 Remaining data in database:\n');

    const remainingResult = await client.query(`
      SELECT
        data_source,
        COUNT(*) as companies,
        SUM((SELECT COUNT(*) FROM contacts WHERE contacts.linked_account_id = accounts.account_id)) as contacts
      FROM accounts
      WHERE data_source IS NOT NULL
      GROUP BY data_source
      ORDER BY companies DESC
    `);

    remainingResult.rows.forEach(row => {
      console.log(`   ✅ ${row.data_source}: ${row.companies} companies, ${row.contacts || 0} contacts`);
    });

    const totalResult = await client.query(`
      SELECT
        COUNT(*) as total_companies,
        (SELECT COUNT(*) FROM contacts) as total_contacts
      FROM accounts
    `);

    console.log(`\n✅ CLEANUP COMPLETE!`);
    console.log(`   Total companies: ${totalResult.rows[0].total_companies}`);
    console.log(`   Total contacts: ${totalResult.rows[0].total_contacts}\n`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Cleanup failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

cleanupFakeData()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
