#!/usr/bin/env node

/**
 * DISCOVERY STATISTICS
 * Shows how many companies discovered per city and discovery rate
 */

const { pool } = require('../src/db/connection');

async function main() {
  try {
    // Overall stats
    const totalStats = await pool.query(`
      SELECT
        COUNT(*) as total_companies,
        COUNT(DISTINCT city) as unique_cities,
        COUNT(DISTINCT country) as unique_countries,
        COUNT(DISTINCT data_source) as data_sources_used,
        MIN(created_at) as first_company_date,
        MAX(created_at) as last_company_date
      FROM accounts
    `);

    const data = totalStats.rows[0];

    console.log('\n' + '='.repeat(70));
    console.log('   DISCOVERY STATISTICS');
    console.log('='.repeat(70));
    console.log('');

    console.log('📊 OVERALL:');
    console.log(`   Total Companies:           ${parseInt(data.total_companies).toLocaleString()}`);
    console.log(`   Unique Cities:             ${data.unique_cities}`);
    console.log(`   Unique Countries:          ${data.unique_countries}`);
    console.log(`   Data Sources Used:         ${data.data_sources_used}`);
    console.log('');

    // Top cities
    const topCities = await pool.query(`
      SELECT city, country, COUNT(*) as count,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as last_hour,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as last_24h
      FROM accounts
      GROUP BY city, country
      ORDER BY count DESC
      LIMIT 20
    `);

    console.log('🏙️  TOP 20 CITIES:');
    topCities.rows.forEach((row, i) => {
      const cityName = row.city || 'Unknown';
      const recent = row.last_24h > 0 ? ` (+${row.last_24h} today)` : '';
      console.log(`   ${(i + 1).toString().padStart(2)}. ${cityName.padEnd(25)} ${parseInt(row.count).toLocaleString().padStart(10)} companies${recent}`);
    });
    console.log('');

    // Discovery rate (last hour)
    const recentDiscovery = await pool.query(`
      SELECT
        COUNT(*) as last_hour,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '10 minutes' THEN 1 END) as last_10min
      FROM accounts
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `);

    const lastHour = parseInt(recentDiscovery.rows[0].last_hour);
    const last10Min = parseInt(recentDiscovery.rows[0].last_10min);

    console.log('⚡ DISCOVERY RATE:');
    console.log(`   Last 10 minutes:           ${last10Min} companies`);
    console.log(`   Last hour:                 ${lastHour} companies`);

    if (lastHour > 0) {
      const perMinute = lastHour / 60;
      const perHour = lastHour;
      const perDay = perHour * 24;

      console.log(`   Per minute:                ${perMinute.toFixed(1)} companies`);
      console.log(`   Per hour:                  ${perHour.toFixed(0)} companies`);
      console.log(`   Per day (projected):       ${perDay.toFixed(0).toLocaleString()} companies`);
    }
    console.log('');

    // Data sources breakdown
    const sources = await pool.query(`
      SELECT data_source, COUNT(*) as count
      FROM accounts
      WHERE data_source IS NOT NULL
      GROUP BY data_source
      ORDER BY count DESC
    `);

    console.log('📡 DATA SOURCES:');
    sources.rows.forEach(row => {
      const percentage = ((parseInt(row.count) / parseInt(data.total_companies)) * 100).toFixed(1);
      console.log(`   ${row.data_source.padEnd(25)} ${parseInt(row.count).toLocaleString().padStart(10)} (${percentage}%)`);
    });
    console.log('');

    console.log('='.repeat(70));
    console.log('');

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
