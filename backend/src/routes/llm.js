/**
 * LLM API Routes — powered by local Llama 3.2 1B via Ollama
 * Base path: /api/llm
 */

const express = require('express');
const router = express.Router();
const ollama = require('../services/ollamaService');
const llmCleaner = require('../services/llmDataCleanerService');
const { pool } = require('../db/connection');

/**
 * GET /api/llm/status
 */
router.get('/status', async (req, res) => {
  try {
    const available = await ollama.isAvailable();
    res.json({
      available,
      model: ollama.model,
      message: available ? 'Llama 3.2 1B is running' : 'Ollama is not reachable — run: ollama serve',
    });
  } catch (err) {
    res.status(500).json({ available: false, error: err.message });
  }
});

/**
 * POST /api/llm/chat
 * Body: { message: string, context?: string }
 */
router.post('/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  try {
    // Keep the connection alive while Llama generates (can take 30-90s on CPU)
    req.socket.setTimeout(0);
    res.setTimeout(0);
    const answer = await ollama.answerQuestion(message, context || '');
    if (!answer) return res.status(503).json({ error: 'LLM returned empty response. Try again.' });
    res.json({ answer, model: ollama.model });
  } catch (err) {
    res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// VALIDATION endpoints
// ─────────────────────────────────────────────────────────────────

/**
 * POST /api/llm/validate/company
 * Body: { name, email?, phone?, industry? }
 */
router.post('/validate/company', async (req, res) => {
  const { name, email, phone, industry } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await ollama.validateCompanyRecord({ name, email, phone, industry });
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }
});

/**
 * POST /api/llm/validate/contact
 * Body: { first_name, last_name, job_title?, email?, phone_number? }
 */
router.post('/validate/contact', async (req, res) => {
  const { first_name, last_name, job_title, email, phone_number } = req.body;
  if (!first_name && !last_name) return res.status(400).json({ error: 'first_name and last_name are required' });
  try {
    const result = await ollama.validateContactRecord({ first_name, last_name, job_title, email, phone_number });
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }
});

/**
 * POST /api/llm/validate/email
 * Body: { email: string }
 */
router.post('/validate/email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });
  try {
    const result = await ollama.validateEmail(email);
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }
});

/**
 * POST /api/llm/validate/job-title
 * Body: { title: string }
 */
router.post('/validate/job-title', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  try {
    const result = await ollama.validateJobTitle(title);
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }
});

/**
 * GET /api/llm/cleaner/stats
 * Returns current LLM cleaning stats
 */
router.get('/cleaner/stats', (req, res) => {
  res.json(llmCleaner.getStats());
});

// ─────────────────────────────────────────────────────────────────
// ENRICHMENT helpers
// ─────────────────────────────────────────────────────────────────

/**
 * POST /api/llm/classify-industry
 * Body: { name: string, description?: string }
 */
router.post('/classify-industry', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const industry = await ollama.classifyIndustry(name, description || '');
    res.json({ industry, model: ollama.model });
  } catch (err) {
    res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }
});

/**
 * POST /api/llm/generate-description
 * Body: { companyName: string, industry?: string, location?: string }
 */
router.post('/generate-description', async (req, res) => {
  const { companyName, industry, location } = req.body;
  if (!companyName) return res.status(400).json({ error: 'companyName is required' });
  try {
    const description = await ollama.generateDescription(companyName, industry || '', location || '');
    res.json({ description, model: ollama.model });
  } catch (err) {
    res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }
});

/**
 * POST /api/llm/discovery-queries
 * Body: { city: string, country: string, industry?: string }
 */
