#!/usr/bin/env node

/**
 * LIVE PROGRESS MONITOR
 * Shows real-time stats updating every 5 seconds
 */

const { pool } = require('../src/db/connection');

let previousStats = {
  companies: 0,
  contacts: 0,
  websites: 0,
  phones: 0,
  emails: 0,
  emailFormats: 0
};

async function getStats() {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM accounts) as companies,
        (SELECT COUNT(*) FROM contacts) as contacts,
        (SELECT COUNT(*) FROM accounts WHERE website IS NOT NULL AND website != '') as websites,
        (SELECT COUNT(*) FROM accounts WHERE phone_number IS NOT NULL) as phones,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email != '') as emails,
        (SELECT COUNT(*) FROM accounts WHERE email_format IS NOT NULL AND email_format != '') as email_formats
    `);
    return result.rows[0];
  } catch (e) {
    console.error('Error fetching stats:', e.message);
    return null;
  }
}

async function displayStats() {
  const stats = await getStats();
  if (!stats) return;

  const companiesDiff = parseInt(stats.companies) - previousStats.companies;
  const contactsDiff = parseInt(stats.contacts) - previousStats.contacts;
  const websitesDiff = parseInt(stats.websites) - previousStats.websites;
  const phonesDiff = parseInt(stats.phones) - previousStats.phones;
  const emailsDiff = parseInt(stats.emails) - previousStats.emails;
  const formatsDiff = parseInt(stats.email_formats) - previousStats.emailFormats;

  // Clear screen (works on Windows)
  console.clear();

  console.log('\n' + '='.repeat(80));
  console.log('🔥  LIVE PROGRESS MONITOR - FAST MODE++  🔥'.padStart(50));
  console.log('='.repeat(80));
  console.log(`   Last Updated: ${new Date().toLocaleTimeString()}`);
  console.log('='.repeat(80));

  console.log('\n📊  CURRENT TOTALS:\n');
  console.log(`   Companies:      ${parseInt(stats.companies).toLocaleString().padStart(12)}   ${formatDiff(companiesDiff)}`);
  console.log(`   Contacts:       ${parseInt(stats.contacts).toLocaleString().padStart(12)}   ${formatDiff(contactsDiff)}`);
  console.log(`   Websites:       ${parseInt(stats.websites).toLocaleString().padStart(12)}   ${formatDiff(websitesDiff)}`);
  console.log(`   Phone Numbers:  ${parseInt(stats.phones).toLocaleString().padStart(12)}   ${formatDiff(phonesDiff)}`);
  console.log(`   Contact Emails: ${parseInt(stats.emails).toLocaleString().padStart(12)}   ${formatDiff(emailsDiff)}`);
  console.log(`   Email Formats:  ${parseInt(stats.email_formats).toLocaleString().padStart(12)}   ${formatDiff(formatsDiff)}`);

  console.log('\n⚡  RATE (per 5 seconds):\n');
  console.log(`   Companies:      ${companiesDiff}/5s  (${(companiesDiff * 720).toLocaleString()}/hour)`);
  console.log(`   Contacts:       ${contactsDiff}/5s  (${(contactsDiff * 720).toLocaleString()}/hour)`);
  console.log(`   Websites:       ${websitesDiff}/5s  (${(websitesDiff * 720).toLocaleString()}/hour)`);
  console.log(`   Phones:         ${phonesDiff}/5s  (${(phonesDiff * 720).toLocaleString()}/hour)`);
  console.log(`   Emails:         ${emailsDiff}/5s  (${(emailsDiff * 720).toLocaleString()}/hour)`);
  console.log(`   Formats:        ${formatsDiff}/5s  (${(formatsDiff * 720).toLocaleString()}/hour)`);

  console.log('\n' + '='.repeat(80));
  console.log('   Press Ctrl+C to stop monitoring');
  console.log('='.repeat(80) + '\n');

  previousStats = {
    companies: parseInt(stats.companies),
    contacts: parseInt(stats.contacts),
    websites: parseInt(stats.websites),
    phones: parseInt(stats.phones),
    emails: parseInt(stats.emails),
    emailFormats: parseInt(stats.email_formats)
  };
}

function formatDiff(num) {
  if (num > 0) return `\x1b[32m+${num}\x1b[0m`;
  if (num < 0) return `\x1b[31m${num}\x1b[0m`;
  return ' ';
}

console.log('\n🚀 Starting Live Monitor...\n');

// Display immediately
displayStats();

// Update every 5 seconds
setInterval(displayStats, 5000);

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n\n✅ Monitor stopped.\n');
  await pool.end();
  process.exit(0);
});
