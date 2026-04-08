#!/usr/bin/env node

/**
 * MASTER CONTROLLER v2
 *
 * Launches and monitors ALL enrichment agents (11 total):
 *
 * DISCOVERY AGENTS:
 * - Company Discovery Agent (Yell, Google Places, DDG)
 * - Companies House Agent (UK Government Registry)
 * - Google Maps / OSM Scraper Agent (Global)
 *
 * ENRICHMENT AGENTS:
 * - Contact Finder Agent (Website scraping)
 * - LinkedIn Scraper Agent (Decision makers)
 * - Email Finder Agent (SMTP verification)
 * - Phone Finder Agent (Website scraping)
 * - Website Finder Agent (Search engines)
 * - Social Media Finder Agent (Twitter, FB, IG)
 * - Address Enricher Agent (Geocoding, Postcodes)
 *
 * QUALITY AGENTS:
 * - Industry Classifier Agent (NLP classification)
 * - Data Quality Agent (Scoring, dedup, cleanup)
 *
 * Features:
 * - Auto-restart crashed agents
 * - Real-time status dashboard
 * - Consolidated logging
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { spawn } = require('child_process');
const path = require('path');
const { pool } = require('../../src/db/connection');

const AGENTS = [
  // --- DISCOVERY ---
  { name: 'COMPANY-DISCOVERY', file: 'agent-company-discovery.js', color: '\x1b[36m' },    // Cyan
  { name: 'COMPANIES-HOUSE', file: 'agent-companies-house.js', color: '\x1b[96m' },         // Light Cyan
  { name: 'GOOGLE-MAPS', file: 'agent-google-maps-scraper.js', color: '\x1b[93m' },         // Light Yellow

  // --- ENRICHMENT ---
  { name: 'CONTACT-FINDER', file: 'agent-contact-finder.js', color: '\x1b[33m' },           // Yellow
  { name: 'LINKEDIN-SCRAPER', file: 'agent-linkedin-scraper.js', color: '\x1b[94m' },       // Light Blue
  { name: 'EMAIL-FINDER', file: 'agent-email-finder.js', color: '\x1b[32m' },               // Green
  { name: 'PHONE-FINDER', file: 'agent-phone-finder.js', color: '\x1b[35m' },               // Magenta
  { name: 'WEBSITE-FINDER', file: 'agent-website-finder.js', color: '\x1b[92m' },           // Light Green
  { name: 'SOCIAL-MEDIA', file: 'agent-social-media-finder.js', color: '\x1b[95m' },        // Light Magenta
  { name: 'ADDRESS-ENRICHER', file: 'agent-address-enricher.js', color: '\x1b[37m' },       // White

  // --- QUALITY ---
  { name: 'INDUSTRY-CLASSIFIER', file: 'agent-industry-classifier.js', color: '\x1b[91m' }, // Light Red
  { name: 'DATA-QUALITY', file: 'agent-data-quality.js', color: '\x1b[34m' },               // Blue
];

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';

const processes = {};
let stats = {
  startTime: Date.now(),
  restarts: {}
};

function log(msg, color = '') {
  const time = new Date().toLocaleTimeString();
  console.log(`${color}[${time}] [MASTER] ${msg}${RESET}`);
}

function printBanner() {
  console.clear();
  console.log('\n' + '='.repeat(70));
  console.log(BOLD + '   DATA BUNKER - MULTI-AGENT ENRICHMENT SYSTEM' + RESET);
  console.log('='.repeat(70));
  console.log('');
  console.log('   Agents:');
  AGENTS.forEach(agent => {
    console.log(`   ${agent.color}■${RESET} ${agent.name}`);
  });
  console.log('');
  console.log('   Commands:');
  console.log('   - Press Ctrl+C to stop all agents');
  console.log('   - Agents auto-restart on crash');
  console.log('');
  console.log('='.repeat(70) + '\n');
}

function startAgent(agent) {
  const scriptPath = path.join(__dirname, agent.file);

  log(`Starting ${agent.name}...`, agent.color);

  const proc = spawn('node', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      // Skip connection messages to reduce noise
      if (line.includes('Database connection established')) return;
      console.log(`${agent.color}[${agent.name}]${RESET} ${line}`);
    });
  });

  proc.stderr.on('data', (data) => {
    console.log(`${RED}[${agent.name}] ERROR: ${data.toString().trim()}${RESET}`);
  });

  proc.on('close', (code) => {
    log(`${agent.name} exited with code ${code}`, RED);

    // Auto-restart after delay
    stats.restarts[agent.name] = (stats.restarts[agent.name] || 0) + 1;

    if (stats.restarts[agent.name] < 10) {
      log(`Restarting ${agent.name} in 5 seconds... (restart #${stats.restarts[agent.name]})`, agent.color);
      setTimeout(() => startAgent(agent), 5000);
    } else {
      log(`${agent.name} has crashed too many times. Not restarting.`, RED);
    }
  });

  processes[agent.name] = proc;
}

async function printDatabaseStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_companies,
        COUNT(CASE WHEN quality_score >= 50 THEN 1 END) as high_quality,
        COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as with_website,
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as with_phone,
        COUNT(CASE WHEN linkedin_url IS NOT NULL AND linkedin_url != '' THEN 1 END) as with_linkedin,
        COUNT(CASE WHEN address IS NOT NULL AND address != '' THEN 1 END) as with_address,
        COUNT(CASE WHEN industry IS NOT NULL AND industry != '' AND industry != 'Unknown' THEN 1 END) as with_industry,
        COUNT(DISTINCT city) as unique_cities,
        COUNT(DISTINCT country) as unique_countries
      FROM accounts
    `);

    const contacts = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as with_phone,
        COUNT(CASE WHEN linkedin_url IS NOT NULL AND linkedin_url != '' THEN 1 END) as with_linkedin
      FROM contacts
    `);

    const sources = await pool.query(`
      SELECT data_source, COUNT(*) as count
      FROM accounts
      WHERE data_source IS NOT NULL
      GROUP BY data_source
      ORDER BY count DESC
      LIMIT 10
    `);

    const c = result.rows[0];
    const ct = contacts.rows[0];

    const elapsed = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
    const hours = Math.floor(elapsed / 60);
    const mins = elapsed % 60;

    console.log('\n' + '='.repeat(70));
    console.log(BOLD + `   DATABASE STATS (Running for ${hours}h ${mins}m)` + RESET);
    console.log('='.repeat(70));
    console.log(`   ${GREEN}Companies:${RESET} ${parseInt(c.total_companies).toLocaleString()}`);
    console.log(`      High quality (50%+):  ${parseInt(c.high_quality).toLocaleString()}`);
    console.log(`      With website:         ${parseInt(c.with_website).toLocaleString()}`);
    console.log(`      With phone:           ${parseInt(c.with_phone).toLocaleString()}`);
    console.log(`      With LinkedIn:        ${parseInt(c.with_linkedin).toLocaleString()}`);
    console.log(`      With address:         ${parseInt(c.with_address).toLocaleString()}`);
    console.log(`      With industry:        ${parseInt(c.with_industry).toLocaleString()}`);
    console.log(`      Unique cities:        ${parseInt(c.unique_cities).toLocaleString()}`);
    console.log(`      Unique countries:     ${parseInt(c.unique_countries).toLocaleString()}`);
    console.log(`   ${GREEN}Contacts:${RESET} ${parseInt(ct.total).toLocaleString()}`);
    console.log(`      With email:           ${parseInt(ct.with_email).toLocaleString()}`);
    console.log(`      With phone:           ${parseInt(ct.with_phone).toLocaleString()}`);
    console.log(`      With LinkedIn:        ${parseInt(ct.with_linkedin).toLocaleString()}`);

    if (sources.rows.length > 0) {
      console.log(`   ${GREEN}Sources:${RESET}`);
      for (const s of sources.rows) {
        console.log(`      ${(s.data_source || 'Unknown').padEnd(30)} ${parseInt(s.count).toLocaleString()}`);
      }
    }

    console.log('='.repeat(70) + '\n');
  } catch (e) {
    log(`Error getting stats: ${e.message}`, RED);
  }
}

function stopAllAgents() {
  log('Stopping all agents...', RED);

  Object.values(processes).forEach(proc => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  });
}

async function run() {
  printBanner();

  // Start all agents
  for (const agent of AGENTS) {
    startAgent(agent);
    // Stagger starts by 2 seconds
    await new Promise(r => setTimeout(r, 2000));
  }

  // Print stats every 5 minutes
  setInterval(printDatabaseStats, 5 * 60 * 1000);

  // Initial stats after 30 seconds
  setTimeout(printDatabaseStats, 30000);
}

process.on('SIGINT', () => {
  console.log('\n');
  log('Received SIGINT, shutting down...', RED);
  stopAllAgents();

  setTimeout(() => {
    printDatabaseStats().then(() => {
      console.log('\n' + BOLD + 'All agents stopped. Goodbye!' + RESET + '\n');
      process.exit(0);
    });
  }, 2000);
});

process.on('SIGTERM', () => {
  stopAllAgents();
  process.exit(0);
});

run().catch(e => {
  console.error('Fatal:', e);
  stopAllAgents();
  process.exit(1);
});
