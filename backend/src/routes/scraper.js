'use strict';

/**
 * /api/scraper  — Receives data from the Data Bunker browser extension.
 *
 * POST /api/scraper/people   — Upsert a batch of scraped contacts + their companies.
 * GET  /api/scraper/stats    — Scraping totals (contacts saved today, companies created)
 */

const express = require('express');
const router  = express.Router();
const { pool } = require('../db/connection');
const qwen    = require('../services/qwenService');
const emailIntelligence = require('../services/emailIntelligenceService');
const validator = require('../services/dataValidator');

// ── One-time column + index migration (runs on first import) ──────────────────
let migrationDone = false;
async function ensureSchema() {
  if (migrationDone) return;
  try {
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(500)`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS connection_degree VARCHAR(20)`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS seniority VARCHAR(50)`);
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS industry_hint VARCHAR(200)`);
    // email_format_guess: what AI thinks the email pattern is when no real email found
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_format_guess VARCHAR(500)`);
    // Unique index on linkedin_url so we can upsert without duplicates
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_linkedin_url
      ON contacts(linkedin_url)
      WHERE linkedin_url IS NOT NULL AND linkedin_url <> ''
    `);
    migrationDone = true;
  } catch (e) {
    console.warn('[scraper] schema migration warning:', e.message);
    migrationDone = true; // don't retry on every request
  }
}

