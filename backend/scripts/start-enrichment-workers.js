#!/usr/bin/env node

/**
 * Start Multiple Enrichment Workers
 * Spawns N worker processes to enrich companies in parallel
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const NUM_WORKERS = process.env.NUM_WORKERS ? parseInt(process.env.NUM_WORKERS) : 10;
const WORKER_SCRIPT = path.join(__dirname, 'enrichment-worker.js');
const PID_FILE = path.join(__dirname, '../enrichment-workers.pid');
const LOG_DIR = path.join(__dirname, '../logs');

const workers = [];
let shuttingDown = false;

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

console.log('════════════════════════════════════════════════════════════');
console.log('           ENRICHMENT WORKER MANAGER');
console.log('════════════════════════════════════════════════════════════');
console.log(`Starting ${NUM_WORKERS} parallel workers...`);
console.log(`Worker script: ${WORKER_SCRIPT}`);
console.log(`Logs directory: ${LOG_DIR}`);
console.log('════════════════════════════════════════════════════════════\n');

// Start a single worker
function startWorker(id) {
  const logFile = path.join(LOG_DIR, `worker-${id}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  
  console.log(`[Manager] Starting worker ${id}...`);
  
  const worker = spawn('node', [WORKER_SCRIPT], {
    env: { ...process.env, WORKER_ID: `worker-${id}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  worker.id = id;
  worker.logFile = logFile;
  worker.startTime = Date.now();
  
  // Pipe stdout/stderr to log file and console
  worker.stdout.on('data', (data) => {
    logStream.write(data);
    process.stdout.write(data);
  });
  
  worker.stderr.on('data', (data) => {
    logStream.write(data);
    process.stderr.write(data);
  });
  
  worker.on('exit', (code, signal) => {
    const runtime = Math.floor((Date.now() - worker.startTime) / 1000);
    
    if (signal) {
      console.log(`[Manager] Worker ${id} killed by signal ${signal} after ${runtime}s`);
    } else if (code !== 0) {
      console.log(`[Manager] Worker ${id} exited with code ${code} after ${runtime}s`);
    } else {
      console.log(`[Manager] Worker ${id} exited normally after ${runtime}s`);
    }
    
    logStream.end();
    
    // Remove from workers array
    const index = workers.findIndex(w => w.id === id);
    if (index !== -1) {
      workers.splice(index, 1);
    }
    
    // Restart worker if not shutting down
    if (!shuttingDown && code !== 0) {
      console.log(`[Manager] Restarting worker ${id} in 5 seconds...`);
      setTimeout(() => {
        if (!shuttingDown) {
          const newWorker = startWorker(id);
          workers.push(newWorker);
        }
      }, 5000);
    }
  });
  
  return worker;
}

// Start all workers
for (let i = 1; i <= NUM_WORKERS; i++) {
  const worker = startWorker(i);
  workers.push(worker);
}

// Save PIDs to file
const pids = workers.map(w => w.pid);
fs.writeFileSync(PID_FILE, JSON.stringify({
  managerPid: process.pid,
  workerPids: pids,
  startTime: new Date().toISOString(),
  numWorkers: NUM_WORKERS
}, null, 2));

console.log(`\n[Manager] All ${NUM_WORKERS} workers started`);
console.log(`[Manager] PIDs saved to ${PID_FILE}`);
console.log(`[Manager] Press Ctrl+C to stop all workers\n`);

// Graceful shutdown
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  
  console.log(`\n[Manager] Received ${signal}, shutting down all workers...`);
  
  // Send SIGTERM to all workers
  workers.forEach(worker => {
    console.log(`[Manager] Stopping worker ${worker.id} (PID ${worker.pid})...`);
    try {
      worker.kill('SIGTERM');
    } catch (error) {
      console.error(`[Manager] Error stopping worker ${worker.id}:`, error.message);
    }
  });
  
  // Wait for workers to exit (max 60 seconds)
  const timeout = setTimeout(() => {
    console.log('[Manager] Timeout waiting for workers, forcing shutdown...');
    workers.forEach(worker => {
      try {
        worker.kill('SIGKILL');
      } catch (error) {
        // Ignore errors
      }
    });
    cleanup();
  }, 60000);
  
  // Wait for all workers to exit
  const checkInterval = setInterval(() => {
    if (workers.length === 0) {
      clearTimeout(timeout);
      clearInterval(checkInterval);
      cleanup();
    }
  }, 500);
}

function cleanup() {
  // Remove PID file
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
    console.log('[Manager] PID file removed');
  }
  
  console.log('[Manager] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Keep process alive
process.stdin.resume();
