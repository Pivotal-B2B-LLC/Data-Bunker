#!/usr/bin/env node

/**
 * PARALLEL CONTACT FINDER LAUNCHER
 * Launches multiple contact finder processes in parallel
 * Usage: node launch-parallel-finders.js [number_of_processes]
 */

const { spawn } = require('child_process');
const path = require('path');

const numProcesses = parseInt(process.argv[2]) || 10;

console.log('\n' + '='.repeat(70));
console.log(`   LAUNCHING ${numProcesses} PARALLEL CONTACT FINDERS`);
console.log('='.repeat(70));
console.log('');

const processes = [];

for (let i = 1; i <= numProcesses; i++) {
  const scriptPath = path.join(__dirname, 'find-real-contacts.js');

  const proc = spawn('node', [scriptPath, 'all', '100'], {
    cwd: path.join(__dirname, '..'),
    detached: true,
    stdio: 'ignore'
  });

  proc.unref();

  processes.push(proc);
  console.log(`   ✓ Process ${i}/${numProcesses} launched (PID: ${proc.pid})`);

  // Small delay between launches to prevent database connection issues
  if (i < numProcesses) {
    const delay = 2000; // 2 seconds
    const startTime = Date.now();
    while (Date.now() - startTime < delay) {
      // Busy wait
    }
  }
}

console.log('');
console.log(`   All ${numProcesses} processes launched successfully!`);
console.log('');
console.log('   To monitor progress:');
console.log('   cd backend && node scripts/check-progress.js');
console.log('');
console.log('   To estimate completion time:');
console.log('   cd backend && node scripts/estimate-completion-time.js');
console.log('');
console.log('='.repeat(70));
console.log('');

process.exit(0);
