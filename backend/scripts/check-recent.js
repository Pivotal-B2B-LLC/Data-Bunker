#!/usr/bin/env node
const { pool } = require('../src/db/connection');

async function main() {
  console.log('\n========================================');
  console.log('   NEW DATA FROM LAST 5 MINUTES');
  console.log('========================================\n');

  // Get new companies
  const companies = await pool.query(`
    SELECT company_name, city, state_region, country, website, phone_number, created_at
    FROM accounts
    WHERE created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY created_at DESC
    LIMIT 25
  `);

  console.log(`🏢 NEW COMPANIES: ${companies.rows.length}\n`);
  companies.rows.forEach((c, i) => {
    console.log(`${i + 1}. ${c.company_name}`);
    console.log(`   📍 ${c.city}, ${c.state_region || ''} ${c.country}`);
    console.log(`   🌐 ${c.website || 'No website yet'}`);
    console.log(`   📞 ${c.phone_number || 'No phone yet'}`);
    console.log(`   ⏰ ${new Date(c.created_at).toLocaleTimeString()}\n`);
  });

  // Get new contacts
  const contacts = await pool.query(`
    SELECT c.first_name, c.last_name, c.email, c.phone_number, c.job_title,
           a.company_name, c.created_at
    FROM contacts c
    LEFT JOIN accounts a ON c.linked_account_id = a.account_id
    WHERE c.created_at > NOW() - INTERVAL '5 minutes'
    ORDER BY c.created_at DESC
    LIMIT 20
  `);

  console.log(`\n👥 NEW CONTACTS: ${contacts.rows.length}\n`);
  contacts.rows.forEach((c, i) => {
    console.log(`${i + 1}. ${c.first_name} ${c.last_name}`);
    console.log(`   🏢 ${c.company_name}`);
    console.log(`   💼 ${c.job_title || 'Position not specified'}`);
    console.log(`   📧 ${c.email || 'No email yet'}`);
    console.log(`   📞 ${c.phone_number || 'No phone yet'}`);
    console.log(`   ⏰ ${new Date(c.created_at).toLocaleTimeString()}\n`);
  });

  await pool.end();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
