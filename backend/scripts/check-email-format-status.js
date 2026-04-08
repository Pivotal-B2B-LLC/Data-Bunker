#!/usr/bin/env node
const { pool } = require('../src/db/connection');

async function main() {
  console.log('\n📊 EMAIL FORMAT STATUS\n');

  const withWebsite = await pool.query(
    "SELECT COUNT(*) FROM accounts WHERE website IS NOT NULL AND website != ''"
  );
  console.log(`Companies with websites: ${withWebsite.rows[0].count}`);

  const withFormat = await pool.query(
    "SELECT COUNT(*) FROM accounts WHERE email_format IS NOT NULL AND email_format != ''"
  );
  console.log(`Companies WITH email format: ${withFormat.rows[0].count}`);

  const needFormat = await pool.query(
    "SELECT COUNT(*) FROM accounts WHERE (email_format IS NULL OR email_format = '') AND website IS NOT NULL AND website != ''"
  );
  console.log(`Companies NEEDING email format: ${needFormat.rows[0].count}\n`);

  // Sample formats found
  const samples = await pool.query(`
    SELECT company_name, email_format, website
    FROM accounts
    WHERE email_format IS NOT NULL
      AND email_format != ''
      AND email_format NOT LIKE '%info%'
      AND email_format NOT LIKE '%contact%'
      AND email_format NOT LIKE '%hello%'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  if (samples.rows.length > 0) {
    console.log('✅ SAMPLE EMAIL FORMATS FOUND:\n');
    samples.rows.forEach((c, i) => {
      console.log(`${i+1}. ${c.company_name}`);
      console.log(`   Format: ${c.email_format}`);
      console.log(`   Website: ${c.website}\n`);
    });
  } else {
    console.log('⚠️  No email formats found yet (excluding generic ones)\n');
  }

  await pool.end();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
