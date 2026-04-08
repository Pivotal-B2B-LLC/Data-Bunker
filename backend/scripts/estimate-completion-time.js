#!/usr/bin/env node

/**
 * COMPLETION TIME ESTIMATOR
 * Calculates estimated time to process all remaining companies
 */

const { pool } = require('../src/db/connection');

async function main() {
  try {
    // Get current stats
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_companies,
        (SELECT COUNT(DISTINCT linked_account_id) FROM contacts) as companies_with_contacts,
        (SELECT COUNT(*) FROM contacts WHERE created_at > NOW() - INTERVAL '1 hour') as contacts_last_hour,
        (SELECT COUNT(*) FROM contacts WHERE created_at > NOW() - INTERVAL '10 minutes') as contacts_last_10min,
        (SELECT MIN(created_at) FROM contacts) as first_contact_date,
        (SELECT MAX(created_at) FROM contacts) as last_contact_date
      FROM accounts
    `);

    const data = stats.rows[0];
    const totalCompanies = parseInt(data.total_companies);
    const companiesWithContacts = parseInt(data.companies_with_contacts);
    const remaining = totalCompanies - companiesWithContacts;

    console.log('\n' + '='.repeat(70));
    console.log('   COMPLETION TIME ESTIMATOR');
    console.log('='.repeat(70));
    console.log('');
    console.log('📊 CURRENT STATUS:');
    console.log(`   Total Companies:           ${totalCompanies.toLocaleString()}`);
    console.log(`   Processed:                 ${companiesWithContacts.toLocaleString()}`);
    console.log(`   Remaining:                 ${remaining.toLocaleString()}`);
    console.log('');

    // Calculate processing rate
    const contactsLast10Min = parseInt(data.contacts_last_10min || 0);
    const contactsLastHour = parseInt(data.contacts_last_hour || 0);

    console.log('⚡ PROCESSING SPEED:');
    console.log(`   Last 10 minutes:           ${contactsLast10Min} companies`);
    console.log(`   Last hour:                 ${contactsLastHour} companies`);
    console.log('');

    // Estimate based on recent activity
    if (contactsLast10Min > 0) {
      const companiesPerMinute = contactsLast10Min / 10;
      const companiesPerHour = companiesPerMinute * 60;
      const companiesPerDay = companiesPerHour * 24;

      console.log('📈 CURRENT RATE:');
      console.log(`   Per minute:                ${companiesPerMinute.toFixed(2)} companies`);
      console.log(`   Per hour:                  ${companiesPerHour.toFixed(0)} companies`);
      console.log(`   Per day:                   ${companiesPerDay.toFixed(0).toLocaleString()} companies`);
      console.log('');

      const hoursRemaining = remaining / companiesPerHour;
      const daysRemaining = hoursRemaining / 24;
      const weeksRemaining = daysRemaining / 7;
      const monthsRemaining = daysRemaining / 30;

      console.log('⏱️  ESTIMATED COMPLETION TIME (Current Speed):');
      console.log(`   Hours:                     ${hoursRemaining.toFixed(1).toLocaleString()} hours`);
      console.log(`   Days:                      ${daysRemaining.toFixed(1).toLocaleString()} days`);
      console.log(`   Weeks:                     ${weeksRemaining.toFixed(1)} weeks`);
      console.log(`   Months:                    ${monthsRemaining.toFixed(1)} months`);
      console.log('');

      // Calculate with parallel processing
      console.log('🚀 WITH PARALLEL PROCESSING:');

      const parallelOptions = [2, 5, 10, 20, 50];
      parallelOptions.forEach(parallel => {
        const parallelDays = daysRemaining / parallel;
        const parallelWeeks = parallelDays / 7;
        const parallelMonths = parallelDays / 30;

        let timeString;
        if (parallelDays < 1) {
          timeString = `${(parallelDays * 24).toFixed(1)} hours`;
        } else if (parallelDays < 7) {
          timeString = `${parallelDays.toFixed(1)} days`;
        } else if (parallelDays < 30) {
          timeString = `${parallelWeeks.toFixed(1)} weeks`;
        } else {
          timeString = `${parallelMonths.toFixed(1)} months`;
        }

        console.log(`   ${parallel} parallel processes:      ${timeString}`);
      });

    } else {
      console.log('⚠️  No recent activity detected');
      console.log('   Processing may not have started yet or is paused');
      console.log('');

      // Theoretical estimates
      console.log('📊 THEORETICAL ESTIMATES:');
      console.log('   (Based on average processing speed)');
      console.log('');

      // Assume 5 seconds per company average
      const avgSecondsPerCompany = 7;
      const companiesPerHour = 3600 / avgSecondsPerCompany;
      const hoursNeeded = remaining / companiesPerHour;
      const daysNeeded = hoursNeeded / 24;

      console.log(`   Avg time per company:      ${avgSecondsPerCompany} seconds`);
      console.log(`   Companies per hour:        ${companiesPerHour.toFixed(0)}`);
      console.log(`   Single process:            ${daysNeeded.toFixed(0)} days`);
      console.log('');
      console.log('   With 10 parallel processes: ' + (daysNeeded / 10).toFixed(1) + ' days');
      console.log('   With 50 parallel processes: ' + (daysNeeded / 50).toFixed(1) + ' days');
    }

    console.log('');
    console.log('💡 TO SPEED UP PROCESSING:');
    console.log('   Run multiple contact finders in parallel:');
    console.log('   cd backend && node scripts/continuous-contact-finder.js &');
    console.log('   (Run this command multiple times in different terminals)');
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
