#!/usr/bin/env node

/**
 * GLOBAL COVERAGE REPORT
 * Shows comprehensive statistics for USA, UK, and Canada coverage
 */

const { pool } = require('../src/db/connection');

async function main() {
  try {
    // Overall stats
    const totalStats = await pool.query(`
      SELECT
        COUNT(*) as total_companies,
        COUNT(DISTINCT city) as unique_cities,
        COUNT(DISTINCT state_region) as unique_states,
        COUNT(DISTINCT country) as unique_countries
      FROM accounts
    `);

    // Country breakdown
    const countryStats = await pool.query(`
      SELECT
        country,
        COUNT(*) as total,
        COUNT(DISTINCT city) as cities,
        COUNT(DISTINCT state_region) as states,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as added_24h
      FROM accounts
      GROUP BY country
      ORDER BY total DESC
    `);

    // Contact enrichment stats
    const contactStats = await pool.query(`
      SELECT
        COUNT(DISTINCT linked_account_id) as companies_with_contacts,
        COUNT(*) as total_contacts,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as with_phone
      FROM contacts
    `);

    const data = totalStats.rows[0];
    const contacts = contactStats.rows[0];

    console.log('\n' + '='.repeat(80));
    console.log('   🌍 GLOBAL COVERAGE REPORT');
    console.log('='.repeat(80));
    console.log('');

    console.log('📊 OVERALL DATABASE:');
    console.log(`   Total Companies:           ${parseInt(data.total_companies).toLocaleString()}`);
    console.log(`   Unique Cities:             ${data.unique_cities.toLocaleString()}`);
    console.log(`   Unique States/Regions:     ${data.unique_states}`);
    console.log(`   Countries Covered:         ${data.unique_countries}`);
    console.log('');

    console.log('👥 CONTACT ENRICHMENT:');
    console.log(`   Companies with Contacts:   ${parseInt(contacts.companies_with_contacts || 0).toLocaleString()}`);
    console.log(`   Total Contacts:            ${parseInt(contacts.total_contacts || 0).toLocaleString()}`);
    console.log(`   With Email:                ${parseInt(contacts.with_email || 0).toLocaleString()}`);
    console.log(`   With Phone:                ${parseInt(contacts.with_phone || 0).toLocaleString()}`);
    console.log('');

    console.log('🌎 BY COUNTRY:');
    console.log('');
    countryStats.rows.forEach(row => {
      const countryName = row.country || 'Unknown';
      const recent = row.added_24h > 0 ? ` (+${parseInt(row.added_24h).toLocaleString()} today)` : '';
      console.log(`   ${countryName.padEnd(20)}`);
      console.log(`      Companies: ${parseInt(row.total).toLocaleString().padStart(12)}${recent}`);
      console.log(`      Cities:    ${row.cities.toString().padStart(12)}`);
      console.log(`      States:    ${row.states.toString().padStart(12)}`);
      console.log('');
    });

    // Top cities per country
    console.log('🏙️  TOP CITIES BY COUNTRY:');
    console.log('');

    for (const country of ['United States', 'United Kingdom', 'Canada']) {
      const topCities = await pool.query(`
        SELECT city, state_region, COUNT(*) as count,
               COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as added_24h
        FROM accounts
        WHERE country = $1
        GROUP BY city, state_region
        ORDER BY count DESC
        LIMIT 10
      `, [country]);

      if (topCities.rows.length > 0) {
        console.log(`   ${country.toUpperCase()}:`);
        topCities.rows.forEach((row, i) => {
          const location = row.state_region ? `${row.city}, ${row.state_region}` : row.city;
          const recent = row.added_24h > 0 ? ` (+${parseInt(row.added_24h).toLocaleString()} today)` : '';
          console.log(`      ${(i + 1).toString().padStart(2)}. ${location.padEnd(35)} ${parseInt(row.count).toLocaleString().padStart(8)} companies${recent}`);
        });
        console.log('');
      }
    }

    // Discovery rate
    const rateStats = await pool.query(`
      SELECT
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '10 minutes' THEN 1 END) as last_10min
      FROM accounts
    `);

    const lastHour = parseInt(rateStats.rows[0].last_hour);
    const last10Min = parseInt(rateStats.rows[0].last_10min);

    console.log('⚡ DISCOVERY RATE:');
    console.log(`   Last 10 minutes:           ${last10Min.toLocaleString()} companies`);
    console.log(`   Last hour:                 ${lastHour.toLocaleString()} companies`);

    if (lastHour > 0) {
      const perDay = lastHour * 24;
      const perWeek = perDay * 7;
      console.log(`   Per day (projected):       ${perDay.toLocaleString()} companies`);
      console.log(`   Per week (projected):      ${perWeek.toLocaleString()} companies`);
    }
    console.log('');

    console.log('='.repeat(80));
    console.log('');

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
