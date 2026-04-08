#!/usr/bin/env node

/**
 * Stop All Enrichment Workers
 * Gracefully stops all running enrichment workers
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const PID_FILE = path.join(__dirname, '../enrichment-workers.pid');

async function stopWorkers() {
  console.log('════════════════════════════════════════════════════════════');
  console.log('           STOP ENRICHMENT WORKERS');
  console.log('════════════════════════════════════════════════════════════\n');
  
  // Check if PID file exists
  if (!fs.existsSync(PID_FILE)) {
    console.log('✗ No PID file found. Workers may not be running.');
    console.log(`  Expected file: ${PID_FILE}\n`);
    return;
  }
  
  // Read PID file
  let pidData;
  try {
    pidData = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
  } catch (error) {
    console.error('✗ Error reading PID file:', error.message);
    return;
  }
  
  console.log(`Found ${pidData.numWorkers} workers started at ${pidData.startTime}`);
  console.log(`Manager PID: ${pidData.managerPid}`);
  console.log(`Worker PIDs: ${pidData.workerPids.join(', ')}\n`);
  
  // Stop manager process (this will stop all workers)
  console.log('Stopping manager process...');
  try {
    process.kill(pidData.managerPid, 'SIGTERM');
    console.log(`✓ Sent SIGTERM to manager (PID ${pidData.managerPid})`);
  } catch (error) {
    if (error.code === 'ESRCH') {
      console.log(`✗ Manager process (PID ${pidData.managerPid}) not found`);
    } else {
      console.error(`✗ Error stopping manager:`, error.message);
    }
  }
  
  // Wait a moment for graceful shutdown
  console.log('\nWaiting for graceful shutdown (max 60s)...');
  
  let attempts = 0;
  const maxAttempts = 60;
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
    
    // Check if manager still exists
    try {
      process.kill(pidData.managerPid, 0); // Check if process exists
      process.stdout.write(`\r  ${attempts}s... Manager still running`);
    } catch (error) {
      if (error.code === 'ESRCH') {
        console.log(`\n\n✓ Manager stopped after ${attempts}s`);
        break;
      }
    }
  }
  
  if (attempts >= maxAttempts) {
    console.log('\n\n✗ Timeout waiting for graceful shutdown, forcing kill...');
    
    // Force kill manager
    try {
      process.kill(pidData.managerPid, 'SIGKILL');
      console.log(`✓ Sent SIGKILL to manager (PID ${pidData.managerPid})`);
    } catch (error) {
      if (error.code !== 'ESRCH') {
        console.error(`✗ Error force-killing manager:`, error.message);
      }
    }
    
    // Force kill all workers
    for (const pid of pidData.workerPids) {
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`✓ Sent SIGKILL to worker (PID ${pid})`);
      } catch (error) {
        if (error.code !== 'ESRCH') {
          console.error(`✗ Error force-killing worker ${pid}:`, error.message);
        }
      }
    }
  }
  
  // Remove PID file
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
    console.log('\n✓ PID file removed');
  }
  
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('All workers stopped');
  console.log('════════════════════════════════════════════════════════════\n');
}

stopWorkers().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
