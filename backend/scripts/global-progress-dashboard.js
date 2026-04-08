#!/usr/bin/env node

/**
 * GLOBAL PROGRESS DASHBOARD
 * Real-time monitoring of your journey to 130M businesses
 */

const { pool } = require('../src/db/connection');
const fs = require('fs');

// Target numbers
const TARGETS = {
  'United States': 35000000,
  'China': 50000000,
  'India': 30000000,
  'Brazil': 20000000,
  'United Kingdom': 6000000,
  'Germany': 3500000,
  'France': 4000000,
  'Japan': 4000000,
  'Italy': 5000000,
  'Mexico': 5000000,
  'Spain': 3500000,
  'Canada': 1500000,
  'Australia': 2500000,
  'South Korea': 3000000,
  'Indonesia': 5000000,
  'Turkey': 3000000,
  'Thailand': 3000000,
  'Netherlands': 2000000,
  'Poland': 2000000,
  'Argentina': 2000000,
  'Other': 10000000
};

const TOTAL_TARGET = 200000000; // 200M total target

async function getDashboardData() {
  // Get total stats
  const totalResult = await pool.query('SELECT COUNT(*) as count FROM accounts');
  const totalCompanies = parseInt(totalResult.rows[0].count);

  // Get by country
  const countryResult = await pool.query(`
    SELECT country, COUNT(*) as count
    FROM accounts
    GROUP BY country
    ORDER BY count DESC
  `);

  const countries = countryResult.rows.map(r => ({
    country: r.country,
    count: parseInt(r.count)
  }));

  // Get recent additions (last 24 hours)
  const recentResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM accounts
    WHERE created_at > NOW() - INTERVAL '24 hours'
  `);
  const recentAdded = parseInt(recentResult.rows[0].count);

  // Get contact stats
  const contactResult = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
      COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) as with_phone,
      COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as with_website
    FROM contacts
  `);
  const contacts = contactResult.rows[0];

  return {
    totalCompanies,
    countries,
    recentAdded,
    contacts: {
      total: parseInt(contacts.total),
      withEmail: parseInt(contacts.with_email),
      withPhone: parseInt(contacts.with_phone),
      withWebsite: parseInt(contacts.with_website)
    }
  };
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
  return num.toString();
}

function getProgressBar(current, target, width = 30) {
  const percentage = Math.min((current / target) * 100, 100);
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${bar} ${percentage.toFixed(1)}%`;
}

async function displayDashboard() {
  const data = await getDashboardData();
  const percentComplete = (data.totalCompanies / TOTAL_TARGET) * 100;

  // Load progress file if exists
  let progress = null;
  if (fs.existsSync('./discovery-progress.json')) {
    progress = JSON.parse(fs.readFileSync('./discovery-progress.json', 'utf8'));
  }

  console.clear();
  console.log('');
  console.log('═'.repeat(100));
  console.log('   🌍 GLOBAL BUSINESS DATA DOMINATION - PROGRESS DASHBOARD');
  console.log('═'.repeat(100));
  console.log('');

  // Overall progress
  console.log('📊 OVERALL PROGRESS:');
  console.log('');
  console.log(`   Total Businesses: ${data.totalCompanies.toLocaleString()} / ${TOTAL_TARGET.toLocaleString()}`);
  console.log(`   ${getProgressBar(data.totalCompanies, TOTAL_TARGET, 50)}`);
  console.log(`   Completion: ${percentComplete.toFixed(3)}%`);
  console.log('');

  // Recent activity
  console.log(`   📈 Added Today: ${data.recentAdded.toLocaleString()} businesses`);
  console.log('');

  // Time estimates
  if (progress && data.recentAdded > 0) {
    const remaining = TOTAL_TARGET - data.totalCompanies;
    const daysRemaining = Math.ceil(remaining / data.recentAdded);
    const hoursRemaining = (daysRemaining * 24).toFixed(0);

    console.log(`   ⏱️  Estimated Completion: ${daysRemaining} days (${hoursRemaining} hours) at current rate`);
    console.log('');
  }

  console.log('─'.repeat(100));
  console.log('');

  // Country breakdown
  console.log('🌎 PROGRESS BY COUNTRY:');
  console.log('');

  // Top countries
  const topCountries = data.countries.slice(0, 20);

  topCountries.forEach((c, i) => {
    const target = TARGETS[c.country] || TARGETS['Other'];
    const percentage = Math.min((c.count / target) * 100, 100);
    const status = percentage >= 80 ? '✅' : percentage >= 50 ? '🟡' : '🔴';

    const countryName = c.country.padEnd(25);
    const progress = `${formatNumber(c.count).padStart(6)} / ${formatNumber(target).padEnd(6)}`;
    const bar = getProgressBar(c.count, target, 20);

    console.log(`   ${status} ${countryName} ${progress}  ${bar}`);
  });

  console.log('');
  console.log('─'.repeat(100));
  console.log('');

  // Contact data quality
  console.log('📞 CONTACT DATA QUALITY:');
  console.log('');
  console.log(`   Total Contacts: ${data.contacts.total.toLocaleString()}`);
  console.log(`   With Email:     ${data.contacts.withEmail.toLocaleString()} (${((data.contacts.withEmail / data.contacts.total) * 100).toFixed(1)}%)`);
  console.log(`   With Phone:     ${data.contacts.withPhone.toLocaleString()} (${((data.contacts.withPhone / data.contacts.total) * 100).toFixed(1)}%)`);
  console.log(`   With Website:   ${data.contacts.withWebsite.toLocaleString()} (${((data.contacts.withWebsite / data.contacts.total) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('─'.repeat(100));
  console.log('');

  // Active discovery info
  if (progress) {
    console.log('⚙️  ACTIVE DISCOVERY:');
    console.log('');
    console.log(`   Started: ${new Date(progress.startedAt).toLocaleString()}`);
    console.log(`   Locations Processed: ${progress.completedLocations.length.toLocaleString()}`);
    console.log(`   Session Total: ${progress.totalCompaniesFound.toLocaleString()} businesses`);
    console.log('');
  }

  console.log('═'.repeat(100));
  console.log('');

  // Motivational messages based on progress
  if (percentComplete < 1) {
    console.log('   💪 Just getting started! Keep those workers running!');
  } else if (percentComplete < 10) {
    console.log('   🚀 Great progress! You\'re building something massive!');
  } else if (percentComplete < 50) {
    console.log('   🔥 Amazing! You\'re crushing it! Keep going!');
  } else if (percentComplete < 90) {
    console.log('   🎯 More than halfway there! The finish line is in sight!');
  } else if (percentComplete < 100) {
    console.log('   🏆 SO CLOSE! You\'re about to make history!');
  } else {
    console.log('   🎉 LEGENDARY! You have the world\'s largest business database!');
  }

  console.log('');
  console.log('   Run again: node global-progress-dashboard.js');
  console.log('   Auto-refresh: watch -n 60 node global-progress-dashboard.js');
  console.log('');
  console.log('═'.repeat(100));
  console.log('');
}

async function main() {
  try {
    await displayDashboard();
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

main();