// ── POST /api/scraper/people ──────────────────────────────────────────────────
router.post('/people', async (req, res) => {
  await ensureSchema();

  const { people, filters, source = 'linkedin_scrape' } = req.body;

  if (!Array.isArray(people) || people.length === 0) {
    return res.status(400).json({ error: 'people array required' });
  }

  const stats = { saved: 0, updated: 0, companies: 0, skipped: 0, enriched: 0 };
  const touchedContactIds = [];
  const touchedAccountIds = [];
  const client = await pool.connect();

  // Check Qwen once per request batch — avoids per-person overhead
  const qwenOnline = await qwen.isAvailable().catch(() => false);

  try {
    await client.query('BEGIN');

    for (const person of people) {
      let { fullName, jobTitle, company, location, profileUrl, connectionDegree, rawSnippet, subtitle } = person;

      // Support both 'subtitle' (extension format) and pre-parsed 'jobTitle'+'company'
      if (!jobTitle && !company && subtitle) {
        const atMatch = subtitle.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
        if (atMatch) {
          jobTitle = jobTitle || atMatch[1].trim();
          company  = company  || atMatch[2].split(/[·•\n]/)[0].trim();
        } else {
          jobTitle = jobTitle || subtitle.trim();
        }
      }

      // ── Skip only if truly no name ────────────────────────────
      if (!fullName || fullName.length < 2) { stats.skipped++; continue; }

      // ── VALIDATE: clean name, job title, company, location ──
      const nameResult = validator.validateName(fullName);
      fullName = nameResult.name;
      if (nameResult.overflow && !jobTitle) {
        const atMatch = nameResult.overflow.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
        if (atMatch) {
          jobTitle = atMatch[1].trim();
          if (!company) company = atMatch[2].split(/[·•\n]/)[0].trim();
        } else {
          jobTitle = nameResult.overflow;
        }
      }
      jobTitle = validator.validateJobTitle(jobTitle);
      company = validator.validateCompany(company) || 'Unknown';
      location = validator.validateLocation(location) || location;

      if (!fullName || fullName.length < 2) { stats.skipped++; continue; }

      // ── AI enrichment: call Qwen to extract full contact info ──────────────
      let aiData = {};
      if (qwenOnline) {
        const rawForAI = [fullName, jobTitle, company, location, rawSnippet, subtitle]
          .filter(Boolean).join(' · ');
        try {
          aiData = await qwen.extractFullContact(rawForAI);
          if (aiData && Object.keys(aiData).some(k => aiData[k])) stats.enriched++;
        } catch (ae) {
          console.warn('[scraper] Qwen extraction failed:', ae.message);
        }
      }

      // Merge: use AI result where our parser was empty, keep existing if AI missed
      if (aiData.jobTitle  && !jobTitle)  jobTitle  = aiData.jobTitle;
      if (aiData.company   && !company)   company   = aiData.company;
      if (!location && aiData.city && aiData.country) location = `${aiData.city}, ${aiData.country}`;

      const aiEmail           = aiData.email           || null;
      const aiPhone           = aiData.phone           || null;
      const aiIndustry        = aiData.industry        || null;
      const aiSeniority       = aiData.seniority       || null;
      const aiEmailFmtGuess   = aiData.emailFormatGuess || null;

      // ── Fast regex fallback: extract company from rawSnippet or subtitle ──
      if (!company || company.length < 2) {
        const snippet = rawSnippet || subtitle || '';
        const atMatch = snippet.match(/\b(?:at|@)\s+([A-Z][^\n·•]{2,60})/);
        if (atMatch) company = atMatch[1].split(/[·•\n]/)[0].trim();
      }

      // If still no company, use placeholder — never skip a real person
      if (!company || company.length < 2) company = 'Unknown';

      // ── Parse name ───────────────────────────────────────────
      const parts     = fullName.trim().split(/\s+/);
      const firstName = parts[0]              || '';
      const lastName  = parts.slice(1).join(' ') || '';

      // ── Parse location ───────────────────────────────────────
      const { city, country } = splitLocation(location || '');

      // ── Find or create account (company) ─────────────────────
      let accountId;
      try {
        accountId = await upsertCompany(client, {
          company,
          city,
          country,
          industry: aiIndustry,
          companySize: req.body.filters?.companySize,
          source,
        });
        if (accountId.isNew) stats.companies++;
        touchedAccountIds.push(accountId.id);
        accountId = accountId.id;
      } catch (e) {
        stats.skipped++;
        continue;
      }

      // ── Upsert contact ────────────────────────────────────────
      if (profileUrl) {
        // We have a profile URL — upsert by it (safest dedup key)
        const r = await client.query(`
          INSERT INTO contacts
            (first_name, last_name, job_title, email, phone_number, country, city,
             linked_account_id, linkedin_url, connection_degree, seniority,
             industry_hint, email_format_guess,
             data_source, verified, confidence_score)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,85)
          ON CONFLICT (linkedin_url)
            WHERE linkedin_url IS NOT NULL AND linkedin_url <> ''
          DO UPDATE SET
            job_title          = COALESCE(EXCLUDED.job_title,          contacts.job_title),
            email              = COALESCE(EXCLUDED.email,              contacts.email),
            phone_number       = COALESCE(EXCLUDED.phone_number,       contacts.phone_number),
            city               = COALESCE(EXCLUDED.city,               contacts.city),
            country            = COALESCE(EXCLUDED.country,            contacts.country),
            seniority          = COALESCE(EXCLUDED.seniority,          contacts.seniority),
            industry_hint      = COALESCE(EXCLUDED.industry_hint,      contacts.industry_hint),
            email_format_guess = COALESCE(EXCLUDED.email_format_guess, contacts.email_format_guess),
            connection_degree  = EXCLUDED.connection_degree
          RETURNING contact_id, (xmax = 0) AS is_new
        `, [firstName, lastName, jobTitle || null,
            aiEmail, aiPhone,
            country || null, city || null,
            accountId, profileUrl, connectionDegree || null,
            aiSeniority, aiIndustry, aiEmailFmtGuess,
            source]);

        if (r.rows[0]?.contact_id) touchedContactIds.push(r.rows[0].contact_id);

        if (r.rows[0]?.is_new) stats.saved++;
        else                   stats.updated++;
      } else {
        // No URL — insert only if (first_name, last_name, linked_account_id) is new
        const r = await client.query(`
          INSERT INTO contacts
            (first_name, last_name, job_title, email, phone_number, country, city,
             linked_account_id, seniority, industry_hint, email_format_guess,
             data_source, verified, confidence_score)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,70
          WHERE NOT EXISTS (
            SELECT 1 FROM contacts
            WHERE LOWER(first_name) = LOWER($1)
              AND LOWER(last_name)  = LOWER($2)
              AND linked_account_id = $8
          )
          RETURNING contact_id
        `, [firstName, lastName, jobTitle || null,
            aiEmail, aiPhone,
            country || null, city || null,
            accountId, aiSeniority, aiIndustry, aiEmailFmtGuess,
            source]);

        if (r.rows[0]?.contact_id) touchedContactIds.push(r.rows[0].contact_id);

        if (r.rows.length > 0) stats.saved++;
        else                   stats.skipped++;
      }
    }

    await client.query('COMMIT');

    if (touchedContactIds.length > 0 || touchedAccountIds.length > 0) {
      setImmediate(async () => {
        const contactIds = [...new Set(touchedContactIds)];
        const accountIds = [...new Set(touchedAccountIds)];

        for (const accountId of accountIds) {
          await emailIntelligence.analyzeAccount(accountId).catch(() => {});
        }
        for (const contactId of contactIds) {
          const contact = await pool.query('SELECT email FROM contacts WHERE contact_id = $1', [contactId]).catch(() => ({ rows: [] }));
          if (contact.rows[0]?.email) {
            await emailIntelligence.verifyContactEmail(contactId).catch(() => {});
          } else {
            await emailIntelligence.findForContact(contactId, { save: true }).catch(() => {});
          }
        }
      });
    }

    res.json({ ok: true, ...stats });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[scraper] error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ── GET /api/scraper/stats ────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM contacts WHERE data_source LIKE '%linkedin%') AS linkedin_contacts,
        (SELECT COUNT(*) FROM contacts WHERE data_source LIKE '%linkedin%'
           AND created_at > NOW() - INTERVAL '24 hours')                   AS contacts_today,
        (SELECT COUNT(*) FROM accounts WHERE data_source LIKE '%linkedin%') AS linkedin_companies,
        (SELECT COUNT(*) FROM contacts WHERE linkedin_url IS NOT NULL)      AS with_profile_url
    `);
    res.json({ ok: true, ...r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find account by company name (case-insensitive) or insert new one.
 * Returns { id, isNew }.
 */
async function upsertCompany(client, { company, city, country, industry, companySize, source }) {
  const cleanName = company.trim();

  // Try to find existing
  const existing = await client.query(
    `SELECT account_id FROM accounts WHERE LOWER(company_name) = LOWER($1) LIMIT 1`,
    [cleanName]
  );

  if (existing.rows.length > 0) {
    // Update industry if we now have it and it was missing
    if (industry) {
      await client.query(
        `UPDATE accounts SET industry = COALESCE(industry, $1) WHERE account_id = $2`,
        [industry, existing.rows[0].account_id]
      );
    }
    return { id: existing.rows[0].account_id, isNew: false };
  }

  // Insert new
  const r = await client.query(`
    INSERT INTO accounts
      (company_name, city, country, industry, company_size, data_source, verified)
    VALUES ($1,$2,$3,$4,$5,$6,false)
    ON CONFLICT DO NOTHING
    RETURNING account_id
  `, [cleanName, city || null, country || null, industry || null, companySize || null, source]);

  if (r.rows.length > 0) return { id: r.rows[0].account_id, isNew: true };

  // Race condition insert — re-fetch
  const refetch = await client.query(
    `SELECT account_id FROM accounts WHERE LOWER(company_name) = LOWER($1) LIMIT 1`,
    [cleanName]
  );
  if (refetch.rows.length > 0) return { id: refetch.rows[0].account_id, isNew: false };

  throw new Error(`Could not insert/find company: ${cleanName}`);
}

/**
 * Split "London, England, United Kingdom" → { city: 'London', country: 'United Kingdom' }
 */
function splitLocation(loc) {
  if (!loc) return { city: null, country: null };
  const parts = loc.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, country: null };
  if (parts.length === 1) return { city: null, country: parts[0] };
  return { city: parts[0], country: parts[parts.length - 1] };
}

// ── POST /api/scraper/extract ─────────────────────────────────────────────────
// Used by the extension to send raw page text → Qwen extracts structured fields
router.post('/extract', async (req, res) => {
  const { rawText, texts } = req.body;

  if (!rawText && !Array.isArray(texts)) {
    return res.status(400).json({ error: 'rawText or texts[] required' });
  }

  const qwenOnline = await qwen.isAvailable().catch(() => false);
  if (!qwenOnline) {
    return res.status(503).json({ error: 'Qwen model not available', qwenOnline: false });
  }

  try {
    if (Array.isArray(texts)) {
      const results = await qwen.extractBatch(texts);
      return res.json({ ok: true, results });
    }
    const result = await qwen.extractFromText(rawText);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/scraper/qwen-status ──────────────────────────────────────────────
router.get('/qwen-status', async (req, res) => {
  qwen.available = null; // force fresh check
  const online = await qwen.isAvailable().catch(() => false);
  res.json({
    qwenOnline: online,
    model: 'qwen2.5:0.5b',
    reason: online ? 'ready' : 'Ollama not running — scraping works fine without it',
    optional: true, // AI enrichment is optional; scraper saves contacts regardless
  });
});

// ── POST /api/scraper/debug — returns parsed data WITHOUT saving ───────────────
// Lets you see exactly what the extension extracted before committing to DB
router.post('/debug', async (req, res) => {
  const { people } = req.body;
  if (!Array.isArray(people)) return res.status(400).json({ error: 'people[] required' });

  const results = [];

  for (const person of people.slice(0, 10)) {
    let { fullName, jobTitle, company, location, profileUrl, rawSnippet, subtitle } = person;
    // Replicate the same fast extraction logic as /people
    if (!jobTitle && !company && subtitle) {
      const atIdx = subtitle.indexOf(' at ');
      if (atIdx !== -1) {
        jobTitle = jobTitle || subtitle.slice(0, atIdx).trim();
        company  = company  || subtitle.slice(atIdx + 4).trim();
      } else {
        jobTitle = jobTitle || subtitle.trim();
      }
    }
    if (!company || company.length < 2) {
      const snippet = rawSnippet || subtitle || '';
      const atMatch = snippet.match(/\bat\s+([A-Z][^\n·•]{2,60})/);
      if (atMatch) company = atMatch[1].split(/[·•\n]/)[0].trim();
    }
    if (!company || company.length < 2) company = 'LinkedIn Contact';
    results.push({ received: { fullName, jobTitle, company, location, profileUrl } });
  }

  res.json({ ok: true, total: people.length, sample: results });
});

// ── GET /api/scraper/test-ai — full health check + live extraction test ────────
// Call this to verify Qwen is alive and extracting correctly
router.get('/test-ai', async (req, res) => {
  const start = Date.now();

  // 1. Check Qwen availability
  qwen.available = null;
  const online = await qwen.isAvailable().catch(() => false);

  const status = {
    qwenOnline:  online,
    model:       'qwen2.5:0.5b',
    ollamaHost:  `${process.env.OLLAMA_HOST || 'localhost'}:${process.env.OLLAMA_PORT || '11434'}`,
    checkedAt:   new Date().toISOString(),
  };

  if (!online) {
    return res.json({
      ok: false,
      status,
      message: 'Qwen is OFFLINE. Start Ollama: `ollama serve` then `ollama pull qwen2.5:0.5b`',
      extractionTest: null,
      timingMs: Date.now() - start,
    });
  }

  // 2. Run a live extraction test with 3 realistic LinkedIn-style snippets
  const testCases = [
    {
      label: 'LinkedIn card with name, title, company, location',
      input: 'Sarah Jones · CEO at TechCorp Ltd · London, United Kingdom · 1st',
    },
    {
      label: 'Profile with email and phone visible',
      input: 'Mohammed Al-Rashid · Founder & Managing Director · Al-Rashid Consulting · Dubai, UAE · +971 50 123 4567 · mohammed@alrashid.ae',
    },
    {
      label: 'Short card — junior role',
      input: 'Emma Clarke Junior Software Developer StartupXYZ Manchester England',
    },
  ];

  const testResults = [];
  for (const tc of testCases) {
    const t0 = Date.now();
    try {
      const extracted = await qwen.extractFullContact(tc.input);
      testResults.push({
        label:     tc.label,
        input:     tc.input,
        extracted,
        timingMs:  Date.now() - t0,
        passed:    !!(extracted.firstName || extracted.lastName || extracted.company),
      });
    } catch (e) {
      testResults.push({ label: tc.label, input: tc.input, error: e.message, passed: false });
    }
  }

  const allPassed = testResults.every(t => t.passed);

  // 3. DB stats
  let dbStats = {};
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM contacts) AS total_contacts,
        (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL) AS contacts_with_email,
        (SELECT COUNT(*) FROM contacts WHERE phone_number IS NOT NULL) AS contacts_with_phone,
        (SELECT COUNT(*) FROM contacts WHERE seniority IS NOT NULL) AS contacts_with_seniority,
        (SELECT COUNT(*) FROM contacts WHERE industry_hint IS NOT NULL) AS contacts_with_industry,
        (SELECT COUNT(*) FROM accounts WHERE industry IS NOT NULL) AS accounts_with_industry
    `);
    dbStats = r.rows[0];
  } catch (e) {
    dbStats = { error: e.message };
  }

  res.json({
    ok:             allPassed,
    status,
    message:        allPassed
      ? `Qwen is ONLINE and working. All ${testResults.length} extraction tests passed.`
      : `Qwen is online but some extractions failed — check testResults.`,
    extractionTests: testResults,
    dbStats,
    timingMs:       Date.now() - start,
  });
});

