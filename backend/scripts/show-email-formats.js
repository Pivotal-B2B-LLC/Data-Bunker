#!/usr/bin/env node
const { pool } = require('../src/db/connection');

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('   EMAIL FORMAT TEMPLATES IN DATABASE');
  console.log('='.repeat(70) + '\n');

  // Total stats
  const total = await pool.query("SELECT COUNT(*) FROM accounts WHERE email_format IS NOT NULL AND email_format != ''");
  console.log(`📊 Total companies with email format: ${total.rows[0].count}\n`);

  // Good formats (templates, not generic)
  const goodFormats = await pool.query(`
    SELECT COUNT(*) FROM accounts
    WHERE email_format IS NOT NULL
      AND email_format != ''
      AND (email_format LIKE '%{%' OR email_format LIKE '%.%@%')
      AND email_format NOT LIKE '%info%'
      AND email_format NOT LIKE '%contact%'
      AND email_format NOT LIKE '%hello%'
      AND email_format NOT LIKE '%support%'
  `);
  console.log(`✅ Email TEMPLATES found: ${goodFormats.rows[0].count}`);

  // Bad formats (generic emails)
  const badFormats = await pool.query(`
    SELECT COUNT(*) FROM accounts
    WHERE email_format IS NOT NULL
      AND email_format != ''
      AND (email_format LIKE '%info%'
           OR email_format LIKE '%contact%'
           OR email_format LIKE '%hello%'
           OR email_format LIKE '%support%')
  `);
  console.log(`❌ Generic emails (to clean): ${badFormats.rows[0].count}\n`);

  // Sample templates
  const samples = await pool.query(`
    SELECT company_name, email_format, website, city, country
    FROM accounts
    WHERE email_format IS NOT NULL
      AND email_format != ''
      AND (email_format LIKE '%{%' OR email_format LIKE '%.%@%')
      AND email_format NOT LIKE '%info%'
      AND email_format NOT LIKE '%contact%'
    ORDER BY RANDOM()
    LIMIT 15
  `);

  if (samples.rows.length > 0) {
    console.log('📧 SAMPLE EMAIL TEMPLATES:\n');
    samples.rows.forEach((c, i) => {
      console.log(`${i + 1}. ${c.company_name} (${c.city}, ${c.country})`);
      console.log(`   Template: ${c.email_format}`);
      console.log(`   Website: ${c.website}\n`);
    });
  } else {
    console.log('⚠️  No email templates found yet!\n');
    console.log('The EMAIL-FINDER agent is working on finding them...\n');
  }

  // Companies needing formats
  const needed = await pool.query(`
    SELECT COUNT(*) FROM accounts
    WHERE website IS NOT NULL
      AND website != ''
      AND (email_format IS NULL OR email_format = '')
  `);
  console.log(`\n🎯 Companies still needing email formats: ${needed.rows[0].count}`);

  console.log('\n' + '='.repeat(70) + '\n');

  await pool.end();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
