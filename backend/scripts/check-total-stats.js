const { pool } = require('../src/db/connection');

(async () => {
  try {
    // Company stats
    const companyStats = await pool.query(`
      SELECT
        COUNT(*) as total_companies,
        COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as with_website,
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as with_phone,
        COUNT(DISTINCT city) as unique_cities,
        COUNT(DISTINCT country) as unique_countries
      FROM accounts
    `);

    // Contact stats
    const contactStats = await pool.query(`
      SELECT
        COUNT(*) as total_contacts,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as with_phone,
        COUNT(CASE WHEN email IS NOT NULL AND phone_number IS NOT NULL AND email != '' AND phone_number != '' THEN 1 END) as with_both
      FROM contacts
    `);

    // Companies with contacts
    const withContacts = await pool.query(`
      SELECT COUNT(DISTINCT linked_account_id) as companies_with_contacts
      FROM contacts
    `);

    console.log('\n' + '='.repeat(60));
    console.log('   COMPLETE DATABASE STATISTICS');
    console.log('='.repeat(60));

    console.log('\n📊 COMPANIES:');
    console.log('   Total Companies:', companyStats.rows[0].total_companies);
    console.log('   With Websites:', companyStats.rows[0].with_website);
    console.log('   With Phone Numbers:', companyStats.rows[0].with_phone);
    console.log('   Unique Cities:', companyStats.rows[0].unique_cities);
    console.log('   Unique Countries:', companyStats.rows[0].unique_countries);

    console.log('\n👥 CONTACTS:');
    console.log('   Total Contacts:', contactStats.rows[0].total_contacts);
    console.log('   With Email:', contactStats.rows[0].with_email);
    console.log('   With Phone:', contactStats.rows[0].with_phone);
    console.log('   With Both Email & Phone:', contactStats.rows[0].with_both);
    console.log('   Companies with Contacts:', withContacts.rows[0].companies_with_contacts);

    // Top cities
    const topCities = await pool.query(`
      SELECT city, COUNT(*) as count
      FROM accounts
      GROUP BY city
      ORDER BY count DESC
      LIMIT 5
    `);

    console.log('\n🏙️  TOP CITIES:');
    topCities.rows.forEach((row, i) => {
      console.log(`   ${i + 1}. ${row.city}: ${row.count} companies`);
    });

    console.log('\n' + '='.repeat(60));

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
