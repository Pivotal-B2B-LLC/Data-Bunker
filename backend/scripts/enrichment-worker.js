#!/usr/bin/env node

/**
 * Enrichment Worker - Background process for enriching companies
 * Multiple workers can run in parallel to speed up enrichment
 */

const { pool } = require('../src/db/connection');
const simpleEnrichmentService = require('../src/services/simpleEnrichmentService');

const WORKER_ID = `worker-${process.pid}`;
const POLL_INTERVAL = 2000; // Poll every 2 seconds
const BATCH_SIZE = 1; // Process 1 job at a time per worker
const SHUTDOWN_GRACE_PERIOD = 30000; // 30 seconds to finish current job

let isShuttingDown = false;
let currentJob = null;
let processedCount = 0;
let successCount = 0;
let failureCount = 0;
let startTime = Date.now();

console.log(`[${WORKER_ID}] Starting enrichment worker...`);

// Graceful shutdown handlers
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

async function handleShutdown(signal) {
  if (isShuttingDown) return;
  
  isShuttingDown = true;
  console.log(`\n[${WORKER_ID}] Received ${signal}, shutting down gracefully...`);
  
  if (currentJob) {
    console.log(`[${WORKER_ID}] Waiting for current job to complete (max ${SHUTDOWN_GRACE_PERIOD/1000}s)...`);
    
    // Wait for current job or timeout
    const timeout = setTimeout(() => {
      console.log(`[${WORKER_ID}] Shutdown timeout reached, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_GRACE_PERIOD);
    
    // Wait for job completion
    while (currentJob) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    clearTimeout(timeout);
  }
  
  await printStats();
  await pool.end();
  console.log(`[${WORKER_ID}] Shutdown complete`);
  process.exit(0);
}

async function printStats() {
  const runtime = Math.floor((Date.now() - startTime) / 1000);
  const rate = runtime > 0 ? (processedCount / runtime * 60).toFixed(1) : 0;
  
  console.log(`\n[${WORKER_ID}] ═══════════════════════════════════════`);
  console.log(`[${WORKER_ID}] Statistics:`);
  console.log(`[${WORKER_ID}]   Runtime: ${runtime}s`);
  console.log(`[${WORKER_ID}]   Processed: ${processedCount} jobs`);
  console.log(`[${WORKER_ID}]   Success: ${successCount}`);
  console.log(`[${WORKER_ID}]   Failed: ${failureCount}`);
  console.log(`[${WORKER_ID}]   Rate: ${rate} jobs/min`);
  console.log(`[${WORKER_ID}] ═══════════════════════════════════════\n`);
}

async function claimJob() {
  const client = await pool.connect();
  
  try {
    // Use advisory lock to prevent race conditions between workers
    await client.query('BEGIN');
    
    const result = await client.query(`
      UPDATE enrichment_queue
      SET status = 'processing',
          started_at = CURRENT_TIMESTAMP,
          worker_id = $1,
          attempts = attempts + 1
      WHERE id = (
        SELECT id FROM enrichment_queue
        WHERE status = 'pending'
          AND attempts < max_attempts
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, company_id, attempts
    `, [WORKER_ID]);
    
    await client.query('COMMIT');
    
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[${WORKER_ID}] Error claiming job:`, error.message);
    return null;
  } finally {
    client.release();
  }
}

async function processJob(job) {
  currentJob = job;
  const startTime = Date.now();
  
  try {
    console.log(`[${WORKER_ID}] Processing job ${job.id} (company ${job.company_id}, attempt ${job.attempts})...`);
    
    // Enrich the company
    const result = await simpleEnrichmentService.enrichCompany(job.company_id);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (result.success) {
      // Mark as completed
      await pool.query(`
        UPDATE enrichment_queue
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP,
            error_message = NULL
        WHERE id = $1
      `, [job.id]);
      
      successCount++;
      console.log(`[${WORKER_ID}] ✓ Job ${job.id} completed in ${duration}s - Updated: ${result.fieldsUpdated.join(', ') || 'none'}`);
      
      if (result.verificationScore > 0) {
        console.log(`[${WORKER_ID}]   Website: ${result.updates.website} (confidence: ${result.verificationScore})`);
      }
    } else {
      throw new Error(result.error || 'Enrichment failed');
    }
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Check if max attempts reached
    const shouldRetry = job.attempts < job.max_attempts;
    const newStatus = shouldRetry ? 'pending' : 'failed';
    
    await pool.query(`
      UPDATE enrichment_queue
      SET status = $1,
          error_message = $2,
          completed_at = CASE WHEN $1 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = $3
    `, [newStatus, error.message, job.id]);
    
    failureCount++;
    console.log(`[${WORKER_ID}] ✗ Job ${job.id} failed in ${duration}s: ${error.message}`);
    
    if (shouldRetry) {
      console.log(`[${WORKER_ID}]   Will retry (attempt ${job.attempts}/${job.max_attempts})`);
    } else {
      console.log(`[${WORKER_ID}]   Max attempts reached, marking as failed`);
    }
  } finally {
    currentJob = null;
    processedCount++;
  }
}

async function workerLoop() {
  console.log(`[${WORKER_ID}] Worker loop started, polling every ${POLL_INTERVAL}ms`);
  
  while (!isShuttingDown) {
    try {
      // Claim a job
      const job = await claimJob();
      
      if (job) {
        await processJob(job);
      } else {
        // No jobs available, wait before polling again
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }
      
      // Print stats every 10 jobs
      if (processedCount % 10 === 0 && processedCount > 0) {
        await printStats();
      }
      
    } catch (error) {
      console.error(`[${WORKER_ID}] Worker loop error:`, error.message);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 2));
    }
  }
}

// Start the worker
workerLoop().catch(error => {
  console.error(`[${WORKER_ID}] Fatal error:`, error);
  process.exit(1);
});
