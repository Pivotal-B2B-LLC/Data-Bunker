/**
 * Background Enrichment Service
 * Continuously enriches companies in the background
 * Runs 24/7 to find website, email, phone, LinkedIn for all companies
 */

const { pool } = require('../db/connection');
const companyEnrichmentService = require('./companyEnrichmentService');

class BackgroundEnrichmentService {
  constructor() {
    this.isRunning = false;
    this.batchSize = 10; // Process 10 companies at a time
    this.delayBetweenBatches = 5000; // 5 seconds between batches
    this.intervalHandle = null;
    this.stats = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      startTime: null
    };
  }

  /**
   * Start continuous background enrichment
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  Background enrichment already running');
      return;
    }

    this.isRunning = true;
    this.stats.startTime = new Date();

    console.log('🚀 Starting Background Enrichment Service');
    console.log('═════════════════════════════════════════');
    console.log(`⚙️  Batch Size: ${this.batchSize} companies`);
    console.log(`⏱️  Delay: ${this.delayBetweenBatches}ms between batches`);
    console.log(`🔄 Mode: Continuous (runs forever)`);
    console.log('═════════════════════════════════════════\n');

    // Queue all companies that need enrichment
    await this.queueCompaniesNeedingEnrichment();

    // Start processing loop
    this.processLoop();
  }

  /**
   * Stop background enrichment
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️  Background enrichment not running');
      return;
    }

    this.isRunning = false;
    if (this.intervalHandle) {
      clearTimeout(this.intervalHandle);
      this.intervalHandle = null;
    }

    console.log('\n🛑 Background Enrichment Service Stopped');
    this.logStats();
  }

  /**
   * Main processing loop - runs continuously
   */
  async processLoop() {
    if (!this.isRunning) return;

    try {
      // Get next batch from queue
      const batch = await this.getNextBatch();

      if (batch.length === 0) {
        console.log('✅ Queue empty - checking for new companies...');
        await this.queueCompaniesNeedingEnrichment();
        
        // Wait longer if queue is empty
        this.intervalHandle = setTimeout(() => this.processLoop(), 30000);
        return;
      }

      console.log(`\n📦 Processing batch of ${batch.length} companies...`);

      // Process each company in batch
      for (const item of batch) {
        if (!this.isRunning) break;

        try {
          // Mark as processing
          await this.updateQueueStatus(item.queue_id, 'processing');

          // Enrich the company
          const result = await companyEnrichmentService.enrichCompany(item.company_id);

          if (result.success) {
            this.stats.successful++;
            await this.updateQueueStatus(item.queue_id, 'completed');
            console.log(`   ✅ ${item.company_name}: ${result.fieldsUpdated.length} fields updated`);
          } else {
            this.stats.failed++;
            await this.updateQueueStatus(item.queue_id, 'failed', result.error);
            console.log(`   ❌ ${item.company_name}: ${result.error}`);
          }

          this.stats.totalProcessed++;

          // Log progress every 100 companies
          if (this.stats.totalProcessed % 100 === 0) {
            this.logStats();
          }

        } catch (error) {
          console.error(`   ❌ Error processing ${item.company_name}:`, error.message);
          this.stats.failed++;
          await this.updateQueueStatus(item.queue_id, 'failed', error.message);
        }
      }

      // Schedule next batch
      this.intervalHandle = setTimeout(() => this.processLoop(), this.delayBetweenBatches);

    } catch (error) {
      console.error('❌ Error in processing loop:', error);
      // Retry after delay
      this.intervalHandle = setTimeout(() => this.processLoop(), 10000);
    }
  }

  /**
   * Queue companies that need enrichment
   */
  async queueCompaniesNeedingEnrichment() {
    const client = await pool.connect();

    try {
      // Get companies needing enrichment (not already in queue)
      const result = await client.query(`
        INSERT INTO enrichment_queue (company_id, priority)
        SELECT id, 0
        FROM companies_needing_enrichment
        WHERE id NOT IN (
          SELECT company_id FROM enrichment_queue 
          WHERE status = 'pending' OR status = 'processing'
        )
        LIMIT 10000
        ON CONFLICT (company_id, status) DO NOTHING
        RETURNING id;
      `);

      if (result.rowCount > 0) {
        console.log(`📥 Queued ${result.rowCount} companies for enrichment`);
      }

      return result.rowCount;
    } finally {
      client.release();
    }
  }

  /**
   * Get next batch of companies to process
   */
  async getNextBatch() {
    const client = await pool.connect();

    try {
      const result = await client.query(`
        SELECT 
          eq.id as queue_id,
          eq.company_id,
          c.name as company_name
        FROM enrichment_queue eq
        JOIN companies c ON eq.company_id = c.id
        WHERE eq.status = 'pending'
          AND eq.scheduled_for <= NOW()
          AND eq.attempts < eq.max_attempts
        ORDER BY eq.priority DESC, eq.created_at ASC
        LIMIT $1
      `, [this.batchSize]);

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Update queue item status
   */
  async updateQueueStatus(queueId, status, errorMessage = null) {
    const client = await pool.connect();

    try {
      if (status === 'processing') {
        await client.query(`
          UPDATE enrichment_queue 
          SET status = 'processing',
              started_at = NOW(),
              attempts = attempts + 1,
              updated_at = NOW()
          WHERE id = $1
        `, [queueId]);
      } else if (status === 'completed') {
        await client.query(`
          UPDATE enrichment_queue 
          SET status = 'completed',
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
        `, [queueId]);
      } else if (status === 'failed') {
        await client.query(`
          UPDATE enrichment_queue 
          SET status = CASE 
                WHEN attempts >= max_attempts THEN 'failed' 
                ELSE 'pending' 
              END,
              error_message = $2,
              scheduled_for = NOW() + INTERVAL '1 hour',
              updated_at = NOW()
          WHERE id = $1
        `, [queueId, errorMessage]);
      }
    } finally {
      client.release();
    }
  }

  /**
   * Get current statistics
   */
  async getStats() {
    const client = await pool.connect();

    try {
      const queueStats = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'processing') as processing,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM enrichment_queue
      `);

      const enrichmentStats = await client.query(`
        SELECT 
          COUNT(*) as total_companies,
          COUNT(*) FILTER (WHERE last_enriched IS NOT NULL) as enriched,
          COUNT(*) FILTER (WHERE website IS NOT NULL) as has_website,
          COUNT(*) FILTER (WHERE email IS NOT NULL) as has_email,
          COUNT(*) FILTER (WHERE phone IS NOT NULL) as has_phone,
          COUNT(*) FILTER (WHERE linkedin_url IS NOT NULL) as has_linkedin
        FROM companies
        WHERE status ILIKE '%active%'
      `);

      const runtime = this.stats.startTime 
        ? Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000)
        : 0;

      return {
        runtime: runtime,
        processed: this.stats.totalProcessed,
        successful: this.stats.successful,
        failed: this.stats.failed,
        rate: runtime > 0 ? Math.round(this.stats.totalProcessed / runtime * 60) : 0,
        queue: queueStats.rows[0],
        enrichment: enrichmentStats.rows[0]
      };
    } finally {
      client.release();
    }
  }

  /**
   * Log statistics
   */
  logStats() {
    const runtime = Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000);
    const rate = runtime > 0 ? Math.round(this.stats.totalProcessed / runtime * 60) : 0;

    console.log('\n📊 Background Enrichment Statistics');
    console.log('═════════════════════════════════════════');
    console.log(`⏱️  Runtime: ${Math.floor(runtime / 3600)}h ${Math.floor((runtime % 3600) / 60)}m`);
    console.log(`📈 Processed: ${this.stats.totalProcessed}`);
    console.log(`✅ Successful: ${this.stats.successful}`);
    console.log(`❌ Failed: ${this.stats.failed}`);
    console.log(`⚡ Rate: ~${rate} companies/hour`);
    console.log('═════════════════════════════════════════\n');
  }
}

module.exports = new BackgroundEnrichmentService();
