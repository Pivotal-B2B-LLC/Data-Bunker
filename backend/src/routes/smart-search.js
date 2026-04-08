/**
 * Smart Search Route - Auto-detects UK or USA
 * Routes to database (UK) or API (USA) automatically
 */

const express = require('express');
const router = express.Router();
const ukCompanies = require('./uk-companies');
const usaCompanies = require('./usa-companies');

/**
 * Smart search - detects country and routes accordingly
 * GET /api/companies/search?query=tesla&country=usa
 * GET /api/companies/search?query=tesco&country=uk
 */
router.get('/search', async (req, res) => {
  try {
    const { country } = req.query;

    // Detect country
    const detectedCountry = (country || 'uk').toLowerCase();

    if (detectedCountry === 'usa' || detectedCountry === 'us' || detectedCountry === 'united states') {
      // Route to USA API
      console.log('[Smart Search] → USA API');
      return usaCompanies.handle(req, res);
    } else if (detectedCountry === 'uk' || detectedCountry === 'gb' || detectedCountry === 'united kingdom') {
      // Route to UK database
      console.log('[Smart Search] → UK Database');
      return ukCompanies.handle(req, res);
    } else {
      // Default to UK
      console.log('[Smart Search] → UK Database (default)');
      return ukCompanies.handle(req, res);
    }

  } catch (error) {
    console.error('Smart search error:', error);
    res.status(500).json({
      success: false,
      error: 'Smart search failed',
      details: error.message
    });
  }
});

/**
 * Get system info
 * GET /api/companies/info
 */
router.get('/info', (req, res) => {
  res.json({
    success: true,
    message: 'Dual-source company search system',
    sources: {
      uk: {
        source: 'PostgreSQL Database',
        storage: 'Local (5M+ companies)',
        speed: 'Instant',
        cost: 'Free (no API)',
        coverage: 'All active UK companies',
        enrichment: 'Website, Email, Phone, LinkedIn'
      },
      usa: {
        source: 'OpenCorporates API',
        storage: 'None (real-time API)',
        speed: 'Fast (API latency)',
        cost: 'API key required',
        coverage: 'All USA states',
        enrichment: 'Basic info only'
      }
    },
    routes: {
      uk_search: '/api/companies/uk/search?query=tesco',
      usa_search: '/api/companies/usa/search?query=tesla&state=ca',
      smart_search: '/api/companies/search?query=company&country=uk'
    }
  });
});

module.exports = router;