// ── POST /api/scraper/universal ───────────────────────────────────────────────
// Accepts arbitrary key-value records from the universal extension scraper.
// Tries to map known fields into contacts/accounts tables; stores whatever else
// as JSONB in a generic `raw_data` column (added if missing).
router.post('/universal', async (req, res) => {
  await ensureSchema();

  const { records, source = 'universal_scrape', url } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records[] array required' });
  }

  const stats = { saved: 0, skipped: 0, companies: 0 };
  const client = await pool.connect();

  try {
    // Ensure raw_data column exists (idempotent)
    await client.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS raw_data JSONB`);

    await client.query('BEGIN');

    for (const rec of records) {
      // Map common field names from the scraper to our schema
      const fullName = rec.name || rec.fullName || rec.full_name || null;
      const email    = rec.email || rec.emailAddress || null;
      const phone    = rec.phone || rec.phoneNumber  || rec.phone_number || null;
      const company  = rec.company || rec.organisation || rec.organization || rec.employer || null;
      const jobTitle = rec.jobTitle || rec.job_title || rec.title || rec.position || null;
      const location = rec.location || rec.address || null;
      const website  = rec.website || rec.url || null;
      const linkedin = rec.linkedinUrl || rec.linkedin || null;

      // Need at least one identifying field
      if (!fullName && !email && !phone) { stats.skipped++; continue; }

      const parts     = (fullName || '').trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName  = parts.slice(1).join(' ') || '';

      const { city, country } = splitLocation(location || '');

      let accountId = null;
      if (company) {
        try {
          const r = await upsertCompany(client, { company, city, country, source });
          if (r.isNew) stats.companies++;
          accountId = r.id;
        } catch { /* skip company linking on error */ }
      }

      const r = await client.query(`
        INSERT INTO contacts
          (first_name, last_name, job_title, email, phone_number,
           country, city, linked_account_id, linkedin_url, raw_data,
           data_source, verified, confidence_score)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,60
        WHERE NOT EXISTS (
          SELECT 1 FROM contacts
          WHERE (email IS NOT NULL AND email = $4)
             OR (phone_number IS NOT NULL AND phone_number = $5)
             OR (linkedin_url IS NOT NULL AND linkedin_url = $9)
             OR (LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2)
                 AND linked_account_id IS NOT DISTINCT FROM $8)
        )
        RETURNING contact_id
      `, [
        firstName || null, lastName || null, jobTitle, email, phone,
        country, city, accountId, linkedin,
        JSON.stringify({ ...rec, _source_url: url }),
        source,
      ]);

      if (r.rows.length > 0) stats.saved++;
      else stats.skipped++;
    }

    await client.query('COMMIT');
    res.json({ ok: true, ...stats });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[scraper/universal] error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/scraper/leads — Universal AI-powered lead extraction v5.0
//
// Receives raw text blocks from the extension's content script and uses
// regex + Qwen AI to parse them into structured Lead objects, then upserts
// into contacts + accounts tables. Works for LinkedIn, Maps, or any site.
// ══════════════════════════════════════════════════════════════════════════════
router.post('/leads', async (req, res) => {
  await ensureSchema();

  const { blocks, url, strategy, source, filters } = req.body;
  if (!Array.isArray(blocks) || !blocks.length) {
    return res.status(400).json({ error: 'blocks array required' });
  }

  const stats = { saved: 0, updated: 0, skipped: 0, companies: 0, enriched: 0, queued: 0 };
  const newAccountIds = [];   // track new companies for auto-enrichment
  const touchedContactIds = [];
  const touchedAccountIds = [];
  const qwenOnline = await qwen.isAvailable().catch(() => false);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const block of blocks) {
      try {
        // ── Step 1: Parse lead from block (regex first, then AI fallback) ──
        const lead = parseLeadBlock(block, strategy, filters);

        // ── Step 2: AI enrichment if Qwen is available ──
        if (qwenOnline && lead.rawText) {
          try {
            const aiData = await qwen.extractFullContact(lead.rawText);
            if (aiData) {
              if (aiData.firstName && !lead.firstName) lead.firstName = aiData.firstName;
              if (aiData.lastName && !lead.lastName)   lead.lastName = aiData.lastName;
              if (aiData.jobTitle && !lead.jobTitle)    lead.jobTitle = aiData.jobTitle;
              if (aiData.company && !lead.company)      lead.company = aiData.company;
              if (aiData.email)                         lead.email = lead.email || aiData.email;
              if (aiData.phone)                         lead.phone = lead.phone || aiData.phone;
              if (aiData.industry)                      lead.industry = aiData.industry;
              if (aiData.seniority)                     lead.seniority = aiData.seniority;
              if (aiData.city)                          lead.city = lead.city || aiData.city;
              if (aiData.country)                       lead.country = lead.country || aiData.country;
              if (aiData.emailFormatGuess)              lead.emailFormatGuess = aiData.emailFormatGuess;
              stats.enriched++;
            }
          } catch (e) {
            console.warn('[leads] AI enrichment failed:', e.message);
          }
        }

        // ── Step 3: Validate — must have at least a name ──
        if (!lead.firstName && !lead.lastName) {
          // Try splitting fullName one more time
          if (lead.fullName) {
            const parts = lead.fullName.trim().split(/\s+/);
            lead.firstName = parts[0] || '';
            lead.lastName = parts.slice(1).join(' ') || '';
          }
        }
        if (!lead.firstName || lead.firstName.length < 1) { stats.skipped++; continue; }

        // ── Step 4: Ensure company exists ──
        if (!lead.company || lead.company.length < 2) {
          // Extract from subtitle "Title at/@ Company"
          if (lead.subtitle) {
            const atMatch = lead.subtitle.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
            if (atMatch) lead.company = atMatch[2].split(/[·•\n]/)[0].trim();
          }
        }
        if (!lead.company || lead.company.length < 2) lead.company = 'Unknown';

        // Ensure job_title is never null (DB trigger enforces this)
        if (!lead.jobTitle || lead.jobTitle.trim().length < 1) lead.jobTitle = '';

        let accountId;
        try {
          accountId = await upsertCompany(client, {
            company: lead.company,
            city: lead.city || null,
            country: lead.country || null,
            industry: lead.industry || null,
            source: source || strategy || 'extension',
          });
          if (accountId.isNew) { stats.companies++; newAccountIds.push(accountId.id); }
          touchedAccountIds.push(accountId.id);
          accountId = accountId.id;
        } catch (e) { stats.skipped++; continue; }

        // ── Step 5: Upsert contact ──
        if (lead.linkedinUrl) {
          const r = await client.query(`
            INSERT INTO contacts
              (first_name, last_name, job_title, email, phone_number, country, city,
               linked_account_id, linkedin_url, connection_degree, seniority,
               industry_hint, email_format_guess,
               data_source, verified, confidence_score)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,85)
            ON CONFLICT (linkedin_url)
              WHERE linkedin_url IS NOT NULL AND linkedin_url <> ''
            DO UPDATE SET
              job_title          = COALESCE(NULLIF(EXCLUDED.job_title,''),          contacts.job_title),
              email              = COALESCE(NULLIF(EXCLUDED.email,''),              contacts.email),
              phone_number       = COALESCE(NULLIF(EXCLUDED.phone_number,''),       contacts.phone_number),
              city               = COALESCE(NULLIF(EXCLUDED.city,''),               contacts.city),
              country            = COALESCE(NULLIF(EXCLUDED.country,''),            contacts.country),
              seniority          = COALESCE(NULLIF(EXCLUDED.seniority,''),          contacts.seniority),
              industry_hint      = COALESCE(NULLIF(EXCLUDED.industry_hint,''),      contacts.industry_hint),
              email_format_guess = COALESCE(NULLIF(EXCLUDED.email_format_guess,''), contacts.email_format_guess)
            RETURNING contact_id, (xmax = 0) AS is_new
          `, [
            lead.firstName, lead.lastName, lead.jobTitle || null,
            lead.email || null, lead.phone || null,
            lead.country || null, lead.city || null,
            accountId, lead.linkedinUrl, lead.degree || null,
            lead.seniority || null, lead.industry || null, lead.emailFormatGuess || null,
            source || strategy || 'extension'
          ]);
          if (r.rows[0]?.contact_id) touchedContactIds.push(r.rows[0].contact_id);
          if (r.rows[0]?.is_new) stats.saved++;
          else stats.updated++;
        } else {
          // No LinkedIn URL — insert only if not duplicate by name+company
          const r = await client.query(`
            INSERT INTO contacts
              (first_name, last_name, job_title, email, phone_number, country, city,
               linked_account_id, seniority, industry_hint, email_format_guess,
               data_source, verified, confidence_score)
            SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,70
            WHERE NOT EXISTS (
              SELECT 1 FROM contacts
              WHERE LOWER(first_name) = LOWER($1)
                AND LOWER(last_name)  = LOWER($2)
                AND linked_account_id = $8
            )
            RETURNING contact_id
          `, [
            lead.firstName, lead.lastName, lead.jobTitle || null,
            lead.email || null, lead.phone || null,
            lead.country || null, lead.city || null,
            accountId, lead.seniority || null, lead.industry || null, lead.emailFormatGuess || null,
            source || strategy || 'extension'
          ]);
          if (r.rows[0]?.contact_id) touchedContactIds.push(r.rows[0].contact_id);
          if (r.rows.length > 0) stats.saved++;
          else stats.skipped++;
        }
      } catch (blockErr) {
        console.warn('[leads] block processing error:', blockErr.message);
        stats.skipped++;
      }
    }

    await client.query('COMMIT');

    if (touchedContactIds.length > 0 || touchedAccountIds.length > 0) {
      setImmediate(async () => {
        const contactIds = [...new Set(touchedContactIds)];
        const accountIds = [...new Set(touchedAccountIds)];

        for (const accountId of accountIds) {
          await emailIntelligence.analyzeAccount(accountId).catch(() => {});
        }
        for (const contactId of contactIds) {
          const contact = await pool.query('SELECT email FROM contacts WHERE contact_id = $1', [contactId]).catch(() => ({ rows: [] }));
          if (contact.rows[0]?.email) {
            await emailIntelligence.verifyContactEmail(contactId).catch(() => {});
          } else {
            await emailIntelligence.findForContact(contactId, { save: true }).catch(() => {});
          }
        }
      });
    }

    // ── Auto-queue new companies for enrichment (fire-and-forget) ──
    if (newAccountIds.length > 0) {
      (async () => {
        try {
          await pool.query(`
            CREATE TABLE IF NOT EXISTS enrichment_queue_v2 (
              id SERIAL PRIMARY KEY,
              company_id INTEGER NOT NULL,
              priority INTEGER DEFAULT 0,
              status VARCHAR(50) DEFAULT 'pending',
              retry_count INTEGER DEFAULT 0,
              last_attempt TIMESTAMP,
              error_message TEXT,
              worker_id VARCHAR(100),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(company_id)
            )
          `);
          const r = await pool.query(`
            INSERT INTO enrichment_queue_v2 (company_id, priority, status)
            SELECT unnest($1::int[]), 1, 'pending'
            ON CONFLICT (company_id) DO NOTHING
            RETURNING company_id
          `, [newAccountIds]);
          const queued = r.rowCount || 0;
          if (queued > 0) console.log(`[leads] Auto-queued ${queued} new companies for enrichment`);
          stats.queued = queued;
        } catch (qErr) {
          console.warn('[leads] Auto-queue enrichment failed (non-fatal):', qErr.message);
        }
      })();
    }

    console.log(`[leads] Processed ${blocks.length} blocks: ${stats.saved} saved, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.enriched} AI-enriched, ${newAccountIds.length} new companies`);
    res.json({ ok: true, ...stats });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[scraper/leads] error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/**
 * Parse a raw lead block into structured fields using regex.
 * Works across all site strategies — LinkedIn cards, Maps listings, generic cards.
 */
function parseLeadBlock(block, strategy, filters) {
  const lead = {
    fullName: '', firstName: '', lastName: '',
    jobTitle: '', company: '', email: '', phone: '',
    linkedinUrl: '', city: '', country: '', industry: '',
    seniority: '', degree: '', website: '', subtitle: '',
    rawText: block.rawText || '', emailFormatGuess: '',
  };

  // Pre-parsed fields from content.js
  if (block.name) lead.fullName = block.name.trim();
  if (block.subtitle) lead.subtitle = block.subtitle.trim();
  if (block.profileUrl) lead.linkedinUrl = block.profileUrl;
  if (block.location) {
    const loc = splitLocation(block.location);
    lead.city = loc.city;
    lead.country = loc.country;
  }
  if (block.email) lead.email = block.email;
  if (block.phone) lead.phone = block.phone;
  if (block.website) lead.website = block.website;
  if (block.linkedinUrl) lead.linkedinUrl = block.linkedinUrl;

  // Parse subtitle → jobTitle + company
  // ONLY extract company from explicit "Title at Company" pattern.
  // Never guess company from rawText — wrong companies are worse than no company.
  if (lead.subtitle) {
    const atMatch = lead.subtitle.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (atMatch) {
      lead.jobTitle = atMatch[1].trim();
      lead.company = atMatch[2].split(/[·•\n]/)[0].trim();
    } else {
      lead.jobTitle = lead.subtitle;
    }
  }

  // Fallback: extract job title from rawText ONLY (never company)
  if (!lead.jobTitle && lead.rawText) {
    const lines = lead.rawText.split(/[·\n]/).map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const line = lines[i];
      if (!line || line.length < 3) continue;
      if (lead.fullName && line.toLowerCase() === lead.fullName.toLowerCase()) continue;
      if (/connect|follow|message|degree|mutual|view/i.test(line)) continue;
      if (/^\d+\s*(connection|follower|mutual)/i.test(line)) continue;
      // "Title at/@ Company" pattern — extract BOTH
      const atMatch = line.match(/^(.{3,60})\s+(?:at|@)\s+(.{2,60})$/i);
      if (atMatch) {
        lead.jobTitle = atMatch[1].trim();
        if (!lead.company) lead.company = atMatch[2].split(/[·•,]/)[0].trim();
        break;
      }
      // Otherwise just take it as job title — DO NOT extract company
      if (/^[A-Z]/.test(line) && line.length > 3 && line.length < 100) {
        lead.jobTitle = line;
        break;
      }
    }
  }

  // Parse name → first + last (with sanitization)
  if (lead.fullName) {
    let fn = lead.fullName.trim()
      .replace(/^[\s\u2022\u00b7\-\u2013\u2014|]+/, '')
      .replace(/[\s\u2022\u00b7\-\u2013\u2014|]+$/, '')
      .replace(/\b\d+(st|nd|rd|th)\+?\b/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[^a-zA-Z\u00C0-\u00FF\s'.\-]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (fn.length > 60) fn = fn.slice(0, 60).replace(/\s\S*$/, '').trim();
    lead.fullName = fn;
    const parts = fn.split(/\s+/);
    lead.firstName = parts[0] || '';
    lead.lastName = parts.slice(1).join(' ') || '';
  }

  // Regex extraction from rawText for missing fields
  const text = lead.rawText;
  if (text) {
    if (!lead.email) {
      const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      if (m) lead.email = m[0];
    }
    if (!lead.phone) {
      const m = text.match(/[\+]?[\d][\d\s\-(). ]{6,16}[\d]/);
      if (m) lead.phone = m[0].trim();
    }
    if (!lead.fullName) {
      // Try "Name at Company" or "Name - Title" patterns
      const nameMatch = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
      if (nameMatch) {
        lead.fullName = nameMatch[1];
        const parts = lead.fullName.split(/\s+/);
        lead.firstName = parts[0];
        lead.lastName = parts.slice(1).join(' ');
      }
    }
    // NOTE: We do NOT extract company from rawText — only from explicit "at/@ Company"
    // in the subtitle. Wrong companies are worse than no company.
  }

  // Maps-specific: use business name as company
  if (strategy === 'maps' && lead.fullName && !lead.company) {
    lead.company = lead.fullName;
    lead.fullName = '';
    lead.firstName = '';
    lead.lastName = '';
  }

  // Use page-level filters to supplement missing data
  if (filters) {
    if (!lead.industry && filters.industry) {
      // Only use industry if it looks like a real name, not a LinkedIn code like ["25"]
      const ind = String(filters.industry).replace(/^[\["\]]+|[\["\]]+$/g, '').trim();
      if (ind.length > 1 && !/^\d+$/.test(ind)) lead.industry = ind;
    }
    if (!lead.city && !lead.country && filters.locationText) {
      const loc = splitLocation(filters.locationText);
      if (loc.city) lead.city = loc.city;
      if (loc.country) lead.country = loc.country;
    }
  }

  // ── VALIDATION: clean every field before saving ──
  return validator.validateLead(lead);
}

// ── POST /api/scraper/cleanup — Fix all existing bad data in the database ─────
router.post('/cleanup', async (req, res) => {
  try {
    console.log('[scraper] Running data cleanup...');
    const results = await validator.cleanExistingData(pool);
    const totalFixed = results.reduce((s, r) => s + (r.rowsAffected || 0), 0);
    console.log(`[scraper] Cleanup done: ${totalFixed} rows fixed`);
    res.json({ ok: true, totalFixed, details: results });
  } catch (e) {
    console.error('[scraper] Cleanup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
