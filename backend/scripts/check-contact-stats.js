const { pool } = require('../src/db/connection');

(async () => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as with_phone,
        COUNT(CASE WHEN email IS NOT NULL AND phone_number IS NOT NULL AND email != '' AND phone_number != '' THEN 1 END) as with_both
      FROM contacts
      WHERE linked_account_id IN (
        SELECT account_id FROM accounts WHERE city ILIKE '%Manchester%'
      )
    `);

    console.log('Manchester Contact Statistics:');
    console.log('================================');
    console.log('Total contacts:', stats.rows[0].total);
    console.log('With email:', stats.rows[0].with_email);
    console.log('With phone:', stats.rows[0].with_phone);
    console.log('With both email & phone:', stats.rows[0].with_both);

    const recent = await pool.query(`
      SELECT c.first_name, c.last_name, c.email, c.phone_number, c.job_title,
             c.data_source, c.created_at, a.company_name
      FROM contacts c
      JOIN accounts a ON c.linked_account_id = a.account_id
      WHERE a.city ILIKE '%Manchester%'
      ORDER BY c.created_at DESC
      LIMIT 10
    `);

    console.log('\nRecent Contacts:');
    console.log('================');
    recent.rows.forEach(r => {
      const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
      const email = r.email || 'N/A';
      const phone = r.phone_number || 'N/A';
      console.log(`- ${name} (${r.job_title || 'Unknown'}) at ${r.company_name}`);
      console.log(`  Email: ${email}`);
      console.log(`  Phone: ${phone}`);
      console.log(`  Source: ${r.data_source}`);
      console.log(`  Added: ${r.created_at}`);
      console.log('');
    });

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
