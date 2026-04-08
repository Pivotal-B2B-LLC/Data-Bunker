#!/usr/bin/env node

/**
 * Background Enrichment Daemon
 * Runs continuously to enrich all companies
 */

const backgroundEnrichmentService = require('./src/services/backgroundEnrichmentService');

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║   Background Company Enrichment Service               ║');
console.log('║   Continuously finds info for all companies           ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Received SIGINT - Shutting down gracefully...');
  backgroundEnrichmentService.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n🛑 Received SIGTERM - Shutting down gracefully...');
  backgroundEnrichmentService.stop();
  process.exit(0);
});

// Start the service
(async () => {
  try {
    await backgroundEnrichmentService.start();
  } catch (error) {
    console.error('❌ Failed to start enrichment service:', error);
    process.exit(1);
  }
})();
