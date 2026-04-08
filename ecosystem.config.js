/**
 * PM2 Ecosystem Config — Data-Bunker
 *
 * Manages 2 long-running processes:
 *   1. databunker-api        — Express REST API (port 5000)
 *   2. databunker-enrichment — Master controller that runs ALL 8 parallel systems:
 *        • WEBSITE-FINDER      finds websites for companies without one
 *        • COMPANY-DISCOVERY   discovers new companies (Yell, DDG, Google Places)
 *        • CONTACT-FINDER      scrapes team/about pages for management contacts
 *        • SEARCH-CONTACTS     searches web/LinkedIn with CEO/Director/Manager patterns
 *        • EMAIL-FINDER        verifies & finds contact emails
 *        • PHONE-FINDER        finds company phone numbers
 *        • DATA-QUALITY        quality scoring & validation
 *        • AREA-DISCOVERY      works through discovery_queue area-by-area (every city/town/village)
 *
 * Quick start:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup       ← survives reboots
 *
 * Useful commands:
 *   pm2 monit                     ← live monitor
 *   pm2 logs                      ← all logs
 *   pm2 logs databunker-enrichment ← enrichment + discovery logs
 *   pm2 stop all / pm2 restart all
 *
 * NOTE on DB connections (Neon free tier = max 10 connections):
 *   Set DB_POOL_SIZE=2 in your .env so each of the many agents
 *   uses a small pool. Total = ~16 agents × 2 = 32 if uncapped,
 *   so keep DB_POOL_SIZE=1 or 2 on the free tier.
 */

module.exports = {
  apps: [
    // ── API Server ──────────────────────────────────────────────────────────
    {
      name: 'databunker-api',
      script: 'server.js',
      cwd: './backend',
      watch: false,
      restart_delay: 3000,
      max_restarts: 0,        // unlimited
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
    },

    // ── Master Enrichment Controller (all 8 systems in one process) ─────────
    {
      name: 'databunker-enrichment',
      script: 'scripts/agents/master-turbo.js',
      cwd: './backend',
      watch: false,
      restart_delay: 5000,
      max_restarts: 0,        // unlimited
      autorestart: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
