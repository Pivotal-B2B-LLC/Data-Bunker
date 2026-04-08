#!/usr/bin/env node

/**
 * MASTER CONTROLLER - TURBO MODE
 *
 * Starts and monitors ALL 8 parallel systems:
 *   1. WEBSITE-FINDER     — finds websites for companies that have none
 *   2. COMPANY-DISCOVERY  — discovers new companies via Yell/DDG/Google Places
 *   3. CONTACT-FINDER     — scrapes team/about pages for management contacts
 *   4. SEARCH-CONTACTS    — searches LinkedIn/web with title patterns (CEO, MD, Manager…)
 *   5. EMAIL-FINDER       — verifies / finds emails for contacts
 *   6. PHONE-FINDER       — finds phone numbers for companies
 *   7. DATA-QUALITY       — quality scoring and validation
 *   8. AREA-DISCOVERY     — works through discovery_queue area-by-area (city/town/village)
 *
 * Features:
 *   - All 8 systems run in parallel, auto-restart on crash
 *   - Exponential back-off on restarts (3s → 5min cap)
 *   - Real-time dashboard every 2 minutes (companies, contacts, discovery queue)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { spawn } = require('child_process');
const path = require('path');
const { pool } = require('../../src/db/connection');

// ─────────────────────────────────────────────────────────────────────────────
// AGENT DEFINITIONS
// file paths are relative to this file's directory (scripts/agents/)
// args: optional extra CLI arguments passed to the subprocess
// ─────────────────────────────────────────────────────────────────────────────
const AGENTS = [
  { name: 'WEBSITE-FINDER',    file: 'agent-website-finder.js',    color: '\x1b[91m', priority: 1 },  // Bright Red
  { name: 'COMPANY-DISCOVERY', file: 'agent-company-discovery.js', color: '\x1b[36m', priority: 2 },  // Cyan
  { name: 'CONTACT-FINDER',    file: 'agent-contact-finder.js',    color: '\x1b[33m', priority: 3 },  // Yellow
  { name: 'SEARCH-CONTACTS',   file: 'agent-search-contacts.js',   color: '\x1b[93m', priority: 4 },  // Bright Yellow
  { name: 'EMAIL-FINDER',      file: 'agent-email-finder.js',      color: '\x1b[32m', priority: 5 },  // Green
  { name: 'PHONE-FINDER',      file: 'agent-phone-finder.js',      color: '\x1b[35m', priority: 6 },  // Magenta
  { name: 'DATA-QUALITY',      file: 'agent-data-quality.js',      color: '\x1b[34m', priority: 7 },  // Blue
  { name: 'QWEN-ENRICHER',     file: 'agent-qwen-enricher.js',     color: '\x1b[95m', priority: 8 },  // Bright Magenta — Qwen 2.5 AI enrichment
  // LLM-CLEANER removed (Ollama not installed)
  // Area-by-area queue discovery (works through every city/town in discovery_queue)
  // File is one directory up from the agents/ folder
  { name: 'AREA-DISCOVERY',    file: '../auto-discover-all.js',    color: '\x1b[96m', priority: 9, args: ['--workers=1'] },  // Bright Cyan
];

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[96m';

const processes = {};
let stats = {
  startTime: Date.now(),
  restarts: {},
  lastStats: null
};

function log(msg, color = '') {
  const time = new Date().toLocaleTimeString();
  console.log(`${color}[${time}] [MASTER] ${msg}${RESET}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// BANNER (printed once on startup)
// ─────────────────────────────────────────────────────────────────────────────
function printBanner() {
  console.clear();
  console.log('\n' + '='.repeat(70));
  console.log(BOLD + '\x1b[91m   DATA BUNKER - FULL SYSTEM (TURBO MODE)' + RESET);
  console.log('='.repeat(70));
  console.log('');
  console.log('   ' + BOLD + 'All 8 systems starting in parallel:' + RESET);
  AGENTS.forEach(agent => {
    const status = processes[agent.name] ? GREEN + '●' : RED + '○';
    console.log(`   ${status}${RESET} ${agent.color}${agent.name}${RESET}`);
  });
  console.log('');
  console.log('   ' + YELLOW + 'TURBO MODE: Maximum parallelism enabled!' + RESET);
  console.log('   Press Ctrl+C to stop everything gracefully');
  console.log('');
  console.log('='.repeat(70) + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// START / MANAGE AN AGENT SUBPROCESS
// ─────────────────────────────────────────────────────────────────────────────
function startAgent(agent) {
  const scriptPath = path.join(__dirname, agent.file);
  const extraArgs  = agent.args || [];

  log(`Starting ${agent.name}...`, agent.color);

  const proc = spawn('node', [scriptPath, ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd:   path.join(__dirname, '../..'),   // backend/ directory
    env:   { ...process.env, FORCE_COLOR: '1', TURBO_MODE: '1' }
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      if (line.includes('Database connection established')) return;
      if (line.includes('Client removed from pool')) return;
      console.log(`${agent.color}[${agent.name}]${RESET} ${line}`);
    });
  });

  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (!msg) return;
    if (msg.includes('ExperimentalWarning')) return;
    console.log(`${RED}[${agent.name}] ERROR: ${msg}${RESET}`);
  });

  proc.on('close', (code) => {
    log(`${agent.name} exited (code ${code})`, RED);
    delete processes[agent.name];

    stats.restarts[agent.name] = (stats.restarts[agent.name] || 0) + 1;
    const restarts = stats.restarts[agent.name];

    // Exponential backoff: 3s → 6s → 12s → … capped at 5 minutes
    const delay    = Math.min(3000 * Math.pow(2, restarts - 1), 300000);
    const delayStr = delay >= 60000 ? `${Math.round(delay / 60000)}m` : `${Math.round(delay / 1000)}s`;
    log(`Restarting ${agent.name} in ${delayStr}… (restart #${restarts})`, agent.color);
    setTimeout(() => startAgent(agent), delay);
  });

  processes[agent.name] = proc;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE STATS QUERIES
// ─────────────────────────────────────────────────────────────────────────────
async function getStats() {
  try {
    const [companiesRes, contactsRes, recentCoRes, recentCtRes, queueRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)                                                                AS total,
          COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END)      AS with_website,
          COUNT(CASE WHEN phone_number IS NOT NULL THEN 1 END)                   AS with_phone,
          COUNT(CASE WHEN linkedin_url IS NOT NULL THEN 1 END)                   AS with_linkedin,
          COUNT(CASE WHEN email_format IS NOT NULL THEN 1 END)                   AS with_email_fmt,
          COUNT(CASE WHEN quality_score >= 50 THEN 1 END)                        AS high_quality
        FROM accounts
      `),
      pool.query(`
        SELECT
          COUNT(*)                                                   AS total,
          COUNT(CASE WHEN email IS NOT NULL THEN 1 END)             AS with_email,
          COUNT(CASE WHEN phone_number IS NOT NULL THEN 1 END)      AS with_phone,
          COUNT(CASE WHEN data_source = 'Agent:Contact' THEN 1 END) AS from_website,
          COUNT(CASE WHEN data_source = 'Agent:SearchContact' THEN 1 END) AS from_search
        FROM contacts
      `),
      pool.query(`SELECT COUNT(*) AS count FROM accounts  WHERE created_at > NOW() - INTERVAL '1 hour'`),
      pool.query(`SELECT COUNT(*) AS count FROM contacts  WHERE created_at > NOW() - INTERVAL '1 hour'`),
      // discovery_queue — table may not exist yet on fresh installs
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')     AS pending,
          COUNT(*) FILTER (WHERE status = 'completed')   AS completed,
          COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
          COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
          COUNT(*)                                        AS total
        FROM discovery_queue
      `).catch(() => ({ rows: [{ pending: '?', completed: '?', in_progress: '?', failed: '?', total: '?' }] })),
    ]);

    return {
      companies:      companiesRes.rows[0],
      contacts:       contactsRes.rows[0],
      recentCompanies: parseInt(recentCoRes.rows[0].count) || 0,
      recentContacts:  parseInt(recentCtRes.rows[0].count) || 0,
      queue:          queueRes.rows[0],
    };
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD (printed every 2 minutes)
// ─────────────────────────────────────────────────────────────────────────────
async function printDashboard() {
  const data = await getStats();
  if (!data) return;

  const elapsed = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
  const c  = data.companies;
  const ct = data.contacts;
  const q  = data.queue;

  const total    = parseInt(c.total)    || 1;
  const qTotal   = parseInt(q.total)   || 1;
  const qDone    = (parseInt(q.completed) || 0) + (parseInt(q.failed) || 0);
  const qPct     = q.total !== '?' ? (qDone / qTotal * 100).toFixed(1) : '?';

  console.log('\n' + '='.repeat(70));
  console.log(BOLD + `   FULL SYSTEM DASHBOARD  (running ${elapsed} min)` + RESET);
  console.log('='.repeat(70));

  // Companies
  console.log(`\n   ${BOLD}COMPANIES${RESET}  (${parseInt(c.total).toLocaleString()} total)`);
  console.log(`   ├─ With website:    ${GREEN}${parseInt(c.with_website).toLocaleString()}${RESET}  (${(c.with_website / total * 100).toFixed(1)}%)`);
  console.log(`   ├─ With phone:      ${parseInt(c.with_phone).toLocaleString()}`);
  console.log(`   ├─ With LinkedIn:   ${parseInt(c.with_linkedin).toLocaleString()}`);
  console.log(`   ├─ With email fmt:  ${parseInt(c.with_email_fmt).toLocaleString()}`);
  console.log(`   └─ High quality:    ${parseInt(c.high_quality).toLocaleString()}`);

  // Contacts
  console.log(`\n   ${BOLD}CONTACTS${RESET}  (${parseInt(ct.total).toLocaleString()} total)`);
  console.log(`   ├─ With email:      ${GREEN}${parseInt(ct.with_email).toLocaleString()}${RESET}`);
  console.log(`   ├─ With phone:      ${parseInt(ct.with_phone).toLocaleString()}`);
  console.log(`   ├─ Via website:     ${parseInt(ct.from_website).toLocaleString()}  (Agent:Contact)`);
  console.log(`   └─ Via search:      ${parseInt(ct.from_search).toLocaleString()}  (Agent:SearchContact)`);

  // Discovery Queue
  console.log(`\n   ${BOLD}DISCOVERY QUEUE${RESET}  (area-by-area)`);
  console.log(`   ├─ Total areas:     ${q.total !== '?' ? parseInt(q.total).toLocaleString() : '(table not ready)'}`);
  console.log(`   ├─ Completed:       ${CYAN}${q.completed !== '?' ? parseInt(q.completed).toLocaleString() : '?'}${RESET}  (${qPct}%)`);
  console.log(`   ├─ In progress:     ${q.in_progress !== '?' ? parseInt(q.in_progress).toLocaleString() : '?'}`);
  console.log(`   ├─ Pending:         ${q.pending !== '?' ? parseInt(q.pending).toLocaleString() : '?'}`);
  console.log(`   └─ Failed:          ${q.failed !== '?' ? parseInt(q.failed).toLocaleString() : '?'}`);

  // Rates
  console.log(`\n   ${BOLD}RATES (last hour)${RESET}`);
  console.log(`   ├─ New companies:   ${YELLOW}+${data.recentCompanies}${RESET}/hour`);
  console.log(`   └─ New contacts:    ${YELLOW}+${data.recentContacts}${RESET}/hour`);

  // Agent status
  console.log(`\n   ${BOLD}AGENT STATUS${RESET}`);
  AGENTS.forEach((agent, i) => {
    const running  = !!processes[agent.name];
    const status   = running ? GREEN + 'RUNNING' : RED + 'STOPPED';
    const restarts = stats.restarts[agent.name] || 0;
    const prefix   = i === AGENTS.length - 1 ? '└─' : '├─';
    console.log(`   ${prefix} ${agent.color}${agent.name.padEnd(18)}${RESET} ${status}${RESET}  (restarts: ${restarts})`);
  });

  console.log('\n' + '='.repeat(70) + '\n');
  stats.lastStats = data;
}

// ─────────────────────────────────────────────────────────────────────────────
// STOP ALL
// ─────────────────────────────────────────────────────────────────────────────
function stopAll() {
  log('Stopping all agents…', RED);
  Object.values(processes).forEach(proc => {
    if (proc && !proc.killed) proc.kill('SIGTERM');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function run() {
  printBanner();

  // Start all agents/processes with a 1-second stagger
  for (const agent of AGENTS) {
    startAgent(agent);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Dashboard: first print after 25 seconds, then every 2 minutes
  setTimeout(printDashboard, 25000);
  setInterval(printDashboard, 2 * 60 * 1000);
}

process.on('SIGINT', () => {
  console.log('\n');
  log('Received SIGINT — shutting down gracefully…', RED);
  stopAll();
  setTimeout(async () => {
    await printDashboard();
    console.log('\n' + BOLD + 'All systems stopped. Goodbye!' + RESET + '\n');
    process.exit(0);
  }, 2000);
});

run().catch(e => {
  console.error('Fatal:', e);
  stopAll();
  process.exit(1);
});
