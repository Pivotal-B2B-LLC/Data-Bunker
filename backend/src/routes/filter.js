/**
 * Filter API Route
 * Endpoint: /api/filter
 */

const express = require('express');
const router = express.Router();

/**
 * POST /api/filter/advanced
 * Advanced company filtering
 * 
 * Body:
 * {
 *   "country": "gb",
 *   "state": "eng",
 *   "city": "London",
 *   "status": "active",
 *   "industry": "Technology",
 *   "keyword": "software",
 *   "limit": 50,
 *   "offset": 0
 * }
 */
router.post('/advanced', (req, res) => {
  try {
    const {
      country,
      state,
      city,
      status,
      industry,
      keyword,
      limit = 20,
      offset = 0
    } = req.body;

    if (!country) {
      return res.status(400).json({
        error: 'Country is required'
      });
    }

    // Build filter query
    const filters = {
      country,
      state,
      city,
      status: status || 'active',
      industry,
      keyword
    };

    console.log('[ADVANCED FILTER]', filters);

    // This is a placeholder - actual filtering would happen in the search services
    // For now, just return the filter configuration
    res.json({
      success: true,
      message: 'Advanced filtering configured',
      filters,
      pagination: { limit, offset }
    });
  } catch (error) {
    console.error('[FILTER ERROR]', error.message);
    res.status(500).json({
      error: error.message,
      type: 'filter_error'
    });
  }
});

module.exports = router;
