/**
 * Company Enrichment Routes (Simplified)
 * Works with current database schema and worker queue
 */

const express = require('express');
const router = express.Router();
const simpleEnrichmentService = require('../services/simpleEnrichmentService');
const { pool } = require('../db/connection');

/**
 * GET /api/enrichment/stats
 * Get enrichment statistics including queue status
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await simpleEnrichmentService.getStats();
    
    // Get queue statistics
    const queueStats = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM enrichment_queue_v2
      GROUP BY status
    `);
    
    const queueByStatus = {};
    queueStats.rows.forEach(row => {
      queueByStatus[row.status] = parseInt(row.count);
    });
    
    // Get active workers
    const activeWorkers = await pool.query(`
      SELECT DISTINCT worker_id, COUNT(*) as jobs_processing
      FROM enrichment_queue_v2
      WHERE status = 'processing'
      GROUP BY worker_id
    `);
    
    res.json({
      ...stats,
      queue: {
        pending: queueByStatus.pending || 0,
        processing: queueByStatus.processing || 0,
        completed: queueByStatus.completed || 0,
        failed: queueByStatus.failed || 0,
        total: Object.values(queueByStatus).reduce((sum, count) => sum + count, 0)
      },
      workers: {
        active: activeWorkers.rows.length,
        details: activeWorkers.rows
      }
    });
  } catch (error) {
    console.error('Error getting enrichment stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/enrich/:companyId
 * Enrich a specific company (direct processing, not queued)
 */
