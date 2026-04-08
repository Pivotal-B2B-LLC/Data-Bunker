#!/usr/bin/env node

/**
 * AUTO-DISCOVER ALL
 *
 * Continuously pulls the next pending location from discovery_queue,
 * checks completed_areas for deduplication, runs discover-fast.js,
 * and marks the result. Crash-safe — on restart all stale in_progress
 * rows are reset to pending and processing resumes automatically.
 *
 * Usage:
 *   node auto-discover-all.js                     (1 worker, all countries)
 *   node auto-discover-all.js --workers=3          (3 parallel workers)
 *   node auto-discover-all.js --country=US         (USA only)
 *   node auto-discover-all.js --workers=2 --country=GB
 *
 * NOTE on Neon free tier:
 *   Neon free tier has max 10 concurrent DB connections.
 *   Each spawned discover-fast.js subprocess opens its own pool.
 *   Use --workers=1 and set DB_POOL_SIZE=3 in your .env for safety.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { spawn } = require('child_process');
const path = require('path');
const { pool } = require('../src/db/connection');

// ── Parse CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const WORKERS = parseInt(
  (args.find(a => a.startsWith('--workers=')) || '--workers=1').split('=')[1]
) || 1;
const COUNTRY_FILTER = (args.find(a => a.startsWith('--country=')) || '').split('=')[1] || null;

const POLL_INTERVAL_MS   = 10 * 60 * 1000; // 10 min — how long to wait when queue is empty
const DISCOVERY_TIMEOUT  = 20 * 60 * 1000; // 20 min max per location before kill
const SCRIPT_PATH        = path.join(__dirname, 'discover-fast.js');

// ── Shared live status — read by discovery.js API endpoints ──────────────
const autoStatus = {
  running: false,
  workers: WORKERS,
  totalProcessed: 0,
  totalCompaniesFound: 0,
  startedAt: null,
  currentLocations: [],  // index = worker id
};
module.exports = { autoStatus };

function log(workerId, msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [Worker ${workerId}] ${msg}`);
}

// ── Claim next pending location atomically ────────────────────────────────
async function claimNext(workerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const countryClause = COUNTRY_FILTER
      ? `AND country_code = '${COUNTRY_FILTER.replace(/'/g, "''")}'`
      : '';

    const result = await client.query(`
      SELECT *
      FROM discovery_queue
      WHERE status = 'pending'
      ${countryClause}
      ORDER BY priority ASC, population DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const loc = result.rows[0];
    await client.query(
      `UPDATE discovery_queue SET status = 'in_progress', started_at = NOW() WHERE queue_id = $1`,
      [loc.queue_id]
    );
    await client.query('COMMIT');
    return loc;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Check completed_areas deduplication ──────────────────────────────────
async function isAlreadyCompleted(loc) {
  try {
    const result = await pool.query(
      `SELECT 1 FROM completed_areas
       WHERE LOWER(city)         = LOWER($1)
       AND   LOWER(state_region) = LOWER($2)
       AND   LOWER(country)      = LOWER($3)
       AND   status = 'completed'
       LIMIT 1`,
      [loc.city, loc.state_region, loc.country]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

// ── Status helpers ────────────────────────────────────────────────────────
async function markSkipped(queueId) {
  await pool.query(
    `UPDATE discovery_queue SET status = 'skipped', completed_at = NOW() WHERE queue_id = $1`,
    [queueId]
  );
}

async function markCompleted(queueId, companiesFound) {
  await pool.query(
    `UPDATE discovery_queue
     SET status = 'completed', completed_at = NOW(), companies_found = $2
     WHERE queue_id = $1`,
    [queueId, companiesFound]
  );
}

async function markFailed(queueId, errorMsg) {
  await pool.query(
    `UPDATE discovery_queue
     SET status = 'failed', completed_at = NOW(), error_message = $2
     WHERE queue_id = $1`,
    [queueId, (errorMsg || '').substring(0, 500)]
  );
}

// ── Spawn discover-fast.js for one location ───────────────────────────────
// discover-fast.js argv: city, state_region, country, [district]
// Argument order confirmed at discover-fast.js lines 1092-1094.
function runDiscovery(loc) {
  return new Promise((resolve) => {
    const proc = spawn('node', [
      SCRIPT_PATH,
      loc.city,
      loc.state_region,
      loc.country,
    ], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env },
      stdio: 'pipe'
    });

    let companiesSaved = 0;
    let outputBuffer = '';

    proc.stdout.on('data', (data) => {
      outputBuffer += data.toString();
      // Parse the same patterns used by discovery.js route
      const match = outputBuffer.match(/Companies Saved:\s*(\d+)/i);
      if (match) companiesSaved = parseInt(match[1]);
    });

    proc.stderr.on('data', () => {}); // suppress stderr noise

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ success: false, companiesSaved, timedOut: true });
    }, DISCOVERY_TIMEOUT);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, companiesSaved, timedOut: false });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, companiesSaved: 0, error: err.message });
    });
  });
}

// ── Single worker loop ────────────────────────────────────────────────────
async function workerLoop(workerId) {
  log(workerId, 'Started');
  autoStatus.currentLocations[workerId] = null;

  while (autoStatus.running) {
    try {
      const loc = await claimNext(workerId);

      if (!loc) {
        log(workerId, `Queue empty. Waiting ${POLL_INTERVAL_MS / 60000} min...`);
        autoStatus.currentLocations[workerId] = null;
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      // Deduplication check against completed_areas
      const alreadyDone = await isAlreadyCompleted(loc);
      if (alreadyDone) {
        log(workerId, `Skipping (already in completed_areas): ${loc.city}, ${loc.state_region}`);
        await markSkipped(loc.queue_id);
        continue;
      }

      const locationLabel = `${loc.city}, ${loc.state_region}, ${loc.country}`;
      autoStatus.currentLocations[workerId] = locationLabel;
      log(workerId, `Discovering: ${locationLabel} [${loc.place_type}, priority ${loc.priority}]`);

      const result = await runDiscovery(loc);

      if (result.success || result.companiesSaved > 0) {
        await markCompleted(loc.queue_id, result.companiesSaved);
        autoStatus.totalCompaniesFound += result.companiesSaved;
        log(workerId, `Done: ${loc.city} — ${result.companiesSaved} companies`);
      } else if (result.timedOut) {
        await markFailed(loc.queue_id, 'Timed out after 20 minutes');
        log(workerId, `Timeout: ${loc.city}`);
      } else {
        await markFailed(loc.queue_id, result.error || 'Process exited non-zero');
        log(workerId, `Failed: ${loc.city} — ${result.error || 'unknown error'}`);
      }

      autoStatus.totalProcessed++;
      autoStatus.currentLocations[workerId] = null;

    } catch (e) {
      log(workerId, `Error: ${e.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  log(workerId, 'Stopped');
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(65));
  console.log('   AUTO-DISCOVER ALL');
  console.log('='.repeat(65));
  console.log(`   Workers: ${WORKERS}`);
  if (COUNTRY_FILTER) console.log(`   Country filter: ${COUNTRY_FILTER}`);
  console.log('   Press Ctrl+C to stop gracefully\n');

  // Reset stale in_progress rows from a previous crash → back to pending
  const stale = await pool.query(
    `UPDATE discovery_queue SET status = 'pending', started_at = NULL WHERE status = 'in_progress'`
  );
  if (stale.rowCount > 0) {
    console.log(`Reset ${stale.rowCount} stale in_progress rows back to pending\n`);
  }

  // Print queue summary
  const summary = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
      COUNT(*) FILTER (WHERE status = 'skipped')   AS skipped,
      COUNT(*)                                     AS total
    FROM discovery_queue
    ${COUNTRY_FILTER ? `WHERE country_code = '${COUNTRY_FILTER.replace(/'/g, "''")}'` : ''}
  `);
  const s = summary.rows[0];
  console.log(`Queue: ${s.pending} pending | ${s.completed} completed | ${s.failed} failed | ${s.total} total\n`);

  if (parseInt(s.pending) === 0) {
    console.log('Queue is empty — workers will poll every 10 min until locations are added.');
    console.log('Tip: run  node populate-discovery-queue.js ALL  to fill the queue.\n');
    // Do NOT exit — PM2 would spin-restart. Workers handle the wait internally.
  }

  autoStatus.running = true;
  autoStatus.startedAt = new Date().toISOString();

  // Launch N parallel worker loops
  const workerPromises = [];
  for (let i = 0; i < WORKERS; i++) {
    workerPromises.push(workerLoop(i));
  }

  // Progress dashboard every 5 minutes
  const dashboardInterval = setInterval(async () => {
    try {
      const stats = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
          COUNT(*)                                     AS total
        FROM discovery_queue
        ${COUNTRY_FILTER ? `WHERE country_code = '${COUNTRY_FILTER.replace(/'/g, "''")}'` : ''}
      `);
      const r = stats.rows[0];
      const pct = r.total > 0 ? ((parseInt(r.completed) + parseInt(r.failed)) / parseInt(r.total) * 100).toFixed(1) : 0;
      const active = autoStatus.currentLocations.filter(Boolean).join(' | ') || 'idle';
      console.log(`\n[Dashboard] ${pct}% done | ${r.completed} completed | ${r.pending} pending | ${r.failed} failed`);
      console.log(`[Dashboard] Active: ${active}`);
      console.log(`[Dashboard] Session: ${autoStatus.totalProcessed} processed | ${autoStatus.totalCompaniesFound.toLocaleString()} companies found\n`);
    } catch {}
  }, 5 * 60 * 1000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down gracefully...');
    autoStatus.running = false;
    clearInterval(dashboardInterval);
    await Promise.all(workerPromises);
    console.log(`\nSession summary: ${autoStatus.totalProcessed} locations processed | ${autoStatus.totalCompaniesFound.toLocaleString()} companies found`);
    await pool.end();
    process.exit(0);
  });

  await Promise.all(workerPromises);
  clearInterval(dashboardInterval);
  await pool.end();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
