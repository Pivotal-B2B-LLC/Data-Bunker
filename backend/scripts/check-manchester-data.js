const { pool } = require('../src/db/connection');

(async () => {
  try {
    const r = await pool.query("SELECT COUNT(*) FROM accounts WHERE city ILIKE '%Manchester%'");
    console.log('Companies in Manchester:', r.rows[0].count);

    const c = await pool.query(`
      SELECT COUNT(*) FROM contacts
      WHERE linked_account_id IN (
        SELECT account_id FROM accounts WHERE city ILIKE '%Manchester%'
      )
    `);
    console.log('Contacts for Manchester companies:', c.rows[0].count);

    const recent = await pool.query(`
      SELECT company_name, city, created_at
      FROM accounts
      WHERE city ILIKE '%Manchester%'
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.log('\nRecent Manchester companies:');
    recent.rows.forEach(r => {
      console.log(`- ${r.company_name} (${r.city}) - ${r.created_at}`);
    });

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