router.post('/enrich/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const result = await simpleEnrichmentService.enrichCompany(companyId);
    res.json(result);
  } catch (error) {
    console.error('Error enriching company:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/queue
 * Queue companies for background enrichment by workers
 * Body: { limit: number, priority: number } (optional)
 */
router.post('/queue', async (req, res) => {
  try {
    const { limit = 100, priority = 0 } = req.body || {};
    
    // Find companies that need enrichment
    const result = await pool.query(`
      INSERT INTO enrichment_queue_v2 (company_id, priority, status)
      SELECT c.id, $2, 'pending'
      FROM companies c
      WHERE c.website IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM enrichment_queue_v2 eq 
          WHERE eq.company_id = c.id 
            AND eq.status IN ('pending', 'processing')
        )
      ORDER BY c.last_updated DESC
      LIMIT $1
      ON CONFLICT (company_id) DO NOTHING
      RETURNING company_id
    `, [limit, priority]);
    
    res.json({
      success: true,
      queued: result.rowCount,
      message: `${result.rowCount} companies queued for enrichment`
    });
  } catch (error) {
    console.error('Error queueing companies:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/batch
 * Enrich a batch of companies (synchronous, for testing)
 * Body: { limit: number } (optional, default 10)
 */
router.post('/batch', async (req, res) => {
  try {
    const { limit } = req.body || {};
    const result = await simpleEnrichmentService.enrichBatch(limit || 10);
    res.json(result);
  } catch (error) {
    console.error('Error in batch enrichment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/enrichment/queue-status
 * Get detailed queue status by status type
 */
router.get('/queue-status', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM enrichment_queue_v2
      GROUP BY status
    `);
    
    const statusCounts = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };
    
    result.rows.forEach(row => {
      statusCounts[row.status] = parseInt(row.count);
    });
    
    res.json({
      success: true,
      data: statusCounts
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/enrichment/process
 * Process a batch of pending accounts in the queue
 * This enriches accounts by searching for websites based on company name
 */
router.post('/process', async (req, res) => {
  try {
    const { limit = 50 } = req.body;

    // Get pending items with account data
    const pending = await pool.query(`
      SELECT eq.company_id, eq.id as queue_id, a.company_name, a.city, a.country
      FROM enrichment_queue_v2 eq
      JOIN accounts a ON a.account_id = eq.company_id
      WHERE eq.status = 'pending'
      LIMIT $1
    `, [limit]);

    let processed = 0;
    let failed = 0;
    const results = [];

    for (const item of pending.rows) {
      try {
        // Mark as processing
        await pool.query(`
          UPDATE enrichment_queue_v2
          SET status = 'processing', last_attempt = NOW()
          WHERE id = $1
        `, [item.queue_id]);

        // Try to find website using company name
        const websiteResult = await discoverCompanyInfo(item.company_name, item.city, item.country);

        if (websiteResult.website) {
          // Update account with found website
          await pool.query(`
            UPDATE accounts
            SET website = $1, updated_at = NOW()
            WHERE account_id = $2 AND (website IS NULL OR website = '')
          `, [websiteResult.website, item.company_id]);

          await pool.query(`
            UPDATE enrichment_queue_v2
            SET status = 'completed', last_attempt = NOW()
            WHERE id = $1
          `, [item.queue_id]);

          processed++;
          results.push({ company: item.company_name, website: websiteResult.website, status: 'completed' });
        } else {
          // No website found
          await pool.query(`
            UPDATE enrichment_queue_v2
            SET status = 'failed',
                error_message = 'No website found',
                retry_count = retry_count + 1,
                last_attempt = NOW()
            WHERE id = $1
          `, [item.queue_id]);

          failed++;
          results.push({ company: item.company_name, status: 'no_website_found' });
        }
      } catch (error) {
        await pool.query(`
          UPDATE enrichment_queue_v2
          SET status = 'failed',
              error_message = $1,
              retry_count = retry_count + 1,
              last_attempt = NOW()
          WHERE id = $2
        `, [error.message, item.queue_id]);

        failed++;
        results.push({ company: item.company_name, error: error.message, status: 'error' });
      }
    }

    res.json({
      success: true,
      processed,
      failed,
      total: pending.rows.length,
      results
    });
  } catch (error) {
    console.error('Error processing queue:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Helper function to discover company info using web search
 * Searches for website, email format, and phone number
 */
async function discoverCompanyInfo(companyName, city, country) {
  const axios = require('axios');
  const cheerio = require('cheerio');

  if (!companyName) return { website: null, email: null, phone: null };

  const result = { website: null, email: null, phone: null };

  // Clean company name for search
  const cleanName = companyName
    .replace(/\s*(ltd|limited|llc|inc|plc|corp|corporation|co\.|company)\.?\s*$/i, '')
    .trim();

  // Build search query with location context
  const locationContext = city ? `${city} ${country || ''}` : (country || '');
  const searchQueries = [
    `"${cleanName}" ${locationContext} official website`,
    `"${cleanName}" ${locationContext} contact email phone`
  ];

  console.log(`[Enrichment] Searching for: ${cleanName}`);

  for (const query of searchQueries) {
    try {
      // Use DuckDuckGo HTML search (no API key needed)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const response = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);

      // Extract URLs from search results
      $('.result__url').each((i, el) => {
        if (i > 15) return false; // Check first 15 results for better coverage
        const url = $(el).text().trim();

        // Skip common non-company sites
        if (url && !result.website) {
          const skipDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'youtube.com',
                              'wikipedia.org', 'yelp.com', 'tripadvisor.com', 'glassdoor.com',
                              'indeed.com', 'crunchbase.com', 'bloomberg.com', 'gov.uk'];

          const shouldSkip = skipDomains.some(domain => url.includes(domain));
          if (!shouldSkip && url.includes('.')) {
            result.website = url.startsWith('http') ? url : `https://${url}`;
            console.log(`[Enrichment] Found website: ${result.website}`);
          }
        }
      });

      // Extract snippet text for email/phone patterns
      $('.result__snippet').each((i, el) => {
        const text = $(el).text();

        // Find email patterns
        if (!result.email) {
          const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (emailMatch) {
            result.email = emailMatch[0].toLowerCase();
            console.log(`[Enrichment] Found email: ${result.email}`);
          }
        }

        // Find phone patterns (various formats)
        if (!result.phone) {
          const phonePatterns = [
            /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,  // US format
            /\+44[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/,   // UK format
            /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/,                      // (xxx) xxx-xxxx
            /\d{3}[-.\s]\d{3}[-.\s]\d{4}/                         // xxx-xxx-xxxx
          ];

          for (const pattern of phonePatterns) {
            const phoneMatch = text.match(pattern);
            if (phoneMatch) {
              result.phone = phoneMatch[0].replace(/[^\d+]/g, '');
              if (result.phone.length >= 10) {
                console.log(`[Enrichment] Found phone: ${result.phone}`);
                break;
              }
              result.phone = null;
            }
          }
        }
      });

      // If we found a website, try to scrape it for more info
      if (result.website && (!result.email || !result.phone)) {
        try {
          const siteData = await scrapeWebsiteForContacts(result.website);
          if (!result.email && siteData.email) result.email = siteData.email;
          if (!result.phone && siteData.phone) result.phone = siteData.phone;
        } catch (e) {
          // Scraping failed, continue with what we have
        }
      }

      // If we found enough info, stop searching
      if (result.website) break;

    } catch (error) {
      console.log(`[Enrichment] Search error: ${error.message}`);
      continue;
    }
  }

  return result;
}

/**
 * Scrape a website for contact information
 */
async function scrapeWebsiteForContacts(url) {
  const axios = require('axios');
  const cheerio = require('cheerio');

  const result = { email: null, phone: null };

  try {
    // Try main page and multiple contact page variations
    const pagesToTry = [url];
    const baseUrl = url.replace(/\/$/, '');
    if (!url.includes('/contact')) {
      pagesToTry.push(`${baseUrl}/contact`);
      pagesToTry.push(`${baseUrl}/contact-us`);
      pagesToTry.push(`${baseUrl}/contactus`);
      pagesToTry.push(`${baseUrl}/about`);
      pagesToTry.push(`${baseUrl}/about-us`);
      pagesToTry.push(`${baseUrl}/team`);
      pagesToTry.push(`${baseUrl}/our-team`);
      pagesToTry.push(`${baseUrl}/staff`);
      pagesToTry.push(`${baseUrl}/people`);
      pagesToTry.push(`${baseUrl}/leadership`);
    }

    for (const pageUrl of pagesToTry) {
      try {
        const response = await axios.get(pageUrl, {
          timeout: 8000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          maxRedirects: 3
        });

        const $ = cheerio.load(response.data);
        const text = $('body').text();
        const html = response.data;

        // Find email
        if (!result.email) {
          // Check mailto links first
          const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
          if (mailtoMatch) {
            result.email = mailtoMatch[1].toLowerCase();
          } else {
            // Check text content
            const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch && !emailMatch[0].includes('example') && !emailMatch[0].includes('test')) {
              result.email = emailMatch[0].toLowerCase();
            }
          }
        }

        // Find phone
        if (!result.phone) {
          // Check tel links first
          const telMatch = html.match(/tel:([+\d\s()-]{10,})/i);
          if (telMatch) {
            result.phone = telMatch[1].replace(/[^\d+]/g, '');
          } else {
            // Check text content
            const phonePatterns = [
              /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
              /\+44[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/,
              /0\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}/
            ];

            for (const pattern of phonePatterns) {
              const phoneMatch = text.match(pattern);
              if (phoneMatch) {
                const phone = phoneMatch[0].replace(/[^\d+]/g, '');
                if (phone.length >= 10) {
                  result.phone = phone;
                  break;
                }
              }
            }
          }
        }

        if (result.email && result.phone) break;

      } catch (e) {
        continue;
      }
    }
  } catch (error) {
    // Scraping failed
  }

  return result;
}

/**
 * GET /api/enrichment/queue/status
 * Get queue status (backwards compatibility)
 */
router.get('/queue/status', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(created_at) as oldest,
        MAX(created_at) as newest,
        AVG(attempts) as avg_attempts
      FROM enrichment_queue_v2
      GROUP BY status
      ORDER BY status
    `);
    
    res.json({
      success: true,
      queue: result.rows
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/enrichment/queue/clear
 * Clear completed/failed jobs from queue
 */
router.delete('/queue/clear', async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM enrichment_queue_v2
      WHERE status IN ('completed', 'failed')
      RETURNING status
    `);
    
    const cleared = {};
    result.rows.forEach(row => {
      cleared[row.status] = (cleared[row.status] || 0) + 1;
    });
    
    res.json({
      success: true,
      cleared,
      total: result.rowCount
    });
  } catch (error) {
    console.error('Error clearing queue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/enrich-all
 * Queue companies for enrichment using batch insert
 * Body: { limit: number } - optional, defaults to 1000
 */
router.post('/enrich-all', async (req, res) => {
  try {
    const { limit = 1000 } = req.body || {};
    const batchLimit = Math.min(Math.max(1, limit), 100000); // Between 1 and 100000

    // Ensure enrichment_queue_v2 table exists with correct schema (INTEGER company_id)
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

    // Use INSERT with SELECT and LIMIT for batch operation
    // ON CONFLICT handles duplicates, so no need for slow NOT IN subquery
    const result = await pool.query(`
      INSERT INTO enrichment_queue_v2 (company_id, status, created_at)
      SELECT account_id, 'pending', NOW()
      FROM accounts
      WHERE (website IS NULL OR website = '' OR email_format IS NULL OR email_format = '')
      ORDER BY account_id
      LIMIT $1
      ON CONFLICT (company_id) DO NOTHING
      RETURNING company_id
    `, [batchLimit]);

    const queued = result.rowCount || 0;

    // Get total queue status
    const queueStatus = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM enrichment_queue_v2
    `);

    // Get total needing enrichment
    const totalNeeding = await pool.query(`
      SELECT COUNT(*) as count FROM accounts
      WHERE (website IS NULL OR website = '' OR email_format IS NULL OR email_format = '')
    `);

    const status = queueStatus.rows[0];

    res.json({
      success: true,
      data: {
        totalQueued: queued,
        pending: parseInt(status.pending || 0),
        processing: parseInt(status.processing || 0),
        completed: parseInt(status.completed || 0),
        totalNeedingEnrichment: parseInt(totalNeeding.rows[0]?.count || 0)
      }
    });
  } catch (error) {
    console.error('Error queueing all companies for enrichment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/enrichment/find-contacts
 * Find REAL contacts for companies in a location
 * Body: { city, region, country, limit }
 */
router.post('/find-contacts', async (req, res) => {
  const { spawn } = require('child_process');
  const path = require('path');

  try {
    const { city, region, country = 'United Kingdom', limit = 50 } = req.body;

    if (!city || !region) {
      return res.status(400).json({
        success: false,
        error: 'City and region are required'
      });
    }

    // Run the find-real-contacts script
    const scriptPath = path.join(__dirname, '../../scripts/find-real-contacts.js');
    const args = [scriptPath, city, region, country, limit.toString()];

    console.log(`[ContactFinder] Starting for ${city}, ${region}`);

    const process = spawn('node', args, {
      cwd: path.join(__dirname, '../..'),
      env: { ...require('process').env }
    });

    let output = '';
    let errorOutput = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
      console.log(`[ContactFinder] ${data}`);
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error(`[ContactFinder Error] ${data}`);
    });

    // Don't wait for completion - return immediately
    res.json({
      success: true,
      message: `Finding real contacts for ${city}, ${region}. Processing ${limit} companies.`,
      status: 'started'
    });

  } catch (error) {
    console.error('Error starting contact finder:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/enrichment/find-all-contacts
 * Find REAL contacts for all companies missing contacts
 * Body: { limit }
 */
router.post('/find-all-contacts', async (req, res) => {
  const { spawn } = require('child_process');
  const path = require('path');

  try {
    const { limit = 5000 } = req.body;

    // Run the find-real-contacts script in "all" mode
    const scriptPath = path.join(__dirname, '../../scripts/find-real-contacts.js');
    const args = [scriptPath, 'all', limit.toString()];

    console.log(`[ContactFinder] Starting global scan for ${limit} companies`);

    const process = spawn('node', args, {
      cwd: path.join(__dirname, '../..'),
      env: { ...require('process').env }
    });

    process.stdout.on('data', (data) => {
      console.log(`[ContactFinder] ${data}`);
    });

    process.stderr.on('data', (data) => {
      console.error(`[ContactFinder Error] ${data}`);
    });

    res.json({
      success: true,
      message: `Finding real contacts for ${limit} companies globally`,
      status: 'started'
    });

  } catch (error) {
    console.error('Error starting global contact finder:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/enrichment/contact-stats
 * Get statistics about contacts in the database
 */
router.get('/contact-stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_contacts,
        COUNT(CASE WHEN verified = true THEN 1 END) as verified_contacts,
        COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN phone_number IS NOT NULL AND phone_number != '' THEN 1 END) as with_phone,
        COUNT(CASE WHEN linkedin_url IS NOT NULL THEN 1 END) as with_linkedin,
        COUNT(DISTINCT linked_account_id) as companies_with_contacts
      FROM contacts
    `);

    const companiesWithoutContacts = await pool.query(`
      SELECT COUNT(*) as count
      FROM accounts a
      WHERE NOT EXISTS (
        SELECT 1 FROM contacts c WHERE c.linked_account_id = a.account_id
      )
    `);

    const topSources = await pool.query(`
      SELECT data_source, COUNT(*) as count
      FROM contacts
      WHERE data_source IS NOT NULL
      GROUP BY data_source
      ORDER BY count DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        ...stats.rows[0],
        companies_without_contacts: parseInt(companiesWithoutContacts.rows[0].count),
        sources: topSources.rows
      }
    });
  } catch (error) {
    console.error('Error getting contact stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
