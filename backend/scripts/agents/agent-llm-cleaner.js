#!/usr/bin/env node

/**
 * AGENT: LLM DATA CLEANER
 *
 * Uses Llama 3.2 1B to continuously scan and clean the database:
 *  - Detects and flags fake company names (gibberish, placeholders, random text)
 *  - Removes contacts with fake/random names ("Test User", "John Doe", random letters)
 *  - Nullifies fake emails (example.com, fake@, placeholders)
 *  - Nullifies junk phone numbers (repeated digits, sequential, too short)
 *  - Nullifies invalid job titles ("asdfgh", "N/A", scraped UI labels)
 *  - Nullifies random/invalid industry strings
 *
 * Runs in parallel with enrichment — cleans while we enrich.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const llmCleaner = require('../../src/services/llmDataCleanerService');

const AGENT_NAME = 'LLM-CLEANER';

function log(msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${AGENT_NAME}] ${msg}`);
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log(`   AGENT: ${AGENT_NAME}`);
  console.log('='.repeat(60));
  console.log('   AI-powered data validation using Llama 3.2 1B');
  console.log('   Removes fake companies, contacts, emails & junk text');
  console.log('   Press Ctrl+C to stop\n');

  await llmCleaner.runContinuous({
    delayMs: 1500,    // 1.5s between batches when busy
    onIdle: 120000,   // 2 min when all records validated
  });
}

run().catch(err => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
