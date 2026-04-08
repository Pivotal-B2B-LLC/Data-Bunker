/**
 * Discovery Routes
 * Control company discovery and scraping
 */

const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const linkedInService = require('../services/linkedInService');

// Whitelist of allowed characters for discovery inputs
const SAFE_INPUT_RE = /^[a-zA-Z0-9\s\-',.\u00C0-\u024F]+$/;

function sanitizeInput(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim().substring(0, 100);
  if (!SAFE_INPUT_RE.test(trimmed)) return '';
  return trimmed;
}

// Track discovery process
let discoveryProcess = null;
let discoveryStatus = {
  running: false,
  city: null,
  state: null,
  startTime: null,
  companiesFound: 0
};

/**
 * Start company discovery for custom location
 * POST /api/discovery/start
 */
router.post('/start', async (req, res) => {
  try {
    const city = sanitizeInput(req.body.city);
    const state = sanitizeInput(req.body.state);
    const district = sanitizeInput(req.body.district);

    if (!city || !state) {
      return res.status(400).json({
        success: false,
        error: 'City and state are required'
      });
    }

    // Stop existing discovery if running
    if (discoveryProcess) {
      discoveryProcess.kill();
      discoveryProcess = null;
    }

    const country = sanitizeInput(req.body.country) || 'United States';

    const scriptPath = path.join(__dirname, '../../scripts/discover-fast.js');
    const args = [scriptPath, city, state, country];

    if (district) {
      args.push(district);
    }

    const discoveryLocation = district ? `${city}, ${district}, ${state}` : `${city}, ${state}`;
    console.log(`Starting fast discovery: ${discoveryLocation} (${country})`);

    discoveryProcess = spawn('node', args, {
      cwd: path.join(__dirname, '../..'),
      env: process.env
    });

    discoveryStatus = {
      running: true,
      city,
      state,
      district: district || null,
      startTime: new Date(),
      companiesFound: 0
    };

    discoveryProcess.stdout.on('data', (data) => {
      const output = data.toString();

      const patterns = [
        /Companies Saved: (\d+)/i,
        /companiesSaved: (\d+)/i,
        /Total companies found: (\d+)/i,
        /companies found: (\d+)/i,
        /Progress: (\d+) companies/i
      ];

      for (const pattern of patterns) {
        const match = output.match(pattern);
        if (match) {
          discoveryStatus.companiesFound = parseInt(match[1]);
          break;
        }
      }

      const contactsMatch = output.match(/Contacts Created: (\d+)/i);
      if (contactsMatch) {
        discoveryStatus.contactsCreated = parseInt(contactsMatch[1]);
      }

      const gridMatch = output.match(/Grid Cells Searched: (\d+)\/(\d+)/i);
      if (gridMatch) {
        discoveryStatus.gridProgress = {
          searched: parseInt(gridMatch[1]),
          total: parseInt(gridMatch[2])
        };
      }

      if (output.includes('DISCOVERY COMPLETE') || output.includes('100% COMPLETE')) {
        discoveryStatus.status = 'completed';
      }
    });

    discoveryProcess.stderr.on('data', (data) => {
      console.error(`[Discovery Error] ${data}`);
    });

    discoveryProcess.on('close', (code) => {
      console.log(`Discovery process exited with code ${code}`);
      discoveryStatus.running = false;
      discoveryProcess = null;
    });

    res.json({
      success: true,
      message: `Company discovery started for ${city}, ${state}`,
      status: discoveryStatus
    });

  } catch (error) {
    console.error('Discovery start error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Stop company discovery
 * POST /api/discovery/stop
 */
router.post('/stop', async (req, res) => {
  try {
    if (discoveryProcess) {
      discoveryProcess.kill();
      discoveryProcess = null;
      discoveryStatus.running = false;

      res.json({
        success: true,
        message: 'Discovery stopped',
        status: discoveryStatus
      });
    } else {
      res.json({
        success: true,
        message: 'No discovery process running',
        status: discoveryStatus
      });
    }
  } catch (error) {
    console.error('Discovery stop error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get discovery status
 * GET /api/discovery/status
 */
router.get('/status', async (req, res) => {
  res.json({
    success: true,
    status: discoveryStatus
  });
});

/**
 * Get completed areas for a city
 * GET /api/discovery/completed-areas/:state/:city
 */
router.get('/completed-areas/:state/:city', async (req, res) => {
  try {
    const { state, city } = req.params;
    const { pool } = require('../db/connection');

    const result = await pool.query(
      `SELECT area_id, district, postcode, companies_found, contacts_created,
              discovery_date, discovery_duration_seconds, sources_used, status, coverage_percent
       FROM completed_areas
       WHERE LOWER(city) = LOWER($1) AND LOWER(state_region) = LOWER($2)
       ORDER BY discovery_date DESC`,
      [city, state]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

/**
 * Get all completed areas
 * GET /api/discovery/completed-areas
 */
router.get('/completed-areas', async (req, res) => {
  try {
    const { pool } = require('../db/connection');

    const result = await pool.query(
      `SELECT ca.*,
        (SELECT COUNT(*) FROM accounts a
         WHERE LOWER(a.city) = LOWER(ca.city)
         AND LOWER(a.state_region) = LOWER(ca.state_region)
         AND LOWER(a.country) = LOWER(ca.country)
        ) as current_company_count
       FROM completed_areas ca
       WHERE status = 'completed'
       ORDER BY discovery_date DESC
       LIMIT 100`
    );

    const statsResult = await pool.query(
      `SELECT COUNT(*) as total_areas,
        SUM(companies_found) as total_companies_captured,
        SUM(contacts_created) as total_contacts_created,
        COUNT(DISTINCT city) as unique_cities,
        COUNT(DISTINCT country) as unique_countries
       FROM completed_areas WHERE status = 'completed'`
    );

    res.json({
      success: true,
      data: result.rows,
      stats: statsResult.rows[0]
    });
  } catch (error) {
    res.json({
      success: true,
      data: [],
      stats: { total_areas: 0, total_companies_captured: 0, total_contacts_created: 0 }
    });
  }
});

/**
 * Check if an area is already completed
 * GET /api/discovery/is-completed
 */
router.get('/is-completed', async (req, res) => {
  try {
    const { city, state, country, district } = req.query;
    const { pool } = require('../db/connection');

    let query = `SELECT * FROM completed_areas
      WHERE LOWER(city) = LOWER($1) AND LOWER(state_region) = LOWER($2) AND status = 'completed'`;
    const params = [city, state];

    if (country) {
      query += ` AND LOWER(country) = LOWER($${params.length + 1})`;
      params.push(country);
    }
    if (district) {
      query += ` AND LOWER(district) = LOWER($${params.length + 1})`;
      params.push(district);
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      isCompleted: result.rows.length > 0,
      data: result.rows[0] || null
    });
  } catch (error) {
    res.json({ success: true, isCompleted: false, data: null });
  }
});

// ── Auto-discovery process tracker ──────────────────────────────────────────
let autoDiscoveryProcess = null;
let autoDiscoveryStatus = {
  running: false, workers: 0,
  totalProcessed: 0, totalCompaniesFound: 0,
  startedAt: null, currentLocations: []
};

/** GET /api/discovery/queue/stats */
router.get('/queue/stats', async (req, res) => {
  try {
    const { pool } = require('../db/connection');
    const r = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='pending')         AS pending,
        COUNT(*) FILTER (WHERE status='in_progress')     AS in_progress,
        COUNT(*) FILTER (WHERE status='completed')       AS completed,
        COUNT(*) FILTER (WHERE status='failed')          AS failed,
        COUNT(*) FILTER (WHERE status='skipped')         AS skipped,
        ROUND(COUNT(*) FILTER (WHERE status IN ('completed','skipped'))::NUMERIC
          / NULLIF(COUNT(*),0) * 100, 1)                AS percent_done
      FROM discovery_queue
    `);
    res.json({ success: true, stats: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** GET /api/discovery/queue/by-country */
router.get('/queue/by-country', async (req, res) => {
  try {
    const { pool } = require('../db/connection');
    const r = await pool.query(`
      SELECT country, country_code,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='pending')     AS pending,
        COUNT(*) FILTER (WHERE status='completed')   AS completed,
        COUNT(*) FILTER (WHERE status='in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status='failed')      AS failed,
        COUNT(*) FILTER (WHERE status='skipped')     AS skipped,
        ROUND(COUNT(*) FILTER (WHERE status IN ('completed','skipped'))::NUMERIC
          / NULLIF(COUNT(*),0) * 100, 1)             AS percent_done,
        COALESCE(SUM(companies_found),0)             AS total_companies_found
      FROM discovery_queue
      GROUP BY country, country_code
      ORDER BY total DESC
    `);
    res.json({ success: true, data: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** GET /api/discovery/queue/by-state?country=US */
router.get('/queue/by-state', async (req, res) => {
  try {
    const { pool } = require('../db/connection');
    const cc = sanitizeInput(req.query.country) || 'US';
    const r = await pool.query(`
      SELECT state_region, state_code,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='pending')     AS pending,
        COUNT(*) FILTER (WHERE status='completed')   AS completed,
        COUNT(*) FILTER (WHERE status='in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status='failed')      AS failed,
        COUNT(*) FILTER (WHERE status='skipped')     AS skipped,
        ROUND(COUNT(*) FILTER (WHERE status IN ('completed','skipped'))::NUMERIC
          / NULLIF(COUNT(*),0) * 100, 1)             AS percent_done,
        COALESCE(SUM(companies_found),0)             AS total_companies_found
      FROM discovery_queue
      WHERE UPPER(country_code) = UPPER($1)
      GROUP BY state_region, state_code
      ORDER BY state_region ASC
    `, [cc]);
    res.json({ success: true, data: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** POST /api/discovery/queue/populate */
router.post('/queue/populate', (req, res) => {
  try {
    const country = sanitizeInput(req.body.country) || 'ALL';
    const scriptPath = path.join(__dirname, '../../scripts/populate-discovery-queue.js');
    const proc = spawn('node', [scriptPath, country], {
      cwd: path.join(__dirname, '../..'), env: process.env, stdio: 'pipe'
    });
    proc.on('close', (code) => console.log(`Queue population done (code ${code}): ${country}`));
    res.json({ success: true, message: `Queue population started for: ${country}`, pid: proc.pid });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** POST /api/discovery/queue/auto-start */
router.post('/queue/auto-start', (req, res) => {
  try {
    if (autoDiscoveryProcess) return res.json({ success: false, error: 'Already running' });
    const workers = Math.max(1, Math.min(5, parseInt(req.body.workers) || 1));
    const country = sanitizeInput(req.body.country) || '';
    const scriptPath = path.join(__dirname, '../../scripts/auto-discover-all.js');
    const args = [scriptPath, `--workers=${workers}`];
    if (country) args.push(`--country=${country}`);

    autoDiscoveryProcess = spawn('node', args, {
      cwd: path.join(__dirname, '../..'), env: process.env, stdio: 'pipe'
    });
    autoDiscoveryStatus = {
      running: true, workers,
      totalProcessed: 0, totalCompaniesFound: 0,
      startedAt: new Date().toISOString(), currentLocations: []
    };

    autoDiscoveryProcess.stdout.on('data', (data) => {
      const line = data.toString();
      const dm = line.match(/\[Worker (\d+)\] Discovering: (.+)/);
      if (dm) autoDiscoveryStatus.currentLocations[parseInt(dm[1])] = dm[2].trim();
      const done = line.match(/Done: .+ — (\d+) companies/i);
      if (done) {
        autoDiscoveryStatus.totalCompaniesFound += parseInt(done[1]);
        autoDiscoveryStatus.totalProcessed++;
      }
    });
    autoDiscoveryProcess.on('close', () => {
      autoDiscoveryStatus.running = false;
      autoDiscoveryProcess = null;
    });

    res.json({ success: true, message: 'Auto-discovery started', status: autoDiscoveryStatus });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** POST /api/discovery/queue/auto-stop */
router.post('/queue/auto-stop', (req, res) => {
  if (autoDiscoveryProcess) {
    autoDiscoveryProcess.kill('SIGINT');
    autoDiscoveryProcess = null;
    autoDiscoveryStatus.running = false;
    res.json({ success: true, message: 'Auto-discovery stopped' });
  } else {
    res.json({ success: true, message: 'Not running' });
  }
});

/** GET /api/discovery/queue/auto-status */
router.get('/queue/auto-status', async (req, res) => {
  try {
    const { pool } = require('../db/connection');

    // Live in-progress rows — accurate whether started via UI or PM2
    const inProgress = await pool.query(`
      SELECT city, state_region, country, started_at
      FROM discovery_queue
      WHERE status = 'in_progress'
      ORDER BY started_at ASC
    `);

    // Recent activity summary
    const activity = await pool.query(`
      SELECT
        MAX(completed_at)                                                       AS last_completed_at,
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '10 minutes')   AS recent_10m,
        COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '1 hour')       AS recent_1h,
        COALESCE(SUM(companies_found) FILTER (WHERE completed_at > NOW() - INTERVAL '1 hour'), 0) AS companies_last_hour
      FROM discovery_queue
      WHERE status IN ('completed', 'failed', 'skipped')
    `);

    const a = activity.rows[0];
    const dbRunning = inProgress.rows.length > 0;

    res.json({
      success: true,
      status: {
        ...autoDiscoveryStatus,
        // DB-derived — always accurate even after server restarts or PM2 mode
        dbRunning,
        inProgressLocations: inProgress.rows,   // [{city, state_region, country, started_at}]
        lastCompletedAt: a.last_completed_at,
        recent10m: parseInt(a.recent_10m || 0),
        recent1h: parseInt(a.recent_1h || 0),
        companiesLastHour: parseInt(a.companies_last_hour || 0),
      }
    });
  } catch (e) {
    res.json({ success: true, status: autoDiscoveryStatus });
  }
});

/**
 * Search LinkedIn for companies
 */
router.post('/linkedin/companies', async (req, res) => {
  try {
    const { query, location, industry } = req.body;
    if (!query || !location) {
      return res.status(400).json({ success: false, error: 'Query and location are required' });
    }
    const results = await linkedInService.searchCompanies(query, location, industry);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[API] LinkedIn search error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Search LinkedIn for professionals
 */
router.post('/linkedin/professionals', async (req, res) => {
  try {
    const { keywords, location, industry, title } = req.body;
    if (!keywords || !location) {
      return res.status(400).json({ success: false, error: 'Keywords and location are required' });
    }
    const results = await linkedInService.searchProfessionals(keywords, location, industry, title);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[API] LinkedIn professional search error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Search LinkedIn for schools
 */
router.post('/linkedin/schools', async (req, res) => {
  try {
    const { schoolName, location, type = 'private' } = req.body;
    if (!schoolName || !location) {
      return res.status(400).json({ success: false, error: 'School name and location are required' });
    }
    const results = await linkedInService.searchSchools(schoolName, location, type);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('[API] LinkedIn school search error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CSV EXPORT ENDPOINTS
// GET /api/discovery/export/companies
// GET /api/discovery/export/contacts
// GET /api/discovery/export/combined
//
// Query params (all optional):
//   with_email=1        contacts with email only
//   country=GB          filter by country (partial match)
//   industry=Tech       filter by industry (partial match)
//   limit=5000          cap rows
// ─────────────────────────────────────────────────────────────────────────────

const { pool: dbPool } = require('../db/connection');

function csvEsc(val) {
  if (val === null || val === undefined) return '';
  const s = String(val).replace(/\r?\n/g, ' ').trim();
  return (s.includes(',') || s.includes('"')) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(...vals) { return vals.map(csvEsc).join(','); }

function startCSV(res, filename) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('\uFEFF'); // UTF-8 BOM so Excel opens it correctly
}

function buildFilters(query, contactAlias = 'c', accountAlias = 'a') {
  const clauses = [];
  const params  = [];
  if (query.with_email === '1' || query.with_email === 'true') {
    clauses.push(`${contactAlias}.email IS NOT NULL AND ${contactAlias}.email != ''`);
  }
  if (query.country) {
    params.push(`%${query.country}%`);
    clauses.push(`${accountAlias}.country ILIKE $${params.length}`);
  }
  if (query.industry) {
    params.push(`%${query.industry}%`);
    clauses.push(`${accountAlias}.industry ILIKE $${params.length}`);
  }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params };
}

/** GET /api/discovery/export/companies */
router.get('/export/companies', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 0;
    const { where, params } = buildFilters(req.query, 'a', 'a');

    const result = await dbPool.query(`
      SELECT
        a.account_id, a.company_name, a.industry, a.company_category, a.company_size,
        a.revenue, a.country, a.state_region, a.city, a.district, a.address,
        a.website, a.phone_number, a.email_format, a.linkedin_url,
        a.rating, a.verified, a.data_source, a.created_at,
        COUNT(c.contact_id)                                 AS contact_count,
        COUNT(CASE WHEN c.email IS NOT NULL THEN 1 END)     AS contacts_with_email
      FROM accounts a
      LEFT JOIN contacts c ON c.linked_account_id = a.account_id
      ${where}
      GROUP BY a.account_id
      ORDER BY a.company_name ASC
      ${limit > 0 ? `LIMIT ${limit}` : ''}
    `, params);

    const ts = new Date().toISOString().slice(0, 10);
    startCSV(res, `companies_${ts}.csv`);
    res.write(csvRow(
      'Account ID','Company Name','Industry','Category','Company Size','Revenue',
      'Country','State/Region','City','District','Address',
      'Website','Phone','Email Format','LinkedIn URL',
      'Rating','Verified','Data Source','Created At',
      'Total Contacts','Contacts With Email'
    ) + '\r\n');

    for (const r of result.rows) {
      res.write(csvRow(
        r.account_id, r.company_name, r.industry, r.company_category, r.company_size,
        r.revenue, r.country, r.state_region, r.city, r.district, r.address,
        r.website, r.phone_number, r.email_format, r.linkedin_url,
        r.rating, r.verified ? 'Yes' : 'No', r.data_source, r.created_at,
        r.contact_count, r.contacts_with_email
      ) + '\r\n');
    }
    res.end();
  } catch (e) {
    console.error('[CSV Export] companies error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

/** GET /api/discovery/export/contacts */
router.get('/export/contacts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 0;
    const { where, params } = buildFilters(req.query);

    const result = await dbPool.query(`
      SELECT
        c.contact_id, c.first_name, c.last_name,
        (c.first_name || ' ' || c.last_name)  AS full_name,
        c.job_title, c.email, c.phone_number   AS contact_phone,
        c.data_source, c.verified, c.confidence_score, c.created_at,
        a.account_id, a.company_name, a.website, a.phone_number AS company_phone,
        a.email_format, a.linkedin_url, a.industry, a.company_size,
        a.country, a.state_region, a.city, a.address
      FROM contacts c
      JOIN accounts a ON a.account_id = c.linked_account_id
      ${where}
      ORDER BY a.company_name ASC, c.last_name ASC, c.first_name ASC
      ${limit > 0 ? `LIMIT ${limit}` : ''}
    `, params);

    const ts = new Date().toISOString().slice(0, 10);
    startCSV(res, `contacts_${ts}.csv`);
    res.write(csvRow(
      'Contact ID','First Name','Last Name','Full Name','Job Title',
      'Email','Contact Phone','Data Source','Verified','Confidence Score','Created At',
      'Account ID','Company Name','Website','Company Phone',
      'Email Format','LinkedIn','Industry','Company Size',
      'Country','State/Region','City','Address'
    ) + '\r\n');

    for (const r of result.rows) {
      res.write(csvRow(
        r.contact_id, r.first_name, r.last_name, r.full_name, r.job_title,
        r.email, r.contact_phone, r.data_source, r.verified ? 'Yes' : 'No',
        r.confidence_score, r.created_at ? new Date(r.created_at).toISOString().slice(0,10) : '',
        r.account_id, r.company_name, r.website, r.company_phone,
        r.email_format, r.linkedin_url, r.industry, r.company_size,
        r.country, r.state_region, r.city, r.address
      ) + '\r\n');
    }
    res.end();
  } catch (e) {
    console.error('[CSV Export] contacts error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

/** GET /api/discovery/export/combined  (one flat row per contact — best for CRM import) */
router.get('/export/combined', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 0;
    const { where, params } = buildFilters(req.query);

    const result = await dbPool.query(`
      SELECT
        c.first_name, c.last_name,
        (c.first_name || ' ' || c.last_name)  AS full_name,
        c.job_title,
        c.email,
        c.phone_number                         AS direct_phone,
        a.company_name, a.industry, a.company_size,
        a.website, a.phone_number              AS company_phone,
        a.email_format, a.linkedin_url,
        a.country, a.state_region, a.city, a.address,
        c.data_source, c.confidence_score,
        c.verified                             AS contact_verified,
        a.verified                             AS company_verified,
        c.created_at
      FROM contacts c
      JOIN accounts a ON a.account_id = c.linked_account_id
      ${where}
      ORDER BY a.company_name ASC, c.last_name ASC, c.first_name ASC
      ${limit > 0 ? `LIMIT ${limit}` : ''}
    `, params);

    const ts = new Date().toISOString().slice(0, 10);
    startCSV(res, `combined_${ts}.csv`);
    res.write(csvRow(
      'First Name','Last Name','Full Name','Job Title','Email','Direct Phone',
      'Company','Industry','Company Size','Website','Company Phone',
      'Email Format','LinkedIn',
      'Country','State/Region','City','Address',
      'Source','Confidence','Contact Verified','Company Verified','Added On'
    ) + '\r\n');

    for (const r of result.rows) {
      res.write(csvRow(
        r.first_name, r.last_name, r.full_name, r.job_title, r.email, r.direct_phone,
        r.company_name, r.industry, r.company_size, r.website, r.company_phone,
        r.email_format, r.linkedin_url,
        r.country, r.state_region, r.city, r.address,
        r.data_source, r.confidence_score,
        r.contact_verified ? 'Yes' : 'No',
        r.company_verified ? 'Yes' : 'No',
        r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : ''
      ) + '\r\n');
    }
    res.end();
  } catch (e) {
    console.error('[CSV Export] combined error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