router.post('/discovery-queries', async (req, res) => {
  const { city, country, industry } = req.body;
  if (!city || !country) return res.status(400).json({ error: 'city and country are required' });
  try {
    const queries = await ollama.generateDiscoveryQueries(city, country, industry || '');
    res.json({ queries, model: ollama.model });
  } catch (err) {
    res.status(503).json({ error: 'LLM unavailable', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// SYSTEM STATUS & PROCESS CONTROL
// ─────────────────────────────────────────────────────────────────

/**
 * GET /api/llm/system/status
 * Full system snapshot: LLM, DB stats, cleaner stats, uptime
 */
router.get('/system/status', async (req, res) => {
  try {
    const [llmAvailable, dbStats] = await Promise.allSettled([
      ollama.isAvailable(),
      (async () => {
        const client = await pool.connect();
        try {
          const [comp, acc, cont] = await Promise.all([
            client.query('SELECT COUNT(*) FROM companies').catch(() => ({ rows: [{ count: 'N/A' }] })),
            client.query('SELECT COUNT(*) FROM accounts').catch(() => ({ rows: [{ count: 'N/A' }] })),
            client.query('SELECT COUNT(*) FROM contacts').catch(() => ({ rows: [{ count: 'N/A' }] })),
          ]);
          const [enriched, withEmail] = await Promise.all([
            client.query("SELECT COUNT(*) FROM accounts WHERE website IS NOT NULL AND website <> ''").catch(() => ({ rows: [{ count: 'N/A' }] })),
            client.query("SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email <> ''").catch(() => ({ rows: [{ count: 'N/A' }] })),
          ]);
          return {
            companies: comp.rows[0].count,
            accounts: acc.rows[0].count,
            contacts: cont.rows[0].count,
            accountsWithWebsite: enriched.rows[0].count,
            contactsWithEmail: withEmail.rows[0].count,
            dbOnline: true,
          };
        } finally {
          client.release();
        }
      })(),
    ]);

    res.json({
      llm: {
        available: llmAvailable.status === 'fulfilled' ? llmAvailable.value : false,
        model: ollama.model,
      },
      db: dbStats.status === 'fulfilled'
        ? dbStats.value
        : { dbOnline: false, dbError: 'Database waking up — try again in a few seconds' },
      cleaner: llmCleaner.getStats(),
      server: {
        uptime: Math.floor(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/llm/db/stats
 * DB counts only (lighter call for the AI page)
 */
router.get('/db/stats', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const [comp, acc, cont, enriched, withEmail, fake] = await Promise.all([
        client.query('SELECT COUNT(*) FROM companies').catch(() => ({ rows: [{ count: 0 }] })),
        client.query('SELECT COUNT(*) FROM accounts').catch(() => ({ rows: [{ count: 0 }] })),
        client.query('SELECT COUNT(*) FROM contacts').catch(() => ({ rows: [{ count: 0 }] })),
        client.query("SELECT COUNT(*) FROM accounts WHERE website IS NOT NULL AND website <> ''").catch(() => ({ rows: [{ count: 0 }] })),
        client.query("SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email <> ''").catch(() => ({ rows: [{ count: 0 }] })),
        client.query('SELECT COUNT(*) FROM companies WHERE llm_fake = TRUE').catch(() => ({ rows: [{ count: 0 }] })),
      ]);
      res.json({
        companies: parseInt(comp.rows[0].count) || 0,
        accounts: parseInt(acc.rows[0].count) || 0,
        contacts: parseInt(cont.rows[0].count) || 0,
        accountsEnriched: parseInt(enriched.rows[0].count) || 0,
        contactsWithEmail: parseInt(withEmail.rows[0].count) || 0,
        fakeFlagged: parseInt(fake.rows[0].count) || 0,
        dbOnline: true,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    // Return a friendly fallback instead of 500 — DB may be waking up (Neon cold start)
    res.json({
      companies: 0, accounts: 0, contacts: 0,
      accountsEnriched: 0, contactsWithEmail: 0, fakeFlagged: 0,
      dbOnline: false,
      dbError: err.message.includes('ENOTFOUND') ? 'Database waking up…' : err.message,
    });
  }
});

/**
 * POST /api/llm/cleaner/start
 * Starts the LLM data cleaner continuous loop
 */
router.post('/cleaner/start', (req, res) => {
  if (llmCleaner.running) {
    return res.json({ success: false, message: 'Cleaner is already running' });
  }
  llmCleaner.start({ delayMs: 1500, onIdle: 120000 });
  res.json({ success: true, message: 'LLM cleaner started' });
});

/**
 * POST /api/llm/cleaner/stop
 * Requests graceful stop of the LLM cleaner
 */
router.post('/cleaner/stop', (req, res) => {
  if (!llmCleaner.running) {
    return res.json({ success: false, message: 'Cleaner is not running' });
  }
  llmCleaner.stop();
  res.json({ success: true, message: 'Stop requested — cleaner will halt after current batch' });
});

/**
 * POST /api/llm/enrich/trigger
 * Body: { limit?: number }
 * Triggers an enrichment pass on unprocessed companies
 */
router.post('/enrich/trigger', async (req, res) => {
  const limit = Math.min(parseInt(req.body?.limit) || 10, 50);
  try {
    const client = await pool.connect();
    let companies;
    try {
      const result = await client.query(
        `SELECT id, name FROM accounts WHERE website IS NULL LIMIT $1`,
        [limit]
      );
      companies = result.rows;
    } finally {
      client.release();
    }

    if (!companies || companies.length === 0) {
      return res.json({ success: true, message: 'No companies need enrichment right now', queued: 0 });
    }

    // Fire-and-forget enrichment (non-blocking)
    const enrichmentService = require('../services/companyEnrichmentService');
    setImmediate(async () => {
      for (const c of companies) {
        try { await enrichmentService.enrichCompany(c.id); } catch {}
      }
    });

    res.json({ success: true, message: `Enrichment triggered for ${companies.length} companies`, queued: companies.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/llm/validate/batch
 * Body: { type: 'companies'|'contacts', limit?: number }
 * Runs a single LLM validation batch from the API (non-continuous)
 */
router.post('/validate/batch', async (req, res) => {
  const { type = 'companies', limit = 5 } = req.body;
  try {
    if (type === 'contacts') {
      const n = await llmCleaner.runContactBatch();
      return res.json({ success: true, processed: n, stats: llmCleaner.getStats() });
    } else {
      const n = await llmCleaner.runCompanyBatch();
      return res.json({ success: true, processed: n, stats: llmCleaner.getStats() });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

