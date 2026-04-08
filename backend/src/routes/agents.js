'use strict';
/**
 * /api/agents — Army (Agents) control panel API
 *
 * GET  /api/agents/status        — All agents + live status & DB stats
 * GET  /api/agents/stats         — Aggregate DB stats across all agents
 * GET  /api/agents/:id/logs      — Last 80 log lines for one agent
 * POST /api/agents/:id/start     — Start a specific agent with optional config
 * POST /api/agents/:id/stop      — Stop a specific agent
 * POST /api/agents/stop-all      — Stop all running agents
 * POST /api/agents/start-batch   — Start multiple agents at once
 * PUT  /api/agents/:id/config    — Update config and restart agent
 */

const express  = require('express');
const router   = express.Router();
const { pool } = require('../db/connection');
const { spawn } = require('child_process');
const path     = require('path');

const AGENTS_DIR = path.join(__dirname, '../../scripts/agents');

// ── AGENT REGISTRY ────────────────────────────────────────────────────────────
const AGENT_REGISTRY = [
  // DISCOVERY
  {
    id: 'company-discovery',
    name: 'Company Discovery',
    file: 'agent-company-discovery.js',
    category: 'discovery',
    icon: '🔭',
    description: 'Finds companies from Yell, Google Places, OpenStreetMap',
    defaultFocus: ['companies'],
  },
  {
    id: 'companies-house',
    name: 'Companies House',
    file: 'agent-companies-house.js',
    category: 'discovery',
    icon: '🏛',
    description: 'UK Government Registry — official company records',
    defaultFocus: ['companies'],
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    file: 'agent-google-maps-scraper.js',
    category: 'discovery',
    icon: '🗺',
    description: 'Global business data from Maps & OSM',
    defaultFocus: ['companies', 'phones'],
  },
  // ENRICHMENT
  {
    id: 'contact-finder',
    name: 'Contact Finder',
    file: 'agent-contact-finder.js',
    category: 'enrichment',
    icon: '👤',
    description: 'Scrapes company websites for contact details',
    defaultFocus: ['contacts', 'emails', 'phones'],
  },
  {
    id: 'email-finder',
    name: 'Email Finder',
    file: 'agent-email-finder.js',
    category: 'enrichment',
    icon: '📧',
    description: 'Generates & SMTP-verifies email addresses — no API cost',
    defaultFocus: ['emails'],
  },
  {
    id: 'phone-finder',
    name: 'Phone Finder',
    file: 'agent-phone-finder.js',
    category: 'enrichment',
    icon: '📞',
    description: 'Extracts phone numbers from company websites',
    defaultFocus: ['phones'],
  },
  {
    id: 'website-finder',
    name: 'Website Finder',
    file: 'agent-website-finder.js',
    category: 'enrichment',
    icon: '🌐',
    description: 'Finds official websites via search engines',
    defaultFocus: ['websites'],
  },
  {
    id: 'social-media',
    name: 'Social Media Finder',
    file: 'agent-social-media-finder.js',
    category: 'enrichment',
    icon: '📱',
    description: 'Twitter, LinkedIn, Instagram handles',
    defaultFocus: ['social'],
  },
  {
    id: 'address-enricher',
    name: 'Address Enricher',
    file: 'agent-address-enricher.js',
    category: 'enrichment',
    icon: '📍',
    description: 'Geocodes addresses, fills missing postcode/city data',
    defaultFocus: ['addresses'],
  },
  {
    id: 'linkedin-scraper',
    name: 'LinkedIn Scraper',
    file: 'agent-linkedin-scraper.js',
    category: 'enrichment',
    icon: '💼',
    description: 'Decision-makers & professional data from LinkedIn',
    defaultFocus: ['contacts', 'emails'],
  },
  // QUALITY
  {
    id: 'industry-classifier',
    name: 'Industry Classifier',
    file: 'agent-industry-classifier.js',
    category: 'quality',
    icon: '🏷',
    description: 'NLP-based industry & sector tagging',
    defaultFocus: ['companies'],
  },
  {
    id: 'data-quality',
    name: 'Data Quality',
    file: 'agent-data-quality.js',
    category: 'quality',
    icon: '🛡',
    description: 'Deduplication, scoring, junk removal',
    defaultFocus: ['companies', 'contacts'],
  },
  {
    id: 'qwen-enricher',
    name: 'Qwen AI Enricher',
    file: 'agent-qwen-enricher.js',
    category: 'quality',
    icon: '🤖',
    description: 'Local LLM for AI contact extraction & enrichment',
    defaultFocus: ['contacts', 'emails'],
  },
];

// ── IN-MEMORY PROCESS TABLE ───────────────────────────────────────────────────
// id → { proc, startedAt, config }
const processes = {};

// id → string[] (last 80 log lines)
const agentLogs = {};

function getStatus(agentId) {
  const p = processes[agentId];
  if (!p || !p.proc || p.proc.exitCode !== null || p.proc.killed) {
    return { running: false, pid: null, startedAt: null, uptime: null };
  }
  return {
    running:   true,
    pid:       p.proc.pid,
    startedAt: p.startedAt,
    uptime:    Math.round((Date.now() - p.startedAt) / 1000),
  };
}

function appendLog(id, line) {
  if (!agentLogs[id]) agentLogs[id] = [];
  agentLogs[id].push(`[${new Date().toISOString().substr(11, 8)}] ${line}`);
  if (agentLogs[id].length > 80) agentLogs[id].shift();
}

