/**
 * Data Bunker Backend Server
 * Global Company Search API
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

// Load environment variables (use __dirname so it works regardless of CWD)
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting — generous limits so the AI page and dashboard polling work
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 900000), // 15 min window
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || 2000),     // 2000 per window
  message: 'Too many requests, please try again later.',
  skip: (req) => req.path.startsWith('/api/llm') || req.path.startsWith('/api/scraper'),
});
app.use('/api/', limiter);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Root endpoint - API documentation
app.get('/', (req, res) => {
  res.json({
    name: 'Data Bunker Backend API',
    version: '2.0.0',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    endpoints: {
      health: '/health',
      search: '/api/search',
      companies: '/api/companies',
      ukCompanies: {
        search: '/api/companies/uk/search',
        get: '/api/companies/uk/:companyNumber',
        stats: '/api/companies/uk/stats'
      },
      usaCompanies: {
        search: '/api/companies/usa/search',
        get: '/api/companies/usa/:jurisdiction/:companyNumber',
        status: '/api/companies/usa/status'
      },
      smartSearch: {
        search: '/api/smart/search',
        info: '/api/smart/info'
      },
      locations: '/api/locations',
      filter: '/api/filter',
      assistant: '/api/assistant',
      officers: '/api/officers',
      database: {
        search: '/api/db/search',
        companies: '/api/db/companies',
        discover: '/api/db/discover',
        tracking: '/api/db/tracking',
        analytics: '/api/db/analytics'
      },
      bulkImport: {
        start: '/api/bulk-import/start',
        stop: '/api/bulk-import/stop',
        status: '/api/bulk-import/status'
      },
      enrichment: {
        enrich: '/api/enrichment/enrich/:id',
        batch: '/api/enrichment/batch'
      },
      deduplication: {
        find: '/api/deduplication/find',
        preview: '/api/deduplication/preview/:primaryId/:duplicateId',
        merge: '/api/deduplication/merge',
        autoMerge: '/api/deduplication/auto-merge'
      },
      emailIntelligence: {
        stats: '/api/email-intelligence/stats',
        verify: '/api/email-intelligence/verify',
        analyzeCompany: '/api/email-intelligence/company/:accountId/analyze',
        findForContact: '/api/email-intelligence/contact/:contactId/find',
        findForPerson: '/api/email-intelligence/find',
        backfill: '/api/email-intelligence/backfill'
      }
    },
    documentation: '/api/docs'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/search', require('./src/routes/search'));
app.use('/api/companies', require('./src/routes/companies'));

// Dual-Source Routes: UK Database + USA API
app.use('/api/companies/uk', require('./src/routes/uk-companies'));
app.use('/api/companies/usa', require('./src/routes/usa-companies'));
app.use('/api/smart', require('./src/routes/smart-search'));

app.use('/api/locations', require('./src/routes/locations'));
app.use('/api/filter', require('./src/routes/filter'));
app.use('/api/db', require('./src/routes/database'));
app.use('/api/bulk-import', require('./src/routes/bulkImport'));
app.use('/api/csv-import', require('./src/routes/bulkCSVImport'));
app.use('/api/officers', require('./src/routes/officers'));
app.use('/api/enrichment', require('./src/routes/enrichment-simple')); // Use queue-based enrichment
app.use('/api/deduplication', require('./src/routes/deduplication'));
app.use('/api/discovery', require('./src/routes/discovery')); // Company discovery

// New Accounts & Contacts Routes
app.use('/api/accounts', require('./src/routes/accounts'));
app.use('/api/contacts', require('./src/routes/contacts'));
app.use('/api/dashboard', require('./src/routes/dashboard')); // Geographic dashboard
app.use('/api/analytics', require('./src/routes/analytics')); // Analytics endpoints
app.use('/api/export', require('./src/routes/export')); // CSV/JSON export
app.use('/api/enriched', require('./src/routes/enriched')); // Enriched data view
app.use('/api/llm',     require('./src/routes/llm'));     // Local Llama 3.2 AI endpoint
app.use('/api/email-intelligence', require('./src/routes/email-intelligence')); // Hunter-style email intelligence
app.use('/api/scraper', require('./src/routes/scraper')); // Browser extension scraper endpoint
app.use('/api/agents',  require('./src/routes/agents'));  // Army — agent control panel
app.use('/api/gemini',  require('./src/routes/gemini-enrichment')); // Gemini AI company enrichment
app.use('/api/openrouter', require('./src/routes/openrouter-enrichment')); // OpenRouter multi-model enrichment
app.use('/api/deep-enrich', require('./src/routes/deep-enrich')); // Deep research & correction
app.use('/api/orchestrator', require('./src/routes/orchestrator')); // Master orchestrator — all agents unified

// Extension download endpoint
app.get('/api/extension/download', (req, res) => {
  const { exec } = require('child_process');
  const os = require('os');
  const fs = require('fs');
  const extensionDir = path.join(__dirname, '..', 'extension');
  const outputPath = path.join(os.tmpdir(), 'data-bunker-extension.zip');

  // Remove stale zip if it exists
  if (fs.existsSync(outputPath)) {
    try { fs.unlinkSync(outputPath); } catch (_) {}
  }

  exec(
    `zip -r "${outputPath}" . -x "*.DS_Store"`,
    { cwd: extensionDir },
    (err) => {
      if (err) {
        console.error('Extension zip error:', err);
        return res.status(500).json({ error: 'Failed to create extension zip' });
      }
      res.download(outputPath, 'data-bunker-extension.zip', (dlErr) => {
        if (dlErr) console.error('Extension download error:', dlErr);
        try { fs.unlinkSync(outputPath); } catch (_) {}
      });
    }
  );
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// Initialize database connection and tracking service
const db = require('./src/db/database');
const webTrackingService = require('./src/services/webTrackingService');
const bulkImportService = require('./src/services/bulkImportService');
const companyEnrichmentService = require('./src/services/companyEnrichmentService');
const ollama = require('./src/services/ollamaService');

// Start server
app.listen(PORT, async () => {
  console.log(`
╔════════════════════════════════════════╗
║     Data Bunker Backend Server         ║
╠════════════════════════════════════════╣
║ 🚀 Server running on http://localhost:${PORT}
║ 📊 Environment: ${process.env.NODE_ENV || 'development'}
║ 🔑 Companies House API: ${process.env.COMPANIES_HOUSE_API_KEY ? '✓' : '✗'}
║ 🗄️  Database: ${process.env.POSTGRES_DB || 'Not configured'}
╚════════════════════════════════════════╝
  `);

  // Check LLM availability
  try {
    const llmAvailable = await ollama.isAvailable();
    if (llmAvailable) {
      console.log(`✅ Llama 3.2 1B ready via Ollama (model: ${ollama.model})`);
    } else {
      console.warn('⚠️  Ollama not running — start it with: ollama serve');
    }
  } catch {
    console.warn('⚠️  Could not connect to Ollama');
  }

  // Test database connection
  try {
    await db.query('SELECT NOW()');
    console.log('✅ Database connected successfully');
  } catch (error) {
    console.warn('⚠️  Database connection failed:', error.message);
    console.warn('   Run: cd backend && ./scripts/init-db.sh');
    return;
  }

  // Auto-start bulk import if enabled
  if (process.env.AUTO_START_BULK_IMPORT === 'true') {
    console.log('\n🇬🇧 AUTO-STARTING BULK IMPORT OF ALL UK COMPANIES');
    console.log('═══════════════════════════════════════════════════');
    console.log('📊 Target: ~5 million companies');
    console.log('⏱️  Estimated time: 5-7 days');
    console.log('🔒 Duplicate prevention: ENABLED');
    console.log('📈 Monitor: http://localhost:' + PORT + '/api/bulk-import/status');
    console.log('🛑 Stop: curl -X POST http://localhost:' + PORT + '/api/bulk-import/stop');
    console.log('═══════════════════════════════════════════════════\n');

    const maxCompanies = process.env.BULK_IMPORT_MAX_COMPANIES === 'null' ? null : 
                        parseInt(process.env.BULK_IMPORT_MAX_COMPANIES || 'null');

    // Start import in background
    bulkImportService.importAllActiveUKCompanies({
      maxCompanies: maxCompanies,
      batchSize: parseInt(process.env.BULK_IMPORT_BATCH_SIZE || 100),
      delayBetweenBatches: parseInt(process.env.BULK_IMPORT_DELAY || 2000),
      enrichWithContacts: process.env.BULK_IMPORT_ENRICH_CONTACTS === 'true'
    }).catch(error => {
      console.error('❌ Bulk import error:', error.message);
    });
  }

  // Auto-start tracking service if enabled
  if (process.env.AUTO_START_TRACKING === 'true') {
    console.log('🔍 Starting web tracking service...');
    await webTrackingService.startTracking({
      interval: parseInt(process.env.TRACKING_INTERVAL || 3600000),
      batchSize: parseInt(process.env.TRACKING_BATCH_SIZE || 50),
      maxAge: parseInt(process.env.TRACKING_MAX_AGE || 30)
    });
  }

  // Optional scheduled enrichment using cron syntax (default: every hour)
  if (process.env.AUTO_ENRICHMENT_SCHEDULE === 'true') {
    const schedule = process.env.ENRICHMENT_CRON || '0 * * * *';
    console.log(`⏱️  Enrichment cron enabled: ${schedule}`);

    cron.schedule(schedule, async () => {
      try {
        const limit = parseInt(process.env.ENRICHMENT_BATCH_LIMIT || 10);
        await companyEnrichmentService.processQueue(limit);
      } catch (error) {
        console.error('❌ Scheduled enrichment error:', error.message);
      }
    });
  }
});

module.exports = app;
