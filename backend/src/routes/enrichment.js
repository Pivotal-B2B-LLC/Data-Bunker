/**
 * Company Enrichment Routes
 * 
 * API endpoints for:
 * - Triggering enrichment for specific companies
 * - Batch enrichment
 * - Viewing enrichment status and statistics
 * - Generating reports
 */

const express = require('express');
const router = express.Router();
const simpleEnrichmentService = require('../services/simpleEnrichmentService');

/**
 * GET /api/enrichment/stats
 * Get enrichment statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await simpleEnrichmentService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting enrichment stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/enrichment/report
 * Generate comprehensive enrichment report
 */
router.get('/report', async (req, res) => {
  try {
    const stats = await simpleEnrichmentService.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/enrich/:companyId
 * Enrich a specific company
 */
router.post('/enrich/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const result = await simpleEnrichmentService.enrichCompany(companyId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Error enriching company:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/batch
 * Enrich a batch of companies
 * Body: { limit: number } (optional, default 10)
 */
router.post('/batch', async (req, res) => {
  try {
    const { limit } = req.body;
    const result = await simpleEnrichmentService.enrichBatch(limit || 10);
    res.json(result);
  } catch (error) {
    console.error('Error in batch enrichment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/queue
 * Queue specific companies for enrichment
 * Body: { companyIds: string[], priority: number }
 */
router.post('/queue', async (req, res) => {
  try {
    const { companyIds, priority = 0 } = req.body;
    
    if (!companyIds || !Array.isArray(companyIds) || companyIds.length === 0) {
      return res.status(400).json({ error: 'companyIds array is required' });
    }

    const result = await companyEnrichmentService.queueCompaniesForEnrichment(companyIds, priority);
    res.json(result);
  } catch (error) {
    console.error('Error queuing companies:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/queue/process
 * Process companies in the enrichment queue
 * Body: { limit: number } (optional, default 10)
 */
router.post('/queue/process', async (req, res) => {
  try {
    const { limit } = req.body;
    const result = await companyEnrichmentService.processQueue(limit);
    res.json(result);
  } catch (error) {
    console.error('Error processing queue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/enrichment/queue/status
 * Get enrichment queue status
 */
router.get('/queue/status', async (req, res) => {
  try {
    const client = await pool.connect();
    
    const result = await client.query(`
      SELECT 
        status,
        COUNT(*) as count,
        AVG(attempts) as avg_attempts
      FROM enrichment_queue
      GROUP BY status
    `);

    const pending = await client.query(`
      SELECT COUNT(*) as count
      FROM enrichment_queue
      WHERE status = 'pending' AND scheduled_for <= CURRENT_TIMESTAMP
    `);

    client.release();

    res.json({
      byStatus: result.rows,
      readyToProcess: parseInt(pending.rows[0].count)
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/enrichment/history/:companyId
 * Get enrichment history for a specific company
 */
router.get('/history/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const client = await pool.connect();
    
    const result = await client.query(`
      SELECT 
        enrichment_date,
        status,
        fields_updated,
        data_sources,
        website_found,
        phone_found,
        email_found,
        linkedin_found,
        twitter_found,
        facebook_found,
        industry_found,
        error_message,
        processing_time_ms
      FROM enrichment_logs
      WHERE company_id = $1
      ORDER BY enrichment_date DESC
      LIMIT 20
    `, [companyId]);

    client.release();

    res.json({
      companyId,
      history: result.rows
    });
  } catch (error) {
    console.error('Error getting enrichment history:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/enrichment/recent
 * Get recent enrichment activity
 */
router.get('/recent', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const client = await pool.connect();
    
    const result = await client.query(`
      SELECT 
        el.enrichment_date,
        el.status,
        el.fields_updated,
        el.processing_time_ms,
        c.name as company_name,
        c.company_number
      FROM enrichment_logs el
      JOIN companies c ON c.id = el.company_id
      ORDER BY el.enrichment_date DESC
      LIMIT $1
    `, [limit]);

    client.release();

    res.json({
      recent: result.rows
    });
  } catch (error) {
    console.error('Error getting recent enrichment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/enrichment/pending
 * Get companies pending enrichment
 */
router.get('/pending', async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const client = await pool.connect();
    
    const result = await client.query(`
      SELECT 
        id,
        company_number,
        name,
        locality,
        region,
        country,
        last_enriched,
        enrichment_status,
        enrichment_attempts,
        enrichment_priority
      FROM companies_needing_enrichment
      LIMIT $1
    `, [limit]);

    client.release();

    res.json({
      pending: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error getting pending companies:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/enrichment/queue-all-pending
 * Queue all companies needing enrichment
 */
router.post('/queue-all-pending', async (req, res) => {
  try {
    const { limit = 1000, priority = 0 } = req.body;
    const client = await pool.connect();
    
    // Get companies needing enrichment
    const companies = await client.query(`
      SELECT id
      FROM companies_needing_enrichment
      LIMIT $1
    `, [limit]);

    client.release();

    if (companies.rows.length === 0) {
      return res.json({ 
        message: 'No companies need enrichment',
        queued: 0 
      });
    }

    const companyIds = companies.rows.map(c => c.id);
    const result = await companyEnrichmentService.queueCompaniesForEnrichment(companyIds, priority);
    
    res.json({
      message: `Queued ${result.queued} companies for enrichment`,
      ...result
    });
  } catch (error) {
    console.error('Error queuing all pending:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
