#!/usr/bin/env node
require('dotenv').config();
const { pool } = require('../src/db/connection');

(async () => {
  try {
    // Get contacts with emails
    const withEmail = await pool.query(`
      SELECT
        c.first_name,
        c.last_name,
        c.email,
        c.job_title,
        a.company_name
      FROM contacts c
      LEFT JOIN accounts a ON c.linked_account_id = a.account_id
      WHERE c.email IS NOT NULL AND c.email != ''
      ORDER BY c.created_at DESC
      LIMIT 15
    `);

    console.log('\n========== CONTACTS WITH EMAILS ==========\n');
    if (withEmail.rows.length === 0) {
      console.log('No contacts with emails found yet.\n');
    } else {
      withEmail.rows.forEach((r, i) => {
        console.log(`${i+1}. ${r.first_name} ${r.last_name}`);
        console.log(`   Email: ${r.email}`);
        console.log(`   Title: ${r.job_title || 'N/A'}`);
        console.log(`   Company: ${r.company_name || 'N/A'}\n`);
      });
    }

    // Get contacts without emails but with names
    const withoutEmail = await pool.query(`
      SELECT
        c.first_name,
        c.last_name,
        c.job_title,
        c.phone_number,
        a.company_name,
        a.email_format
      FROM contacts c
      LEFT JOIN accounts a ON c.linked_account_id = a.account_id
      WHERE (c.email IS NULL OR c.email = '')
      ORDER BY c.created_at DESC
      LIMIT 10
    `);

    console.log('========== CONTACTS WITHOUT EMAILS ==========\n');
    withoutEmail.rows.forEach((r, i) => {
      console.log(`${i+1}. ${r.first_name} ${r.last_name}`);
      console.log(`   Title: ${r.job_title || 'N/A'}`);
      console.log(`   Phone: ${r.phone_number || 'N/A'}`);
      console.log(`   Company: ${r.company_name || 'N/A'}`);
      console.log(`   Company Email Format: ${r.email_format || 'N/A'}\n`);
    });

    // Stats
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as with_phone
      FROM contacts
    `);

    console.log('========== CONTACT STATS ==========');
    console.log(`Total contacts: ${stats.rows[0].total}`);
    console.log(`With email: ${stats.rows[0].with_email}`);
    console.log(`With phone: ${stats.rows[0].with_phone}\n`);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
