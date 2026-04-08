#!/usr/bin/env node

/**
 * CHECK PROGRESS
 * Quick status check of contact finding progress
 */

const { pool } = require('../src/db/connection');

async function main() {
  try {
    // Overall stats
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_companies,
        (SELECT COUNT(DISTINCT linked_account_id) FROM contacts) as companies_with_contacts,
        (SELECT COUNT(*) FROM contacts) as total_contacts,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email != '') as contacts_with_email,
        (SELECT COUNT(*) FROM contacts WHERE phone_number IS NOT NULL AND phone_number != '') as contacts_with_phone,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND phone_number IS NOT NULL AND email != '' AND phone_number != '') as contacts_with_both
      FROM accounts
    `);

    const data = stats.rows[0];
    const remaining = parseInt(data.total_companies) - parseInt(data.companies_with_contacts);
    const percentComplete = ((parseInt(data.companies_with_contacts) / parseInt(data.total_companies)) * 100).toFixed(2);

    console.log('\n' + '='.repeat(70));
    console.log('   CONTACT FINDER PROGRESS');
    console.log('='.repeat(70));
    console.log('');
    console.log('📊 COMPANIES:');
    console.log(`   Total Companies:           ${parseInt(data.total_companies).toLocaleString()}`);
    console.log(`   Companies with Contacts:   ${parseInt(data.companies_with_contacts).toLocaleString()} (${percentComplete}%)`);
    console.log(`   Remaining to Process:      ${remaining.toLocaleString()}`);
    console.log('');
    console.log('👥 CONTACTS:');
    console.log(`   Total Contacts Found:      ${parseInt(data.total_contacts).toLocaleString()}`);
    console.log(`   With Email:                ${data.contacts_with_email}`);
    console.log(`   With Phone:                ${data.contacts_with_phone}`);
    console.log(`   With Both Email & Phone:   ${data.contacts_with_both}`);
    console.log('');

    // Recent contacts
    const recent = await pool.query(`
      SELECT c.first_name, c.last_name, c.email, c.phone_number, c.job_title,
             a.company_name, a.city, c.created_at
      FROM contacts c
      JOIN accounts a ON c.linked_account_id = a.account_id
      ORDER BY c.created_at DESC
      LIMIT 5
    `);

    console.log('🆕 RECENT CONTACTS (Last 5):');
    recent.rows.forEach((r, i) => {
      const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
      const email = r.email || 'N/A';
      const phone = r.phone_number || 'N/A';
      const time = new Date(r.created_at).toLocaleTimeString();
      console.log(`   ${i + 1}. ${name} (${r.job_title || 'Unknown'}) at ${r.company_name}`);
      console.log(`      Email: ${email} | Phone: ${phone}`);
      console.log(`      Added: ${time}`);
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
