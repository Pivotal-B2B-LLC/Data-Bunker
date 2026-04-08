#!/usr/bin/env node
/**
 * Check US Company Import Status
 * Shows what's been imported and enrichment progress
 */

const { pool } = require('../src/db/connection');

async function checkStatus() {
  const client = await pool.connect();

  try {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('           US COMPANIES STATUS');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Total US companies
    const totalResult = await client.query(`
      SELECT COUNT(*) as total
      FROM companies
      WHERE jurisdiction LIKE 'us_%'
    `);
    console.log(`📊 Total US Companies: ${totalResult.rows[0].total}\n`);

    // By state
    const stateResult = await client.query(`
      SELECT 
        jurisdiction,
        COUNT(*) as total,
        COUNT(website) as with_website,
        COUNT(email) as with_email,
        COUNT(phone) as with_phone,
        ROUND(100.0 * COUNT(website) / COUNT(*), 1) as website_pct,
        ROUND(100.0 * COUNT(email) / COUNT(*), 1) as email_pct,
        ROUND(100.0 * COUNT(phone) / COUNT(*), 1) as phone_pct
      FROM companies
      WHERE jurisdiction LIKE 'us_%'
      GROUP BY jurisdiction
      ORDER BY total DESC
      LIMIT 20
    `);

    if (stateResult.rows.length > 0) {
      console.log('📍 By State:\n');
      console.log('State      | Total | Website | Email | Phone');
      console.log('-----------|-------|---------|-------|-------');
      for (const row of stateResult.rows) {
        const state = row.jurisdiction.replace('us_', '').toUpperCase();
        console.log(
          `${state.padEnd(10)} | ${String(row.total).padEnd(5)} | ` +
          `${String(row.website_pct + '%').padEnd(7)} | ` +
          `${String(row.email_pct + '%').padEnd(5)} | ` +
          `${row.phone_pct}%`
        );
      }
      console.log('');
    }

    // Enrichment progress
    const enrichmentResult = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(website) as enriched_website,
        COUNT(email) as enriched_email,
        COUNT(phone) as enriched_phone,
        COUNT(CASE WHEN website IS NOT NULL AND email IS NOT NULL THEN 1 END) as fully_enriched
      FROM companies
      WHERE jurisdiction LIKE 'us_%'
    `);

    const stats = enrichmentResult.rows[0];
    const total = parseInt(stats.total);
    
    if (total > 0) {
      console.log('🎯 Enrichment Progress:\n');
      console.log(`  Websites:     ${stats.enriched_website} / ${total} (${Math.round(100 * stats.enriched_website / total)}%)`);
      console.log(`  Emails:       ${stats.enriched_email} / ${total} (${Math.round(100 * stats.enriched_email / total)}%)`);
      console.log(`  Phone:        ${stats.enriched_phone} / ${total} (${Math.round(100 * stats.enriched_phone / total)}%)`);
      console.log(`  Fully Enriched: ${stats.fully_enriched} / ${total} (${Math.round(100 * stats.fully_enriched / total)}%)\n`);
    }

    // Recent imports
    const recentResult = await client.query(`
      SELECT 
        jurisdiction,
        MAX(created_at) as last_import,
        COUNT(*) as count
      FROM companies
      WHERE jurisdiction LIKE 'us_%'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY jurisdiction
      ORDER BY last_import DESC
      LIMIT 5
    `);

    if (recentResult.rows.length > 0) {
      console.log('📅 Recent Imports (Last 7 Days):\n');
      for (const row of recentResult.rows) {
        const state = row.jurisdiction.replace('us_', '').toUpperCase();
        const date = new Date(row.last_import).toLocaleString();
        console.log(`  ${state}: ${row.count} companies (${date})`);
      }
      console.log('');
    }

    // Top companies
    const topResult = await client.query(`
      SELECT name, jurisdiction, website, email
      FROM companies
      WHERE jurisdiction LIKE 'us_%'
        AND website IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 5
    `);

    if (topResult.rows.length > 0) {
      console.log('🏢 Recently Enriched Companies:\n');
      for (const row of topResult.rows) {
        const state = row.jurisdiction.replace('us_', '').toUpperCase();
        console.log(`  ${row.name} (${state})`);
        if (row.website) console.log(`    🌐 ${row.website}`);
        if (row.email) console.log(`    ✉️  ${row.email}`);
        console.log('');
      }
    }

    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

checkStatus();
