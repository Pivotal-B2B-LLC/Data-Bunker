/**
 * Cleanup Fake Contacts Script
 *
 * Removes all fake/generated contacts from database
 * These were created with random placeholder data
 */

const { pool } = require('../src/db/connection');

async function cleanupFakeContacts() {
  console.log('🧹 FAKE CONTACTS CLEANUP');
  console.log('========================\n');

  try {
    // Get count before cleanup
    const beforeCount = await pool.query('SELECT COUNT(*) as count FROM contacts');
    console.log(`📊 Contacts before cleanup: ${beforeCount.rows[0].count}`);

    // All current contacts are fake - they have:
    // - No LinkedIn URLs
    // - Random phone numbers
    // - Generated emails (firstname.lastname@domain)
    // - Names from common names list

    // Delete ALL contacts (they're all fake)
    console.log('\n🗑️ Deleting all fake contacts...');
    const deleteResult = await pool.query('DELETE FROM contacts RETURNING contact_id');
    console.log(`✅ Deleted ${deleteResult.rowCount} fake contacts`);

    // Verify cleanup
    const afterCount = await pool.query('SELECT COUNT(*) as count FROM contacts');
    console.log(`\n📊 Contacts after cleanup: ${afterCount.rows[0].count}`);

    console.log('\n✨ Cleanup complete! Database is now ready for REAL contacts.');
    console.log('   Use the Real Contact Finder to populate with verified contacts from:');
    console.log('   - Companies House UK (real directors)');
    console.log('   - Company website scraping');
    console.log('   - LinkedIn data');

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

cleanupFakeContacts()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
