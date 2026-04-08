#!/usr/bin/env node

/**
 * CHECK DATA STATISTICS
 * Quick overview of your database
 */

const { pool } = require('../src/db/connection');

async function checkStats() {
  console.log('\n📊 DATABASE STATISTICS\n');

  const client = await pool.connect();

  try {
    // Total counts
    const totals = await client.query(`
      SELECT
        COUNT(*) as companies,
        (SELECT COUNT(*) FROM contacts) as contacts
      FROM accounts
    `);

    console.log('═══════════════════════════════════════════════════');
    console.log(`📈 TOTALS`);
    console.log('═══════════════════════════════════════════════════');
    console.log(`   Companies: ${parseInt(totals.rows[0].companies).toLocaleString()}`);
    console.log(`   Contacts: ${parseInt(totals.rows[0].contacts).toLocaleString()}`);
    console.log('');

    // By data source
    const sources = await client.query(`
      SELECT
        COALESCE(data_source, 'Unknown') as source,
        COUNT(*) as companies,
        COUNT(linkedin_url) as with_linkedin,
        COUNT(email_format) as with_email_format,
        (SELECT COUNT(*) FROM contacts WHERE contacts.linked_account_id = accounts.account_id) as total_contacts
      FROM accounts
      GROUP BY data_source
      ORDER BY companies DESC
    `);

    console.log('═══════════════════════════════════════════════════');
    console.log(`📦 BY DATA SOURCE`);
    console.log('═══════════════════════════════════════════════════');

    sources.rows.forEach(row => {
      console.log(`\n   ${row.source}:`);
      console.log(`      Companies: ${parseInt(row.companies).toLocaleString()}`);
      console.log(`      LinkedIn URLs: ${parseInt(row.with_linkedin || 0).toLocaleString()}`);
      console.log(`      Email Formats: ${parseInt(row.with_email_format || 0).toLocaleString()}`);
      console.log(`      Contacts: ${parseInt(row.total_contacts || 0).toLocaleString()}`);
    });

    // Enrichment progress
    const enrichmentProgress = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(linkedin_url) as with_linkedin,
        COUNT(email_format) as with_email,
        (SELECT COUNT(*) FROM contacts) as total_contacts
      FROM accounts
      WHERE data_source LIKE '%Companies House%' OR company_number IS NOT NULL
    `);

    if (enrichmentProgress.rows[0].total > 0) {
      const total = parseInt(enrichmentProgress.rows[0].total);
      const withLinkedIn = parseInt(enrichmentProgress.rows[0].with_linkedin || 0);
      const withEmail = parseInt(enrichmentProgress.rows[0].with_email || 0);
      const contacts = parseInt(enrichmentProgress.rows[0].total_contacts || 0);
      const enrichedPercent = ((withLinkedIn / total) * 100).toFixed(1);

      console.log('\n═══════════════════════════════════════════════════');
      console.log(`🇬🇧 COMPANIES HOUSE ENRICHMENT PROGRESS`);
      console.log('═══════════════════════════════════════════════════');
      console.log(`   Total Companies: ${total.toLocaleString()}`);
      console.log(`   Enriched: ${withLinkedIn.toLocaleString()} (${enrichedPercent}%)`);
      console.log(`   With Email Formats: ${withEmail.toLocaleString()}`);
      console.log(`   Total Contacts: ${contacts.toLocaleString()}`);
      console.log(`   Avg Contacts/Company: ${(contacts / withLinkedIn).toFixed(1)}`);
    }

    // By country
    const countries = await client.query(`
      SELECT
        country,
        COUNT(*) as companies
      FROM accounts
      WHERE country IS NOT NULL
      GROUP BY country
      ORDER BY companies DESC
      LIMIT 10
    `);

    if (countries.rows.length > 0) {
      console.log('\n═══════════════════════════════════════════════════');
      console.log(`🌍 TOP COUNTRIES`);
      console.log('═══════════════════════════════════════════════════');

      countries.rows.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ${row.country}: ${parseInt(row.companies).toLocaleString()} companies`);
      });
    }

    // Verification status
    const verified = await client.query(`
      SELECT
        verified,
        COUNT(*) as count
      FROM accounts
      GROUP BY verified
    `);

    console.log('\n═══════════════════════════════════════════════════');
    console.log(`✅ VERIFICATION STATUS`);
    console.log('═══════════════════════════════════════════════════');

    verified.rows.forEach(row => {
      const status = row.verified ? 'Verified' : 'Unverified';
      console.log(`   ${status}: ${parseInt(row.count).toLocaleString()}`);
    });

    console.log('\n═══════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    process.exit(0);
  }
}

checkStats();
