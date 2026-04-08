#!/usr/bin/env node
require('dotenv').config();
const { pool } = require('../src/db/connection');

(async () => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM accounts) as total_companies,
        (SELECT COUNT(*) FROM accounts WHERE quality_score IS NOT NULL) as with_quality,
        (SELECT COUNT(*) FROM accounts WHERE quality_score >= 50) as quality_50_plus,
        (SELECT COUNT(*) FROM accounts WHERE website IS NOT NULL AND website != '') as with_website,
        (SELECT COUNT(*) FROM accounts WHERE phone_number IS NOT NULL AND phone_number != '') as with_phone,
        (SELECT COUNT(*) FROM accounts WHERE email_format IS NOT NULL AND email_format != '') as with_email_format,
        (SELECT COUNT(*) FROM accounts WHERE linkedin_url IS NOT NULL AND linkedin_url != '') as with_linkedin,
        (SELECT COUNT(*) FROM accounts WHERE twitter_url IS NOT NULL OR facebook_url IS NOT NULL OR instagram_url IS NOT NULL) as with_social,
        (SELECT COUNT(*) FROM contacts) as total_contacts,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email != '') as contacts_with_email,
        (SELECT COUNT(*) FROM contacts WHERE phone_number IS NOT NULL AND phone_number != '') as contacts_with_phone,
        (SELECT COUNT(*) FROM contacts WHERE linkedin_url IS NOT NULL AND linkedin_url != '') as contacts_with_linkedin,
        (SELECT ROUND(AVG(quality_score)::numeric, 1) FROM accounts WHERE quality_score IS NOT NULL) as avg_quality
    `);

    const s = stats.rows[0];
    console.log('\n========================================');
    console.log('       DATABASE TOTALS');
    console.log('========================================\n');
    console.log('COMPANIES:');
    console.log(`  Total:           ${Number(s.total_companies).toLocaleString()}`);
    console.log(`  With Quality:    ${Number(s.with_quality).toLocaleString()}`);
    console.log(`  Quality 50%+:    ${Number(s.quality_50_plus).toLocaleString()}`);
    console.log(`  With Website:    ${Number(s.with_website).toLocaleString()}`);
    console.log(`  With Phone:      ${Number(s.with_phone).toLocaleString()}`);
    console.log(`  With Email Fmt:  ${Number(s.with_email_format).toLocaleString()}`);
    console.log(`  With LinkedIn:   ${Number(s.with_linkedin).toLocaleString()}`);
    console.log(`  With Social:     ${Number(s.with_social).toLocaleString()}`);
    console.log('\nCONTACTS:');
    console.log(`  Total:           ${Number(s.total_contacts).toLocaleString()}`);
    console.log(`  With Email:      ${Number(s.contacts_with_email).toLocaleString()}`);
    console.log(`  With Phone:      ${Number(s.contacts_with_phone).toLocaleString()}`);
    console.log(`  With LinkedIn:   ${Number(s.contacts_with_linkedin).toLocaleString()}`);
    console.log(`\nAVG QUALITY:       ${s.avg_quality}%`);
    console.log('========================================\n');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
