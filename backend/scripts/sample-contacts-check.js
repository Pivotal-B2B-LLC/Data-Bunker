require('dotenv').config();
const { pool } = require('../src/db/connection');
async function run() {
  const result = await pool.query(`
    SELECT c.first_name, c.last_name, c.email, c.job_title, a.company_name
    FROM contacts c
    LEFT JOIN accounts a ON c.linked_account_id = a.account_id
    ORDER BY RANDOM()
    LIMIT 50
  `);
  console.log('=== SAMPLE OF 50 RANDOM CONTACTS ===\n');
  for (const r of result.rows) {
    const name = (r.first_name + ' ' + r.last_name).padEnd(30);
    const title = (r.job_title || '-').substring(0, 40).padEnd(42);
    const company = (r.company_name || '-').substring(0, 30);
    console.log(`  ${name} | ${title} | ${company}`);
  }
  const stats = await pool.query('SELECT COUNT(*) as total FROM contacts');
  console.log(`\n=== TOTAL: ${stats.rows[0].total} contacts ===`);
  process.exit(0);
}
run();