function startAgent(agentId, config = {}) {
  const def = AGENT_REGISTRY.find(a => a.id === agentId);
  if (!def) return { ok: false, error: `Unknown agent: ${agentId}` };

  // Kill existing process if running
  const existing = processes[agentId];
  if (existing?.proc && existing.proc.exitCode === null && !existing.proc.killed) {
    try { existing.proc.kill('SIGTERM'); } catch (_) {}
  }

  const focus = config.focus || def.defaultFocus;

  const env = {
    ...process.env,
    DB_AGENT_ID:          agentId,
    DB_AGENT_CONCURRENCY: String(config.concurrency || 3),
    DB_AGENT_FOCUS:       Array.isArray(focus) ? focus.join(',') : focus,
    DB_AGENT_BATCH_SIZE:  String(config.batchSize  || 50),
    DB_AGENT_DELAY_MS:    String(config.delayMs    || 2000),
  };

  let proc;
  try {
    proc = spawn('node', [path.join(AGENTS_DIR, def.file)], {
      env, detached: false, stdio: 'pipe',
    });
  } catch (e) {
    return { ok: false, error: `Failed to spawn: ${e.message}` };
  }

  proc.stdout?.on('data', chunk => {
    chunk.toString().split('\n').filter(Boolean).forEach(l => appendLog(agentId, l));
  });
  proc.stderr?.on('data', chunk => {
    chunk.toString().split('\n').filter(Boolean).forEach(l => appendLog(agentId, '⚠ ' + l));
  });
  proc.on('exit', code => {
    appendLog(agentId, `Exited with code ${code}`);
  });

  processes[agentId] = { proc, startedAt: Date.now(), config };
  appendLog(agentId, `Started — pid ${proc.pid} | focus: ${Array.isArray(focus) ? focus.join(',') : focus}`);

  return { ok: true, pid: proc.pid };
}

function stopAgent(agentId) {
  const p = processes[agentId];
  if (!p?.proc || p.proc.exitCode !== null || p.proc.killed) {
    return { ok: true, message: 'Not running' };
  }
  try {
    p.proc.kill('SIGTERM');
    appendLog(agentId, 'Stop signal sent');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// GET /api/agents/status
router.get('/status', async (req, res) => {
  let dbStats = {};
  try {
    const r = await pool.query(`
      SELECT data_source,
             COUNT(*)::int                                                    AS total,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END)::int AS last_hour,
             MAX(created_at)                                                  AS last_seen
      FROM contacts
      WHERE data_source IS NOT NULL
      GROUP BY data_source
    `);
    r.rows.forEach(row => { dbStats[row.data_source] = row; });
  } catch (_) {}

  const agents = AGENT_REGISTRY.map(def => {
    const status = getStatus(def.id);
    const cfg    = processes[def.id]?.config || {};
    return {
      ...def,
      status,
      config: {
        concurrency: cfg.concurrency || 3,
        focus:       cfg.focus       || def.defaultFocus,
        batchSize:   cfg.batchSize   || 50,
        delayMs:     cfg.delayMs     || 2000,
      },
      logs:    (agentLogs[def.id] || []).slice(-15),
      dbStats: dbStats[def.id] || null,
    };
  });

  res.json({ ok: true, agents, timestamp: new Date().toISOString() });
});

// GET /api/agents/stats — aggregate counts
router.get('/stats', async (req, res) => {
  try {
    const results = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM contacts'),
      pool.query('SELECT COUNT(*)::int AS n FROM accounts'),
      pool.query("SELECT COUNT(*)::int AS n FROM contacts WHERE email IS NOT NULL AND email <> ''"),
      pool.query("SELECT COUNT(*)::int AS n FROM contacts WHERE phone_number IS NOT NULL AND phone_number <> ''"),
      pool.query("SELECT COUNT(*)::int AS n FROM accounts WHERE website IS NOT NULL AND website <> ''"),
    ]);
    const running = Object.values(processes).filter(p => p.proc && p.proc.exitCode === null && !p.proc.killed).length;
    res.json({
      ok: true,
      stats: {
        totalContacts:  results[0].rows[0].n,
        totalCompanies: results[1].rows[0].n,
        withEmail:      results[2].rows[0].n,
        withPhone:      results[3].rows[0].n,
        withWebsite:    results[4].rows[0].n,
        runningAgents:  running,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/agents/:id/logs
router.get('/:id/logs', (req, res) => {
  res.json({ ok: true, logs: agentLogs[req.params.id] || [] });
});

// POST /api/agents/stop-all  (must be before /:id routes)
router.post('/stop-all', (req, res) => {
  const results = {};
  AGENT_REGISTRY.forEach(def => { results[def.id] = stopAgent(def.id); });
  res.json({ ok: true, results });
});

// POST /api/agents/start-batch  { agents: ['email-finder'], config: { concurrency: 5 } }
router.post('/start-batch', (req, res) => {
  const { agents = [], config = {} } = req.body || {};
  const results = {};
  agents.forEach(id => { results[id] = startAgent(id, config); });
  res.json({ ok: true, results });
});

// POST /api/agents/:id/start
router.post('/:id/start', (req, res) => {
  const { concurrency, focus, batchSize, delayMs } = req.body || {};
  res.json(startAgent(req.params.id, { concurrency, focus, batchSize, delayMs }));
});

// POST /api/agents/:id/stop
router.post('/:id/stop', (req, res) => {
  res.json(stopAgent(req.params.id));
});

// PUT /api/agents/:id/config  — update config (stops + restarts agent)
router.put('/:id/config', (req, res) => {
  const { concurrency, focus, batchSize, delayMs } = req.body || {};
  stopAgent(req.params.id);
  setTimeout(() => {
    startAgent(req.params.id, { concurrency, focus, batchSize, delayMs });
    appendLog(req.params.id, `Config applied: concurrency=${concurrency}, focus=${Array.isArray(focus) ? focus.join(',') : focus}`);
  }, 1000);
  res.json({ ok: true, message: 'Config updated — agent restarting in 1s' });
});

module.exports = router;
